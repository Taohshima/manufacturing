/**
 * Rakuten RMS daily sales & access data extraction script.
 *
 * Required environment variables:
 *   RAKUTEN_SERVICE_SECRET  - RMS service secret
 *   RAKUTEN_LICENSE_KEY     - RMS license key
 *
 * Optional:
 *   RAKUTEN_OUTPUT_DIR      - directory to write CSVs (default: ./data/rakuten)
 *   RAKUTEN_TARGET_DATE     - YYYY-MM-DD to extract (default: yesterday JST)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Configuration ─────────────────────────────────────────────────────────────

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? '';
const LICENSE_KEY    = process.env.RAKUTEN_LICENSE_KEY    ?? '';
const OUTPUT_DIR     = process.env.RAKUTEN_OUTPUT_DIR     ?? path.join(process.cwd(), 'data', 'rakuten');

const RMS_ORDER_SEARCH  = 'https://api.rms.rakuten.co.jp/es/2.0/order/searchOrder';
const RMS_ORDER_DETAIL  = 'https://api.rms.rakuten.co.jp/es/2.0/order/getOrder';
// Item access statistics are available via the RMS Statistics download API.
// Direct per-item access API is not part of the standard RMS REST API; the
// closest is the CSV export from RMS > アクセス・売上分析 which must be
// downloaded manually or via the Statistics CSV endpoint below.
const RMS_STATS_BASE    = 'https://api.rms.rakuten.co.jp/es/1.0/report/order';

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeader(): string {
  return `ESA ${Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString('base64')}`;
}

/** Returns yesterday's date range as JST ISO-8601 strings. */
function yesterdayJST(overrideDate?: string): { date: string; from: string; to: string } {
  let base: Date;
  if (overrideDate) {
    base = new Date(`${overrideDate}T00:00:00+09:00`);
  } else {
    const now = new Date();
    // Shift to JST (UTC+9) and subtract one day
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    jstNow.setUTCDate(jstNow.getUTCDate() - 1);
    base = new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()));
  }
  const y = base.getUTCFullYear();
  const m = String(base.getUTCMonth() + 1).padStart(2, '0');
  const d = String(base.getUTCDate()).padStart(2, '0');
  return {
    date: `${y}-${m}-${d}`,
    from: `${y}-${m}-${d}T00:00:00+0900`,
    to:   `${y}-${m}-${d}T23:59:59+0900`,
  };
}

function csv(rows: string[][]): string {
  return rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function searchOrderIds(from: string, to: string): Promise<string[]> {
  const res = await fetch(RMS_ORDER_SEARCH, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      dateType: 2,        // 2 = 注文日
      startDatetime: from,
      endDatetime: to,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`searchOrder HTTP ${res.status}: ${body}`);
  }

  const json: any = await res.json();
  if (json.MessageModelList?.some((m: any) => m.messageType === 'ERROR')) {
    const msgs = json.MessageModelList.map((m: any) => m.message).join('; ');
    throw new Error(`searchOrder API error: ${msgs}`);
  }

  return json.orderNumberList ?? [];
}

async function fetchOrderDetails(orderNumbers: string[]): Promise<any[]> {
  if (orderNumbers.length === 0) return [];

  // RMS API accepts up to 100 orders per request
  const chunks: string[][] = [];
  for (let i = 0; i < orderNumbers.length; i += 100) {
    chunks.push(orderNumbers.slice(i, i + 100));
  }

  const results: any[] = [];
  for (const chunk of chunks) {
    const res = await fetch(RMS_ORDER_DETAIL, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ orderNumberList: chunk }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`getOrder HTTP ${res.status}: ${body}`);
    }

    const json: any = await res.json();
    results.push(...(json.orderModelList ?? []));
  }

  return results;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

interface ProductSalesSummary {
  itemId: string;
  itemName: string;
  manageNumber: string;
  unitCount: number;
  totalAmount: number;
  orderCount: number;
}

