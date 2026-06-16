/**
 * Rakuten RMS Daily Sales & Traffic Extraction Script
 *
 * Fetches for the previous calendar day:
 *   1. Sales by product (via Order Search API)
 *   2. Access count by product (via Statistics API / R-Cabinet CSV)
 *
 * Required environment variables:
 *   RAKUTEN_SERVICE_SECRET  — RMS API serviceSecret
 *   RAKUTEN_LICENSE_KEY     — RMS API licenseKey
 *
 * Output:
 *   data/rakuten-sales-YYYY-MM-DD.csv
 *   data/rakuten-traffic-YYYY-MM-DD.csv
 *   data/rakuten-summary-YYYY-MM-DD.csv  (merged)
 */

import * as fs from "fs";
import * as path from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? "";
const LICENSE_KEY = process.env.RAKUTEN_LICENSE_KEY ?? "";
const DATA_DIR = path.join(process.cwd(), "data");

// ─── Date helpers ─────────────────────────────────────────────────────────────

function yesterday(): { date: string; startDt: string; endDt: string } {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const ymd = d.toISOString().slice(0, 10); // YYYY-MM-DD
  return {
    date: ymd,
    startDt: `${ymd}T00:00:00+0900`,
    endDt: `${ymd}T23:59:59+0900`,
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function authHeader(): string {
  const token = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString(
    "base64"
  );
  return `ESA ${token}`;
}

// ─── Order Search API ─────────────────────────────────────────────────────────

interface OrderItem {
  itemName: string;
  itemId: string;
  units: number;
  price: number;
}

interface Order {
  orderNumber: string;
  orderDatetime: string;
  orderItems: OrderItem[];
}

async function fetchOrders(
  startDt: string,
  endDt: string
): Promise<Order[]> {
  const url = "https://api.rms.rakuten.co.jp/es/2.0/order/searchOrder/";
  const body = {
    dateType: 1, // 1 = order date
    startDatetime: startDt,
    endDatetime: endDt,
    PaginationRequestModel: { requestRecordsAmount: 100, requestPage: 1 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Order API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    orderNumberList?: string[];
    PaginationResponseModel?: { totalRecordsAmount: number };
  };

  if (!json.orderNumberList?.length) return [];

  // Fetch order details in batches of 100
  const detailUrl =
    "https://api.rms.rakuten.co.jp/es/2.0/order/getOrder/";
  const detailRes = await fetch(detailUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      orderNumberList: json.orderNumberList,
    }),
  });

  if (!detailRes.ok) {
    const text = await detailRes.text();
    throw new Error(`Order detail API error ${detailRes.status}: ${text}`);
  }

  const detail = (await detailRes.json()) as {
    orderModelList?: Array<{
      orderNumber: string;
      orderDatetime: string;
      packageModelList: Array<{
        itemModelList: Array<{
          itemName: string;
          itemId: string;
          units: number;
          price: number;
        }>;
      }>;
    }>;
  };

  return (detail.orderModelList ?? []).map((o) => ({
    orderNumber: o.orderNumber,
    orderDatetime: o.orderDatetime,
    orderItems: o.packageModelList.flatMap((pkg) =>
      pkg.itemModelList.map((item) => ({
        itemName: item.itemName,
        itemId: item.itemId,
        units: item.units,
        price: item.price,
      }))
    ),
  }));
}

// ─── Aggregate sales by product ───────────────────────────────────────────────

interface SalesRow {
  itemId: string;
  itemName: string;
  totalUnits: number;
  totalRevenue: number;
  orderCount: number;
}

function aggregateSales(orders: Order[]): SalesRow[] {
  const map = new Map<string, SalesRow>();
  for (const order of orders) {
    for (const item of order.orderItems) {
      const key = item.itemId;
      const existing = map.get(key);
      if (existing) {
        existing.totalUnits += item.units;
        existing.totalRevenue += item.price * item.units;
        existing.orderCount += 1;
      } else {
        map.set(key, {
          itemId: item.itemId,
          itemName: item.itemName,
          totalUnits: item.units,
          totalRevenue: item.price * item.units,
          orderCount: 1,
        });
      }
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.totalRevenue - a.totalRevenue
  );
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

const BOM = "﻿";

function toCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) =>
    v.includes(",") || v.includes('"') || v.includes("\n")
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ];
  return BOM + lines.join("\n") + "\n";
}

function saveCsv(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`  Saved: ${filePath}`);
}

// ─── Report when credentials are missing ─────────────────────────────────────

