/**
 * Rakuten RMS daily sales & traffic extractor
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET  — RMS サービスシークレット
 *   RAKUTEN_LICENSE_KEY     — RMS ライセンスキー
 *
 * Output:
 *   output/rakuten_sales_YYYY-MM-DD.csv
 *   output/rakuten_access_YYYY-MM-DD.csv   (if available from RMS API)
 */

import * as fs from "fs";
import * as path from "path";
import * as https from "https";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? "";
const LICENSE_KEY = process.env.RAKUTEN_LICENSE_KEY ?? "";

const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(today.getDate() - 1);

function toRmsDate(d: Date): string {
  return d.toISOString().split("T")[0].replace(/-/g, ""); // YYYYMMDD
}

function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

const TARGET_DATE = toIsoDate(yesterday); // for file naming / display
const DATE_FROM = toRmsDate(yesterday) + "000000"; // YYYYMMDDHHmmss
const DATE_TO = toRmsDate(yesterday) + "235959";

const RMS_API_BASE = "https://api.rms.rakuten.co.jp";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function buildAuthHeader(): string {
  const encoded = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString(
    "base64"
  );
  return `ESA ${encoded}`;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function request<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method ?? "GET",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: buildAuthHeader(),
        ...options.headers,
      },
    };

    const req = https.request(reqOptions, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(body) as T });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: body as unknown as T });
        }
      });
    });

    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// RMS Order Search API (v2)
// ---------------------------------------------------------------------------

interface OrderSearchRequest {
  dateType: number; // 1=注文日
  startDatetime: string; // YYYYMMDDHHmmss
  endDatetime: string;
  PaginationRequestModel: {
    requestRecordsAmount: number;
    requestPage: number;
    SortModelList: Array<{ sortColumn: string; sortDirection: string }>;
  };
}

interface OrderItem {
  itemName: string;
  itemId: string;
  itemUrl?: string;
  units: number;
  price: number;
  itemTotalPrice: number;
}

interface Order {
  orderNumber: string;
  orderDatetime: string;
  totalPrice: number;
  PackageModelList?: Array<{
    ItemModelList?: OrderItem[];
  }>;
}

interface OrderSearchResponse {
  OrderModel?: Order[];
  PaginationResponseModel?: { totalRecordsAmount: number };
  errorCode?: string;
  message?: string;
}

async function fetchOrders(page = 1): Promise<OrderSearchResponse> {
  const body: OrderSearchRequest = {
    dateType: 1,
    startDatetime: DATE_FROM,
    endDatetime: DATE_TO,
    PaginationRequestModel: {
      requestRecordsAmount: 100,
      requestPage: page,
      SortModelList: [{ sortColumn: "1", sortDirection: "DESC" }],
    },
  };

  const res = await request<OrderSearchResponse>(
    `${RMS_API_BASE}/es/2.0/order/searchOrder/`,
    { method: "POST", body: JSON.stringify(body) }
  );
  return res.data;
}

// ---------------------------------------------------------------------------
// RMS Item Access API (Statistics)
// Rakuten does not expose per-item page views via the standard RMS REST API.
// The closest public endpoint is the Data Download API (R-Karte).
// We attempt an undocumented stats endpoint and fall back gracefully.
// ---------------------------------------------------------------------------

interface AccessRow {
  itemId: string;
  itemName: string;
  pageViews: number;
}

async function fetchItemAccess(): Promise<{
  rows: AccessRow[];
  available: boolean;
  note: string;
}> {
  // The RMS Product page-view stats are not available as a standard REST endpoint.
  // They are downloadable from RMS > データ分析 > アクセス分析 as a CSV.
  // We return an empty result with an explanation.
  return {
    rows: [],
    available: false,
    note:
      "Rakuten RMS does not expose per-item page-view data via the public REST API. " +
      "Access data must be downloaded manually from RMS > データ分析 > アクセス分析, " +
      "or via the Rakuten Ichiba Data Download API if your shop has that contract.",
  };
}

// ---------------------------------------------------------------------------
// CSV helper
// ---------------------------------------------------------------------------

function toCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) =>
    v.includes(",") || v.includes('"') || v.includes("\n")
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  return [headers, ...rows]
    .map((row) => row.map(escape).join(","))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Rakuten RMS Daily Extract (${TARGET_DATE}) ===\n`);

  if (!SERVICE_SECRET || !LICENSE_KEY) {
    console.error(
      "ERROR: RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY environment variables are not set.\n" +
        "Set them before running this script:\n" +
        "  export RAKUTEN_SERVICE_SECRET=your_secret\n" +
        "  export RAKUTEN_LICENSE_KEY=your_key\n"
    );
    process.exit(1);
  }

  // ---------- Sales by product ----------
  console.log("1. Fetching orders from RMS Order API...");
  let allOrders: Order[] = [];
  let page = 1;
  let totalRecords = 0;

  try {
    const firstPage = await fetchOrders(page);

    if (firstPage.errorCode) {
      console.error(`RMS API error: ${firstPage.errorCode} — ${firstPage.message}`);
      process.exit(2);
    }

    totalRecords = firstPage.PaginationResponseModel?.totalRecordsAmount ?? 0;
    allOrders = [...(firstPage.OrderModel ?? [])];
    console.log(`   Total orders found: ${totalRecords}`);

    while (allOrders.length < totalRecords) {
      page++;
      const nextPage = await fetchOrders(page);
      if (!nextPage.OrderModel?.length) break;
      allOrders = [...allOrders, ...nextPage.OrderModel];
    }
  } catch (err) {
    console.error("Network error while fetching orders:", err);
    process.exit(2);
  }

  // Aggregate by item
  const itemMap = new Map<
    string,
    { itemName: string; units: number; revenue: number }
  >();

  for (const order of allOrders) {
    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const key = item.itemId ?? item.itemName;
        const existing = itemMap.get(key) ?? {
          itemName: item.itemName,
          units: 0,
          revenue: 0,
        };
        existing.units += item.units ?? 1;
        existing.revenue += item.itemTotalPrice ?? item.price * (item.units ?? 1);
        itemMap.set(key, existing);
      }
    }
  }

  const salesRows: string[][] = Array.from(itemMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([itemId, v]) => [
      itemId,
      v.itemName,
      String(v.units),
      String(v.revenue),
    ]);

  const salesCsv = toCsv(
    ["item_id", "item_name", "units_sold", "revenue_jpy"],
    salesRows
  );

  const salesSummary = salesRows.reduce(
    (acc, r) => ({
      totalUnits: acc.totalUnits + Number(r[2]),
      totalRevenue: acc.totalRevenue + Number(r[3]),
    }),
    { totalUnits: 0, totalRevenue: 0 }
  );

  console.log(
    `   Unique items sold: ${itemMap.size}` +
      `  |  Total units: ${salesSummary.totalUnits}` +
      `  |  Total revenue: ¥${salesSummary.totalRevenue.toLocaleString()}`
  );

  // ---------- Access / traffic ----------
  console.log("\n2. Fetching item access data...");
  const access = await fetchItemAccess();
  console.log(`   ${access.note}`);

  // ---------- Write output ----------
  console.log("\n3. Writing output files...");
  const outDir = path.join(process.cwd(), "output");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const salesFile = path.join(outDir, `rakuten_sales_${TARGET_DATE}.csv`);
  fs.writeFileSync(salesFile, salesCsv, "utf-8");
  console.log(`   Sales CSV written: ${salesFile}`);

  // Summary JSON (machine-readable for downstream jobs)
  const summary = {
    extracted_at: new Date().toISOString(),
    target_date: TARGET_DATE,
    total_orders: allOrders.length,
    unique_items: itemMap.size,
    total_units_sold: salesSummary.totalUnits,
    total_revenue_jpy: salesSummary.totalRevenue,
    access_data_available: access.available,
    access_data_note: access.note,
  };
  const summaryFile = path.join(
    outDir,
    `rakuten_summary_${TARGET_DATE}.json`
  );
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`   Summary JSON written: ${summaryFile}`);

  console.log("\n=== Extraction complete ===\n");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
