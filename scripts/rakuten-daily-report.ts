/**
 * Rakuten RMS Daily Sales & Traffic Report
 *
 * Usage:
 *   npm run rakuten:report
 *   npm run rakuten:report -- --date 2026-06-08
 *   npm run rakuten:report -- --access-csv /path/to/access.csv
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET  – RMS service secret
 *   RAKUTEN_LICENSE_KEY     – RMS license key
 *
 * Access/traffic data:
 *   Rakuten RMS does not expose a public API for per-product page views.
 *   Download the CSV from: RMS > データ分析 > アクセス解析 > CSV出力
 *   Then re-run with: --access-csv <downloaded-file>
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE_URL = 'https://api.rms.rakuten.co.jp/es/2.0';
const ORDERS_PER_BATCH = 100; // Rakuten getOrder hard limit

// ─── Types ───────────────────────────────────────────────────────────────────

interface OrderItem {
  itemNumber: string;
  itemName: string;
  units: number;
  price: number;
}

interface SalesRow {
  itemNumber: string;
  itemName: string;
  unitsSold: number;
  revenue: number;
}

interface AccessRow {
  itemNumber: string;
  itemName: string;
  pageViews: number;
  uniqueUsers: number;
}

interface CombinedRow extends SalesRow, AccessRow {
  conversionRate: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function buildAuthHeader(): string {
  const secret = process.env.RAKUTEN_SERVICE_SECRET;
  const key = process.env.RAKUTEN_LICENSE_KEY;
  if (!secret || !key) {
    throw new Error(
      'Missing credentials.\n' +
        'Set RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY in your .env file.'
    );
  }
  return `ESA ${Buffer.from(`${secret}:${key}`).toString('base64')}`;
}

// ─── CLI args ────────────────────────────────────────────────────────────────

function getTargetDate(): string {
  const idx = process.argv.indexOf('--date');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getAccessCsvPath(): string | null {
  const idx = process.argv.indexOf('--access-csv');
  return idx !== -1 ? (process.argv[idx + 1] ?? null) : null;
}

// ─── Rakuten Order API ────────────────────────────────────────────────────────

async function searchOrderNumbers(dateStr: string, auth: string): Promise<string[]> {
  const start = `${dateStr}T00:00:00+09:00`;
  const end = `${dateStr}T23:59:59+09:00`;
  const all: string[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(`${BASE_URL}/order/searchOrder`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({
        dateType: 0, // 0 = 注文日
        startDatetime: start,
        endDatetime: end,
        PaginationRequestModel: {
          requestRecordsAmount: 1000,
          requestPage: page,
          SortModelList: [{ sortColumn: '1', sortDirection: 'ASC' }],
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`searchOrder HTTP ${res.status}: ${body}`);
    }

    const json = await res.json();
    const numbers: string[] = json.orderNumberList ?? [];
    all.push(...numbers);

    const p = json.PaginationResponseModel;
    if (!p || page >= p.totalPages) break;
    page++;
  }

  return all;
}

async function fetchOrderItems(orderNumbers: string[], auth: string): Promise<OrderItem[]> {
  const items: OrderItem[] = [];

  for (let i = 0; i < orderNumbers.length; i += ORDERS_PER_BATCH) {
    const batch = orderNumbers.slice(i, i + ORDERS_PER_BATCH);
    const res = await fetch(`${BASE_URL}/order/getOrder`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ orderNumberList: batch, version: 2 }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`getOrder HTTP ${res.status}: ${body}`);
    }

    const json = await res.json();
    for (const order of json.OrderModelList ?? []) {
      for (const pkg of order.PackageModelList ?? []) {
        for (const item of pkg.ItemModelList ?? []) {
          items.push({
            itemNumber: String(item.itemNumber ?? item.manageNumber ?? ''),
            itemName: String(item.itemName ?? ''),
            units: Number(item.units ?? 0),
            price: Number(item.price ?? 0),
          });
        }
      }
    }
  }

  return items;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

function aggregateSales(items: OrderItem[]): Map<string, SalesRow> {
  const map = new Map<string, SalesRow>();
  for (const item of items) {
    const row = map.get(item.itemNumber);
    if (row) {
      row.unitsSold += item.units;
      row.revenue += item.price * item.units;
    } else {
      map.set(item.itemNumber, {
        itemNumber: item.itemNumber,
        itemName: item.itemName,
        unitsSold: item.units,
        revenue: item.price * item.units,
      });
    }
  }
  return map;
}

// ─── Access CSV parser ───────────────────────────────────────────────────────
// Expected format from RMS アクセス解析 CSV export (UTF-8 or Shift-JIS BOM):
//   集計日,商品管理番号,商品名,ページビュー数,ユニークユーザー数

function parseAccessCsv(csvPath: string): Map<string, AccessRow> {
  const map = new Map<string, AccessRow>();
  const raw = fs.readFileSync(csvPath).toString('utf-8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return map;

  // Skip header row
  const firstField = lines[0].split(',')[0]?.toLowerCase() ?? '';
  const startIdx = /date|日付|集計/.test(firstField) ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 4) continue;

    const itemNumber = cols[1]?.trim() ?? '';
    const itemName = cols[2]?.trim() ?? '';
    const pageViews = parseInt(cols[3]?.trim() ?? '0', 10);
    const uniqueUsers = parseInt(cols[4]?.trim() ?? '0', 10);

    if (!itemNumber) continue;

    const row = map.get(itemNumber);
    if (row) {
      row.pageViews += pageViews;
      row.uniqueUsers += uniqueUsers;
    } else {
      map.set(itemNumber, { itemNumber, itemName, pageViews, uniqueUsers });
    }
  }

  return map;
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function cell(v: string): string {
  return v.includes(',') || v.includes('"') || v.includes('\n')
    ? `"${v.replace(/"/g, '""')}"`
    : v;
}

function writeSalesCsv(rows: SalesRow[], filePath: string, dateStr: string): void {
  const lines = ['集計日,商品管理番号,商品名,注文数,売上金額（税込）'];
  for (const r of rows) {
    lines.push([dateStr, cell(r.itemNumber), cell(r.itemName), r.unitsSold, r.revenue].join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

function writeCombinedCsv(rows: CombinedRow[], filePath: string, dateStr: string): void {
  const lines = [
    '集計日,商品管理番号,商品名,注文数,売上金額（税込）,ページビュー数,ユニークユーザー数,転換率',
  ];
  for (const r of rows) {
    lines.push(
      [
        dateStr,
        cell(r.itemNumber),
        cell(r.itemName),
        r.unitsSold,
        r.revenue,
        r.pageViews,
        r.uniqueUsers,
        r.conversionRate,
      ].join(',')
    );
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

function writeSummary(
  dateStr: string,
  salesRows: SalesRow[],
  accessMap: Map<string, AccessRow> | null,
  filePath: string
): void {
  const totalOrders = salesRows.reduce((s, r) => s + r.unitsSold, 0);
  const totalRevenue = salesRows.reduce((s, r) => s + r.revenue, 0);

  const lines: string[] = [
    '===== 楽天RMS 日次レポート =====',
    `集計日     : ${dateStr}`,
    `出力日時   : ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
    '',
    '--- 売上サマリー ---',
    `商品種類数 : ${salesRows.length}`,
    `総注文数   : ${totalOrders.toLocaleString()} 件`,
    `総売上金額 : ¥${totalRevenue.toLocaleString()}`,
    '',
  ];

  if (salesRows.length === 0) {
    lines.push('注文データなし（当日の注文: 0件）');
    lines.push('※ RMS上でも注文がなかった可能性があります');
  } else {
    lines.push('商品別売上 TOP 10:');
    [...salesRows]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
      .forEach((r, i) => {
        const name = r.itemName.slice(0, 28).padEnd(30);
        const qty = String(r.unitsSold).padStart(5);
        lines.push(`  ${String(i + 1).padStart(2)}. ${name} ${qty}件  ¥${r.revenue.toLocaleString()}`);
      });
  }

  lines.push('');

  if (accessMap) {
    const totalPV = [...accessMap.values()].reduce((s, r) => s + r.pageViews, 0);
    const totalUU = [...accessMap.values()].reduce((s, r) => s + r.uniqueUsers, 0);
    lines.push('--- アクセスサマリー ---');
    lines.push(`商品種類数         : ${accessMap.size}`);
    lines.push(`総ページビュー     : ${totalPV.toLocaleString()}`);
    lines.push(`総ユニークユーザー : ${totalUU.toLocaleString()}`);
  } else {
    lines.push('--- アクセスデータ ---');
    lines.push('アクセスデータ: 未取得（APIでの取得は非対応）');
    lines.push('取得手順:');
    lines.push('  1. RMS > データ分析 > アクセス解析 > CSV出力');
    lines.push(`  2. npm run rakuten:report -- --date ${dateStr} --access-csv <ファイルパス>`);
  }

  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dateStr = getTargetDate();
  const accessCsvPath = getAccessCsvPath();

  console.log('\n楽天RMS 日次データ抽出');
  console.log(`集計日: ${dateStr}\n`);

  const auth = buildAuthHeader();

  const exportDir = path.join(process.cwd(), 'exports');
  fs.mkdirSync(exportDir, { recursive: true });

  // Step 1 – search order numbers
  console.log('[1/4] 注文番号を検索中...');
  const orderNumbers = await searchOrderNumbers(dateStr, auth);
  console.log(`      ${orderNumbers.length} 件の注文が見つかりました`);

  // Step 2 – fetch order details
  console.log('[2/4] 注文詳細を取得中...');
  const items = orderNumbers.length > 0 ? await fetchOrderItems(orderNumbers, auth) : [];
  console.log(`      ${items.length} 件の商品明細を取得`);

  // Step 3 – aggregate & optionally parse access CSV
  console.log('[3/4] データを集計中...');
  const salesMap = aggregateSales(items);
  const salesRows = [...salesMap.values()].sort((a, b) => b.revenue - a.revenue);

  let accessMap: Map<string, AccessRow> | null = null;
  if (accessCsvPath) {
    try {
      accessMap = parseAccessCsv(accessCsvPath);
      console.log(`      アクセスCSV読み込み: ${accessMap.size} 商品`);
    } catch (err) {
      console.warn(`      アクセスCSV読み込み失敗: ${(err as Error).message}`);
    }
  } else {
    console.log('      アクセスデータ: スキップ（--access-csv 未指定）');
  }

  // Step 4 – write output files
  console.log('[4/4] ファイルを出力中...');

  const salesCsv = path.join(exportDir, `rakuten-sales-${dateStr}.csv`);
  writeSalesCsv(salesRows, salesCsv, dateStr);
  console.log(`      売上CSV      : ${salesCsv}`);

  if (accessMap) {
    const allKeys = new Set([...salesMap.keys(), ...accessMap.keys()]);
    const combined: CombinedRow[] = [...allKeys].map((key) => {
      const s = salesMap.get(key);
      const a = accessMap!.get(key);
      const unitsSold = s?.unitsSold ?? 0;
      const uniqueUsers = a?.uniqueUsers ?? 0;
      return {
        itemNumber: key,
        itemName: s?.itemName ?? a?.itemName ?? '',
        unitsSold,
        revenue: s?.revenue ?? 0,
        pageViews: a?.pageViews ?? 0,
        uniqueUsers,
        conversionRate:
          uniqueUsers > 0 ? `${((unitsSold / uniqueUsers) * 100).toFixed(2)}%` : 'N/A',
      };
    });

    const combinedCsv = path.join(exportDir, `rakuten-combined-${dateStr}.csv`);
    writeCombinedCsv(combined, combinedCsv, dateStr);
    console.log(`      統合CSV      : ${combinedCsv}`);
  }

  const summaryTxt = path.join(exportDir, `rakuten-summary-${dateStr}.txt`);
  writeSummary(dateStr, salesRows, accessMap, summaryTxt);
  console.log(`      サマリー     : ${summaryTxt}`);

  console.log('\n--- 完了 ---\n');
  console.log(fs.readFileSync(summaryTxt, 'utf-8'));
}

main().catch((err) => {
  console.error('\nFatal:', (err as Error).message);
  process.exit(1);
});