function writeNoCredentialsReport(date: string): void {
  const message = "RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY are not set";

  const salesCsv = toCsv(
    ["date", "itemId", "itemName", "totalUnits", "totalRevenue", "orderCount"],
    [["N/A", "N/A", "N/A", "0", "0", "0"]]
  );
  const trafficCsv = toCsv(
    ["date", "itemId", "itemName", "pageViews", "visitors"],
    [["N/A", "N/A", "N/A", "0", "0"]]
  );
  const summaryCsv = toCsv(
    [
      "date",
      "itemId",
      "itemName",
      "totalUnits",
      "totalRevenue",
      "orderCount",
      "pageViews",
      "visitors",
    ],
    [["N/A", "N/A", "N/A", "0", "0", "0", "0", "0"]]
  );

  console.log(`\nWARNING: ${message}`);
  console.log("Saving placeholder output files to record the extraction attempt.\n");

  saveCsv(path.join(DATA_DIR, `rakuten-sales-${date}.csv`), salesCsv);
  saveCsv(path.join(DATA_DIR, `rakuten-traffic-${date}.csv`), trafficCsv);
  saveCsv(path.join(DATA_DIR, `rakuten-summary-${date}.csv`), summaryCsv);

  // Extraction log
  const log = [
    `Extraction date      : ${new Date().toISOString()}`,
    `Target date          : ${date}`,
    `Status               : FAILED — missing credentials`,
    `Error                : ${message}`,
    "",
    "To enable extraction, set the following environment variables:",
    "  RAKUTEN_SERVICE_SECRET=<your-service-secret>",
    "  RAKUTEN_LICENSE_KEY=<your-license-key>",
    "",
    "These can be obtained from the Rakuten RMS API Settings page:",
    "  RMS > システム設定 > API設定 > 各種API設定",
  ].join("\n");

  const logPath = path.join(DATA_DIR, `rakuten-extract-${date}.log`);
  fs.writeFileSync(logPath, log, "utf8");
  console.log(`  Saved: ${logPath}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { date, startDt, endDt } = yesterday();
  console.log(`\n=== Rakuten RMS Extraction — ${date} ===\n`);

  // Guard: credentials required
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    writeNoCredentialsReport(date);
    process.exit(1);
  }

  // 1. Sales by product
  console.log("1. Fetching orders…");
  const orders = await fetchOrders(startDt, endDt);
  console.log(`   ${orders.length} orders retrieved`);

  const salesRows = aggregateSales(orders);
  const salesCsv = toCsv(
    ["date", "itemId", "itemName", "totalUnits", "totalRevenue", "orderCount"],
    salesRows.map((r) => [
      date,
      r.itemId,
      r.itemName,
      String(r.totalUnits),
      String(r.totalRevenue),
      String(r.orderCount),
    ])
  );
  saveCsv(path.join(DATA_DIR, `rakuten-sales-${date}.csv`), salesCsv);

  // 2. Traffic (access count) by product
  //    Rakuten does not expose a public REST endpoint for per-item page views.
  //    The standard approach is the R-Cabinet statistics CSV download or the
  //    "アクセス解析API" available to contracted shops via RMS Web Services.
  //    Here we record a placeholder and note the limitation.
  console.log(
    "\n2. Traffic data: Rakuten does not expose per-item access counts via REST API."
  );
  console.log(
    "   Download the アクセス解析 CSV from RMS manually, or contact Rakuten"
  );
  console.log("   support to enable the Statistics API for your account.\n");

  const trafficCsv = toCsv(
    ["date", "itemId", "itemName", "pageViews", "visitors"],
    salesRows.map((r) => [date, r.itemId, r.itemName, "N/A", "N/A"])
  );
  saveCsv(path.join(DATA_DIR, `rakuten-traffic-${date}.csv`), trafficCsv);

  // 3. Merged summary
  const summaryCsv = toCsv(
    [
      "date",
      "itemId",
      "itemName",
      "totalUnits",
      "totalRevenue",
      "orderCount",
      "pageViews",
      "visitors",
    ],
    salesRows.map((r) => [
      date,
      r.itemId,
      r.itemName,
      String(r.totalUnits),
      String(r.totalRevenue),
      String(r.orderCount),
      "N/A", // traffic not available via API
      "N/A",
    ])
  );
  saveCsv(path.join(DATA_DIR, `rakuten-summary-${date}.csv`), summaryCsv);

  // Extraction log
  const totalRevenue = salesRows.reduce((s, r) => s + r.totalRevenue, 0);
  const totalUnits = salesRows.reduce((s, r) => s + r.totalUnits, 0);
  const log = [
    `Extraction date      : ${new Date().toISOString()}`,
    `Target date          : ${date}`,
    `Status               : SUCCESS`,
    `Total orders         : ${orders.length}`,
    `Unique products      : ${salesRows.length}`,
    `Total units sold     : ${totalUnits}`,
    `Total revenue (JPY)  : ${totalRevenue.toLocaleString()}`,
    `Traffic data         : Not available via API (manual download required)`,
  ].join("\n");

  const logPath = path.join(DATA_DIR, `rakuten-extract-${date}.log`);
  fs.writeFileSync(logPath, log, "utf8");
  console.log(`  Saved: ${logPath}`);

  console.log("\n=== Extraction complete ===");
  console.log(log);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
