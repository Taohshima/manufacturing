#!/usr/bin/env tsx
/**
 * Rakuten RMS 日次売上・アクセスデータ抽出スクリプト
 *
 * 必要な環境変数 (.env.local に設定):
 *   RMS_SERVICE_SECRET  - RMS Web Service サービスシークレット
 *   RMS_LICENSE_ID      - RMS Web Service ライセンスID
 *
 * 使用方法:
 *   npm run rms:extract              # 前日分を取得
 *   npm run rms:extract -- 2026-06-08  # 指定日を取得
 *
 * 出力:
 *   data/rakuten_daily_YYYY-MM-DD.csv
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Configuration ─────────────────────────────────────────────────────────

const BASE_URL = 'https://api.rms.rakuten.co.jp/es/2.0';
/** Rakuten API allows max 100 order numbers per getOrder call */
const ORDER_BATCH_SIZE = 100;

// ── Type Definitions ──────────────────────────────────────────────────────

interface RmsConfig {
  serviceSecret: string;
  licenseId: string;
}

interface MessageModel {
  messageType: string;
  messageCode: string;
  message: string | null;
}

interface SearchOrderRequest {
  dateType: number;
  startDatetime: string;
  endDatetime: string;
  PaginationRequestModel: {
    requestRecordsAmount: number;
    requestPage: number;
    SortModel: { sortColumn: string; sortDirection: string };
  };
}

interface SearchOrderResponse {
  MessageModel: MessageModel;
  OrderNumberList: string[] | null;
  PaginationResponseModel: {
    requestPage: number;
    returnCount: number;
    totalRecordsAmount: number;
  } | null;
}

interface ItemModel {
  itemName: string;
  itemId: number;
  itemUrl: string;
  itemManageNumber: string;
  units: number;
  price: number;
  salesPrice: number;
}

interface PackageModelItem {
  ItemModelList: ItemModel[];
}

interface OrderModel {
  orderNumber: string;
  orderDatetime: string;
  totalPrice: number;
  PackageModelList: PackageModelItem[];
}

interface GetOrderResponse {
  MessageModel: MessageModel;
  OrderModelList: OrderModel[] | null;
}

interface ProductRow {
  managementNumber: string;
  itemId: string;
  itemUrl: string;
  itemName: string;
  orderCount: number;
  totalUnits: number;
  totalAmount: number;
  accessCount: string;
}

// ── API Helpers ───────────────────────────────────────────────────────────

function makeAuthHeader(cfg: RmsConfig): string {
  return `ESA ${Buffer.from(`${cfg.serviceSecret}:${cfg.licenseId}`).toString('base64')}`;
}

async function rmsPost<T>(cfg: RmsConfig, endpoint: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: makeAuthHeader(cfg),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} [${endpoint}]: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function rmsGet<T>(cfg: RmsConfig, endpoint: string): Promise<T | null> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: makeAuthHeader(cfg) },
  });
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} [${endpoint}]: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// ── Date Utilities ────────────────────────────────────────────────────────