function aggregateSalesByProduct(orders: any[]): ProductSalesSummary[] {
  const map = new Map<string, ProductSalesSummary>();

  for (const order of orders) {
    // Skip cancelled orders
    if (order.orderProgress === 900) continue;

    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const key = item.itemId ?? item.manageNumber ?? item.itemName ?? 'unknown';
        const existing = map.get(key);
        if (existing) {
          existing.unitCount   += item.units ?? 0;
          existing.totalAmount += (item.price ?? 0) * (item.units ?? 0);
          existing.orderCount  += 1;
        } else {
          map.set(key, {
            itemId:        item.itemId        ?? '',
            itemName:      item.itemName      ?? '',
            manageNumber:  item.manageNumber  ?? '',
            unitCount:     item.units         ?? 0,
            totalAmount:   (item.price ?? 0) * (item.units ?? 0),
            orderCount:    1,
          });
        }
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}

// ── Main ──────────────────────────────────────────────────────────────────────

type ExtractionResult =
  | { ok: true;  date: string; salesRows: string[][]; note: string }
  | { ok: false; date: string; error: string };

async function run(): Promise<ExtractionResult> {
  const { date, from, to } = yesterdayJST(process.env.RAKUTEN_TARGET_DATE);
  console.log(`\n=== 楽天RMS 日次データ抽出 (${date}) ===\n`);

  // ── Credential check ─────────────────────────────────────────────────────
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    const msg =
      'Rakuten RMS credentials not found. ' +
      'Set RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY environment variables.';
    console.error(`[ERROR] ${msg}`);
    return { ok: false, date, error: msg };
  }

  try {
    // ── 1. Sales by product ────────────────────────────────────────────────
    console.log('1. 注文検索中...');
    const orderIds = await searchOrderIds(from, to);
    console.log(`   → ${orderIds.length} 件の注文を取得`);

    let salesRows: string[][] = [];
    let accessNote = '';

    if (orderIds.length === 0) {
      salesRows = [['商品ID', '商品名', '管理番号', '受注件数', '販売数量', '売上金額（円）']];
      console.log('   注文なし');
    } else {
      console.log('2. 注文詳細取得中...');
      const orders = await fetchOrderDetails(orderIds);
      console.log(`   → ${orders.length} 件の注文詳細を取得`);

      const summary = aggregateSalesByProduct(orders);

      salesRows = [
        ['商品ID', '商品名', '管理番号', '受注件数', '販売数量', '売上金額（円）'],
        ...summary.map(s => [
          s.itemId,
          s.itemName,
          s.manageNumber,
          String(s.orderCount),
          String(s.unitCount),
          String(s.totalAmount),
        ]),
      ];
      console.log(`   → ${summary.length} 商品に集計`);
    }

    // ── 2. Access count by product ─────────────────────────────────────────
    // The per-product access count is NOT available via the standard RMS Order
    // REST API. It is provided as a downloadable CSV report in RMS under:
    //   店舗設定 > アクセス・売上分析 > 商品別アクセス数
    // or via the RMS Statistics CSV download endpoint (separate contract).
    // A placeholder row is included to surface this gap.
    accessNote =
      '商品別アクセス数はRMS標準REST APIでは取得不可。' +
      'RMS管理画面「アクセス・売上分析」からCSVダウンロードが必要。';
    console.log(`\n[INFO] アクセス数: ${accessNote}`);

    return { ok: true, date, salesRows, note: accessNote };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.error(`[ERROR] ${msg}`);
    return { ok: false, date, error: msg };
  }
}

// ── Write output ──────────────────────────────────────────────────────────────

(async () => {
  const result = await run();

  ensureDir(OUTPUT_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  if (!result.ok) {
    // Write a status file so the routine leaves a paper trail
    const statusPath = path.join(OUTPUT_DIR, `extraction-status-${result.date}.txt`);
    const statusText =
      `楽天RMS 日次データ抽出\n` +
      `対象日: ${result.date}\n` +
      `実行日時: ${new Date().toISOString()}\n` +
      `ステータス: 失敗\n` +
      `理由: ${result.error}\n` +
      `\n` +
      `必要な環境変数:\n` +
      `  RAKUTEN_SERVICE_SECRET  - RMSサービスシークレット\n` +
      `  RAKUTEN_LICENSE_KEY     - RMSライセンスキー\n` +
      `\n` +
      `取得を設定するには:\n` +
      `  1. 楽天RMS > システム・WEB API設定 でAPIキーを取得\n` +
      `  2. 上記の環境変数を .env に設定\n` +
      `  3. npx tsx scripts/rakuten-daily-extract.ts を再実行\n`;

    fs.writeFileSync(statusPath, statusText, 'utf-8');
    console.log(`\nステータスファイル: ${statusPath}`);
    process.exit(1);
  }

  // Sales CSV
  const salesPath = path.join(OUTPUT_DIR, `sales-by-product-${result.date}.csv`);
  fs.writeFileSync(salesPath, csv(result.salesRows), 'utf-8');
  console.log(`\n売上CSV: ${salesPath}`);

  // Access count placeholder CSV
  const accessRows = [
    ['商品ID', '商品名', 'アクセス数', '備考'],
    ['', '', '', result.note],
  ];
  const accessPath = path.join(OUTPUT_DIR, `access-by-product-${result.date}.csv`);
  fs.writeFileSync(accessPath, csv(accessRows), 'utf-8');
  console.log(`アクセスCSV: ${accessPath}`);

  // Combined summary TXT
  const summaryPath = path.join(OUTPUT_DIR, `summary-${result.date}.txt`);
  const salesCount  = result.salesRows.length - 1; // minus header
  const totalRevenue = result.salesRows.slice(1)
    .reduce((sum, r) => sum + (parseInt(r[5], 10) || 0), 0);

  const summaryText =
    `楽天RMS 日次データ サマリー\n` +
    `${'='.repeat(40)}\n` +
    `対象日    : ${result.date}\n` +
    `実行日時  : ${new Date().toISOString()}\n` +
    `${'─'.repeat(40)}\n` +
    `[売上]\n` +
    `  商品種別数 : ${salesCount} 商品\n` +
    `  合計売上   : ¥${totalRevenue.toLocaleString()}\n` +
    `\n` +
    `[アクセス数]\n` +
    `  ${result.note}\n` +
    `${'─'.repeat(40)}\n` +
    `出力ファイル:\n` +
    `  売上CSV  : ${salesPath}\n` +
    `  アクセスCSV: ${accessPath}\n`;

  fs.writeFileSync(summaryPath, summaryText, 'utf-8');
  console.log(`サマリー  : ${summaryPath}`);
  console.log('\n抽出完了');
})();
