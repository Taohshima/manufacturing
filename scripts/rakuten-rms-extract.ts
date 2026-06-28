/**
 * Rakuten RMS Daily Sales & Traffic Extraction
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET  - RMS サービスシークレット
 *   RAKUTEN_LICENSE_KEY     - RMS ライセンスキー
 *
 * Optional:
 *   TARGET_DATE  - YYYYMMDD (defaults to yesterday)
 *
 * Usage:
 *   npx tsx scripts/rakuten-rms-extract.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? '';
const LICENSE_KEY    = process.env.RAKUTEN_LICENSE_KEY ?? '';

const TARGET_DATE: string = (() => {
  if (process.env.TARGET_DATE) return process.env.TARGET_DATE;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
})();

// YYYYMMDD → YYYY-MM-DD HH:MM:SS (start/end of day JST = UTC+9, stored as UTC)
const dateToRangeJST = (yyyymmdd: string) => {
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  // JST 00:00 = UTC 2026-06-26 15:00, JST 23:59:59 = UTC 2026-06-27 14:59:59
  return {
    from: `${y}-${m}-${d}T00:00:00+09:00`,
    to:   `${y}-${m}-${d}T23:59:59+09:00`,
  };
};

const OUTPUT_DIR = path.join(process.cwd(), 'data', 'rakuten');
const RMS_BASE   = 'https://api.rms.rakuten.co.jp/es/2.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderItem {
  itemUrl: string;
  itemName: string;
  units:    number;
  price:    number;
}

interface Order {
  orderNumber:  string;
  orderDatetime: string;
  orderItems:   OrderItem[];
}

interface SalesSummaryRow {
  item_url:      string;
  item_name:     string;
  units_sold:    number;
  gross_sales:   number;
}

interface AccessRow {
  item_url:     string;
  access_count: number;
  note:         string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function rmsGet(path: string, authHeader: string): Promise<unknown> {
  const url = `${RMS_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RMS API error ${res.status} for ${url}: ${body}`);
  }
  return res.json();
}

async function rmsPost(path: string, authHeader: string, body: unknown): Promise<unknown> {
  const url = `${RMS_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RMS API error ${res.status} for POST ${url}: ${text}`);
  }
  return res.json();
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function writeCsv(filePath: string, headers: string[], rows: (string | number)[][]): void {
  const bom = '﻿';
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map(r => r.map(csvEscape).join(',')),
  ];
  fs.writeFileSync(filePath, bom + lines.join('\n'), 'utf-8');
}

// ---------------------------------------------------------------------------
// Step 1: Fetch orders for the target day (sales by product)
// ---------------------------------------------------------------------------

async function fetchSalesByProduct(authHeader: string): Promise<SalesSummaryRow[]> {
  const { from, to } = dateToRangeJST(TARGET_DATE);

  // RMS Order Search API (searchOrder)
  const payload = {
    orderProgressList:    [100, 200, 300, 400, 500, 600, 700, 800], // all statuses
    dateType:             1, // order date
    startDatetime:        from,
    endDatetime:          to,
    PaginationRequestModel: { requestRecordsAmount: 1000, requestPage: 1 },
  };

  const data = any = await rmsPost('/order/searchOrder/', authHeader, payload);

  const orderNumberList: string[] = data?.orderNumberList ?? [];
  if (orderNumberList.length === 0) {
    console.log('  No orders found for the target date.');
    return [];
  }

  console.log(`  Found ${orderNumberList.length} order(s). Fetching details…`);

  // Batch-fetch order details (up to 100 at a time)
  const orders: Order[] = [];
  const chunkSize = 100;
  for (let i = 0; i < orderNumberList.length; i += chunkSize) {
    const chunk = orderNumberList.slice(i, i + chunkSize);
    const detail: any = await rmsPost('/order/getOrder/', authHeader, { orderNumberList: chunk });
    const orderModelList: any[] = detail?.orderModelList ?? [];
    for (const o of orderModelList) {
      const items: OrderItem[] = (o.PackageModelList ?? []).flatMap((pkg: any) =>
        (pkg.ItemModelList ?? []).map((item: any) => ({
          itemUrl:  item.itemUrl  ?? '',
          itemName: item.itemName ?? '',
          units:    Number(item.units     ?? 0),
          price:    Number(item.priceTaxInc ?? item.price ?? 0) * Number(item.units ?? 0),
        }))
      );
      orders.push({
        orderNumber:   o.orderNumber ?? '',
        orderDatetime: o.orderDatetime ?? '',
        orderItems:    items,
      });
    }
  }

  // Aggregate by item URL
  const map = new Map<string, SalesSummaryRow>();
  for (const order of orders) {
    for (const item of order.orderItems) {
      const key = item.itemUrl || item.itemName;
      const existing = map.get(key);
      if (existing) {
        existing.units_sold  += item.units;
        existing.gross_sales += item.price;
      } else {
        map.set(key, {
          item_url:    item.itemUrl,
          item_name:   item.itemName,
          units_sold:  item.units,
          gross_sales: item.price,
        });
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => b.units_sold - a.units_sold);
}

// ---------------------------------------------------------------------------
// Step 2: Fetch access counts by product (item)
//
// Rakuten does not expose real-time per-item access counts via the standard
// RMS Web API (v2). The access statistics are available in:
//   - RMS > アクセス分析 (web UI only)
//   - Rakuten Analytics API (separate contract, endpoint different)
//
// This function attempts the Item API to list active items, then annotates
// with a note explaining the limitation.
// ---------------------------------------------------------------------------

async function fetchAccessByProduct(authHeader: string): Promise<AccessRow[]> {
  // Attempt: item list endpoint (confirms API connectivity for item data)
  const data: any = await rmsGet('/item/search/?hits=100&offset=0', authHeader);
  const items: any[] = data?.itemSearchResult?.itemList ?? data?.items ?? [];

  if (items.length === 0) {
    console.log('  No items returned from Item API (or endpoint not available).');
    return [];
  }

  console.log(`  Retrieved ${items.length} item(s) from Item API.`);
  console.log('  NOTE: Per-item access counts require Rakuten Analytics API (separate contract).');
  console.log('        Returning item list with placeholder access counts.');

  return items.map((item: any) => ({
    item_url:     item.itemUrl ?? item.manageNumber ?? '',
    access_count: 0, // not available via standard RMS Web API
    note:         'access count not available via RMS Web API v2; use Rakuten Analytics API',
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const nowIso = new Date().toISOString();
  console.log('='.repeat(60));
  console.log('Rakuten RMS Daily Data Extraction');
  console.log(`Run timestamp : ${nowIso}`);
  console.log(`Target date   : ${TARGET_DATE} (JST)`);
  console.log('='.repeat(60));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // -------------------------------------------------------------------------
  // Guard: credentials required
  // -------------------------------------------------------------------------
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    const msg = [
      `Rakuten RMS Extraction Attempt`,
      `Timestamp   : ${nowIso}`,
      `Target date : ${TARGET_DATE}`,
      `Status      : FAILED`,
      `Reason      : Missing credentials.`,
      ``,
      `Required environment variables (not set):`,
      `  RAKUTEN_SERVICE_SECRET  - RMS > API設定 > サービスシークレット`,
      `  RAKUTEN_LICENSE_KEY     - RMS > API設定 > ライセンスキー`,
      ``,
      `How to set them:`,
      `  1. Log into RMS (https://rms.rakuten.co.jp)`,
      `  2. Go to [店舗設定] > [API設定]`,
      `  3. Copy serviceSecret and licenseKey`,
      `  4. Set env vars and re-run:`,
      `     RAKUTEN_SERVICE_SECRET=xxx RAKUTEN_LICENSE_KEY=yyy npx tsx scripts/rakuten-rms-extract.ts`,
    ].join('\n');

    const logFile = path.join(OUTPUT_DIR, `extraction-attempt-${TARGET_DATE}.txt`);
    fs.writeFileSync(logFile, msg, 'utf-8');

    console.error('\n[FAILED] Missing Rakuten RMS credentials.\n');
    console.error(msg);
    console.log(`\nAttempt logged to: ${logFile}`);
    process.exit(1);
  }

  const authHeader = `ESA ${Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString('base64')}`;

  // -------------------------------------------------------------------------
  // Step 1: Sales by product
  // -------------------------------------------------------------------------
  console.log('\n[1/3] Fetching sales (orders) by product…');
  let salesRows: SalesSummaryRow[] = [];
  let salesError = '';
  try {
    salesRows = await fetchSalesByProduct(authHeader);
    console.log(`  → ${salesRows.length} product(s) with sales.`);
  } catch (err: any) {
    salesError = String(err.message ?? err);
    console.error(`  ERROR: ${salesError}`);
  }

  // -------------------------------------------------------------------------
  // Step 2: Access count by product
  // -------------------------------------------------------------------------
  console.log('\n[2/3] Fetching access counts by product…');
  let accessRows: AccessRow[] = [];
  let accessError = '';
  try {
    accessRows = await fetchAccessByProduct(authHeader);
    console.log(`  → ${accessRows.length} product(s) listed.`);
  } catch (err: any) {
    accessError = String(err.message ?? err);
    console.error(`  ERROR: ${accessError}`);
  }

  // -------------------------------------------------------------------------
  // Step 3: Export CSV files
  // -------------------------------------------------------------------------
  console.log('\n[3/3] Exporting CSV files…');

  const salesCsvPath = path.join(OUTPUT_DIR, `sales-by-product-${TARGET_DATE}.csv`);
  if (salesRows.length > 0) {
    writeCsv(salesCsvPath, ['item_url', 'item_name', 'units_sold', 'gross_sales_jpy'], [
      ...salesRows.map(r => [r.item_url, r.item_name, r.units_sold, r.gross_sales]),
    ]);
    console.log(`  Sales CSV  : ${salesCsvPath}`);
  } else if (!salesError) {
    // Write empty CSV with headers
    writeCsv(salesCsvPath, ['item_url', 'item_name', 'units_sold', 'gross_sales_jpy'], []);
    console.log(`  Sales CSV  : ${salesCsvPath} (no sales data)`);
  }

  const accessCsvPath = path.join(OUTPUT_DIR, `access-by-product-${TARGET_DATE}.csv`);
  if (accessRows.length > 0) {
    writeCsv(accessCsvPath, ['item_url', 'access_count', 'note'], [
      ...accessRows.map(r => [r.item_url, r.access_count, r.note]),
    ]);
    console.log(`  Access CSV : ${accessCsvPath}`);
  } else if (!accessError) {
    writeCsv(accessCsvPath, ['item_url', 'access_count', 'note'], []);
    console.log(`  Access CSV : ${accessCsvPath} (no access data)`);
  }

  // Summary report
  const summaryPath = path.join(OUTPUT_DIR, `summary-${TARGET_DATE}.txt`);
  const totalUnits  = salesRows.reduce((s, r) => s + r.units_sold, 0);
  const totalSales  = salesRows.reduce((s, r) => s + r.gross_sales, 0);
  const summary = [
    `Rakuten RMS Daily Extraction Summary`,
    `====================================`,
    `Timestamp   : ${nowIso}`,
    `Target date : ${TARGET_DATE} (JST)`,
    ``,
    `[Sales]`,
    salesError
      ? `  Status     : ERROR - ${salesError}`
      : `  Status     : OK`,
    `  Products   : ${salesRows.length}`,
    `  Total units: ${totalUnits}`,
    `  Total sales: ¥${totalSales.toLocaleString()}`,
    `  CSV file   : ${salesCsvPath}`,
    ``,
    `[Access Counts]`,
    accessError
      ? `  Status     : ERROR - ${accessError}`
      : `  Status     : OK (see note — per-item access requires Rakuten Analytics API)`,
    `  Items      : ${accessRows.length}`,
    `  CSV file   : ${accessCsvPath}`,
    ``,
    `Top 5 products by units sold:`,
    ...salesRows.slice(0, 5).map((r, i) =>
      `  ${i + 1}. ${r.item_name || r.item_url} — ${r.units_sold} units / ¥${r.gross_sales.toLocaleString()}`
    ),
  ].join('\n');

  fs.writeFileSync(summaryPath, summary, 'utf-8');
  console.log(`  Summary    : ${summaryPath}`);

  console.log('\n' + summary);
  console.log('\n[DONE]');
}

main().catch(err => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