function yesterdayJst(): string {
  // Shift UTC to JST (UTC+9) then take the previous calendar day
  const jstNow = new Date(Date.now() + 9 * 3_600_000);
  jstNow.setUTCDate(jstNow.getUTCDate() - 1);
  const y = jstNow.getUTCFullYear();
  const m = String(jstNow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(jstNow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateRange(dateStr: string): { start: string; end: string } {
  return {
    start: `${dateStr}T00:00:00+0900`,
    end:   `${dateStr}T23:59:59+0900`,
  };
}

// ── Step 1: Collect All Order Numbers ─────────────────────────────────────

async function searchAllOrderNumbers(
  cfg: RmsConfig,
  start: string,
  end: string,
): Promise<string[]> {
  const all: string[] = [];
  let page = 1;

  while (true) {
    const req: SearchOrderRequest = {
      dateType: 1, // 1 = order acceptance date
      startDatetime: start,
      endDatetime: end,
      PaginationRequestModel: {
        requestRecordsAmount: 1000,
        requestPage: page,
        SortModel: { sortColumn: '1', sortDirection: '1' },
      },
    };

    const res = await rmsPost<SearchOrderResponse>(cfg, '/order/searchOrder/', req);

    if (res.MessageModel.messageType !== 'Success') {
      throw new Error(
        `searchOrder: ${res.MessageModel.messageCode} – ${res.MessageModel.message}`,
      );
    }

    const nums = res.OrderNumberList ?? [];
    all.push(...nums);

    const pg = res.PaginationResponseModel;
    if (!pg || all.length >= pg.totalRecordsAmount) break;
    page++;
  }

  return all;
}

// ── Step 2: Fetch Order Details (batched) ─────────────────────────────────

async function fetchOrderDetails(
  cfg: RmsConfig,
  orderNumbers: string[],
): Promise<OrderModel[]> {
  const all: OrderModel[] = [];

  for (let i = 0; i < orderNumbers.length; i += ORDER_BATCH_SIZE) {
    const batch = orderNumbers.slice(i, i + ORDER_BATCH_SIZE);
    const res = await rmsPost<GetOrderResponse>(cfg, '/order/getOrder/', {
      orderNumberList: batch,
    });

    if (res.MessageModel.messageType !== 'Success') {
      throw new Error(`getOrder: ${res.MessageModel.messageCode}`);
    }
    if (res.OrderModelList) all.push(...res.OrderModelList);

    // Brief pause to stay within rate limits
    if (i + ORDER_BATCH_SIZE < orderNumbers.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return all;
}

// ── Step 3: Aggregate Sales by Product ───────────────────────────────────

function aggregateSalesByProduct(orders: OrderModel[]): Map<string, ProductRow> {
  const map = new Map<string, ProductRow>();

  for (const order of orders) {
    // Track which (order, product) pairs we've already counted to avoid
    // double-counting when the same item appears in multiple packages
    const counted = new Set<string>();

    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const key = item.itemManageNumber || String(item.itemId);

        if (!map.has(key)) {
          map.set(key, {
            managementNumber: item.itemManageNumber ?? '',
            itemId: String(item.itemId ?? ''),
            itemUrl: item.itemUrl ?? '',
            itemName: item.itemName ?? '',
            orderCount: 0,
            totalUnits: 0,
            totalAmount: 0,
            accessCount: 'N/A',
          });
        }

        const row = map.get(key)!;
        const orderKey = `${order.orderNumber}::${key}`;
        if (!counted.has(orderKey)) {
          counted.add(orderKey);
          row.orderCount += 1;
        }
        row.totalUnits  += item.units ?? 0;
        row.totalAmount += (item.salesPrice || item.price || 0) * (item.units ?? 0);
      }
    }
  }

  return map;
}

// ── Step 4: Access Count (best-effort) ───────────────────────────────────
//
// Rakuten RMS standard Web Service does not expose a dedicated per-item
// access count API.  Access analytics are typically available through:
//   • RMS管理画面 > アクセス分析 (manual CSV download)
//   • Rakuten Data Insight premium contract
//
// This function probes the known analytics endpoint; a 403/404 response
// means the merchant account does not have analytics API access, in which
// case "N/A" is recorded and the rest of the export continues normally.

async function fetchAccessCounts(
  cfg: RmsConfig,
  dateStr: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  try {
    const data = await rmsGet<{
      ItemVisitorList?: Array<{ itemManageNumber: string; visitorCount: number }>;
    }>(cfg, `/report/getItemVisitor/?targetDate=${dateStr}`);

    if (data === null) {
      console.warn(
        '  [アクセス数] アクセス分析APIへのアクセス権限がありません。' +
        'アクセス数は "N/A" として出力されます。',
      );
      return map;
    }

    for (const entry of data.ItemVisitorList ?? []) {
      map.set(entry.itemManageNumber, entry.visitorCount);
    }
    console.log(`  → ${map.size} 件の商品アクセスデータを取得`);
  } catch (err) {
    console.warn(`  [アクセス数] 取得失敗: ${err}`);
  }

  return map;
}

// ── CSV Builder ───────────────────────────────────────────────────────────

function csvEscape(v: string | number): string {
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function buildCsv(rows: ProductRow[], dateStr: string, totalOrders: number): string {
  const BOM = '﻿'; // UTF-8 BOM for Excel compatibility
  const headers = [
    '対象日付',
    '商品管理番号',
    '商品ID',
    '商品URL',
    '商品名',
    '受注件数',
    '販売数量',
    '売上金額（税込）',
    'アクセス数',
  ];

  const lines = rows.map((r) =>
    [
      dateStr,
      r.managementNumber,
      r.itemId,
      r.itemUrl,
      r.itemName,
      r.orderCount,
      r.totalUnits,
      r.totalAmount,
      r.accessCount,
    ]
      .map(csvEscape)
      .join(','),
  );

  const meta = `# 集計日: ${dateStr} | 総受注件数: ${totalOrders}件 | 商品種類数: ${rows.length}種`;
  return BOM + [meta, headers.join(','), ...lines].join('\r\n') + '\r\n';
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Resolve target date (CLI arg or yesterday JST)
  const targetDate = process.argv[2] ?? yesterdayJst();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error('使用方法: npm run rms:extract -- YYYY-MM-DD');
    process.exit(1);
  }

  // Validate credentials
  const serviceSecret = process.env.RMS_SERVICE_SECRET ?? '';
  const licenseId     = process.env.RMS_LICENSE_ID ?? '';
  if (!serviceSecret || !licenseId) {
    console.error(
      'エラー: 環境変数 RMS_SERVICE_SECRET と RMS_LICENSE_ID が設定されていません。\n' +
      '.env.local に以下を追加してください:\n' +
      '  RMS_SERVICE_SECRET=your_service_secret\n' +
      '  RMS_LICENSE_ID=your_license_id',
    );
    process.exit(1);
  }

  const cfg: RmsConfig = { serviceSecret, licenseId };
  const { start, end } = dateRange(targetDate);

  console.log('\n=== Rakuten RMS 日次データ抽出 ===');
  console.log(`対象日:   ${targetDate} (JST)`);
  console.log(`取得範囲: ${start} ～ ${end}\n`);

  // ── 1. Search order numbers ──────────────────────────────────────────
  console.log('[1/4] 受注番号を検索中...');
  let orderNumbers: string[] = [];
  try {
    orderNumbers = await searchAllOrderNumbers(cfg, start, end);
    console.log(`  → ${orderNumbers.length} 件の受注番号を取得`);
  } catch (err) {
    console.error(`  受注検索に失敗しました: ${err}`);
    console.error('  認証情報・ネットワーク接続を確認してください。');
  }

  // ── 2. Fetch order details ───────────────────────────────────────────
  let salesMap = new Map<string, ProductRow>();
  if (orderNumbers.length > 0) {
    console.log('[2/4] 受注詳細を取得中...');
    try {
      const orders = await fetchOrderDetails(cfg, orderNumbers);
      salesMap = aggregateSalesByProduct(orders);
      console.log(`  → ${salesMap.size} 種の商品データを集計`);
    } catch (err) {
      console.error(`  受注詳細取得に失敗しました: ${err}`);
    }
  } else {
    console.log('[2/4] 受注なし – スキップ');
  }

  // ── 3. Fetch access counts ───────────────────────────────────────────
  console.log('[3/4] アクセス数を取得中...');
  const accessMap = await fetchAccessCounts(cfg, targetDate);

  // Merge access data into sales rows
  for (const [key, row] of salesMap) {
    if (accessMap.has(key)) row.accessCount = String(accessMap.get(key));
  }
  // Products with access but no sales
  for (const [key, count] of accessMap) {
    if (!salesMap.has(key)) {
      salesMap.set(key, {
        managementNumber: key,
        itemId: '',
        itemUrl: '',
        itemName: '',
        orderCount: 0,
        totalUnits: 0,
        totalAmount: 0,
        accessCount: String(count),
      });
    }
  }

  // ── 4. Export CSV ────────────────────────────────────────────────────
  console.log('[4/4] CSVを出力中...');
  const rows = Array.from(salesMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

  const outputDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outPath = path.join(outputDir, `rakuten_daily_${targetDate}.csv`);
  fs.writeFileSync(outPath, buildCsv(rows, targetDate, orderNumbers.length), 'utf8');

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n=== 集計結果 ===');
  if (rows.length === 0) {
    console.log(`対象日 (${targetDate}) のデータはありません。`);
    console.log('（受注0件。APIが正常に応答した場合、データなしとして確認済み）');
  } else {
    const totalAmount = rows.reduce((s, r) => s + r.totalAmount, 0);
    const totalUnits  = rows.reduce((s, r) => s + r.totalUnits, 0);
    console.log(`商品種類数:   ${rows.length} 種`);
    console.log(`総受注件数:   ${orderNumbers.length} 件`);
    console.log(`総販売数量:   ${totalUnits.toLocaleString()} 点`);
    console.log(`売上合計:     ¥${totalAmount.toLocaleString()}`);
    if (accessMap.size > 0) {
      const totalAccess = [...accessMap.values()].reduce((s, v) => s + v, 0);
      console.log(`総アクセス数: ${totalAccess.toLocaleString()}`);
    } else {
      console.log('アクセス数:   N/A (アクセス分析APIへのアクセス権限なし)');
    }

    const top = rows.slice(0, 10);
    console.log('\n─── 売上 TOP 10 ───────────────────────────────────────────');
    for (const r of top) {
      const id = (r.managementNumber || r.itemId).padEnd(20);
      const name = r.itemName.slice(0, 28).padEnd(28);
      console.log(
        `  ${id} ${name}  ${String(r.totalUnits).padStart(5)}点` +
        `  ¥${String(r.totalAmount).padStart(10)}  アクセス: ${r.accessCount}`,
      );
    }
    console.log('───────────────────────────────────────────────────────────');
  }

  console.log(`\n出力ファイル: ${outPath}`);
  console.log('抽出完了。\n');
}

main().catch((err) => {
  console.error('予期しないエラー:', err);
  process.exit(1);
});
