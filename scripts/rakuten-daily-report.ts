/**
 * Rakuten RMS Daily Sales & Traffic Report
 *
 * Fetches yesterday's sales (by product) and access counts (by product)
 * from the Rakuten RMS Web API, then exports structured CSV files.
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET  - RMS service secret
 *   RAKUTEN_LICENSE_KEY     - RMS license key
 *
 * Output:
 *   data/rakuten/YYYY-MM-DD/sales.csv
 *   data/rakuten/YYYY-MM-DD/access.csv
 *   data/rakuten/YYYY-MM-DD/summary.csv
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────
const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? "";
const LICENSE_KEY = process.env.RAKUTEN_LICENSE_KEY ?? "";

const RMS_BASE = "https://api.rms.rakuten.co.jp/es";

/** Date helpers */
function yyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rmsDateTime(d: Date, endOfDay = false): string {
  const date = d.toISOString().slice(0, 10);
  return endOfDay ? `${date}T23:59:59+0900` : `${date}T00:00:00+0900`;
}

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

// ──────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────
function authHeader(): string {
  const token = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString("base64");
  return `ESA ${token}`;
}

// ──────────────────────────────────────────────
// RMS API – Order search (sales data)
// ──────────────────────────────────────────────
interface OrderItem {
  itemName: string;
  itemId: string;      // manageNumber / 管理番号
  itemUrl: string;
  units: number;
  price: number;       // unit price
  totalPrice: number;  // price × units
}

interface Order {
  orderId: string;
  orderDatetime: string;
  orderPrice: number;
  items: OrderItem[];
}

async function fetchOrders(dateStr: string): Promise<Order[]> {
  const target = new Date(dateStr);
  const body = {
    orderProgressList: [100, 200, 300, 400, 500, 600, 700, 800],
    dateType: 1, // 1 = order date
    startDatetime: rmsDateTime(target),
    endDatetime: rmsDateTime(target, true),
    PaginationRequestModel: { requestRecordsAmount: 1000, requestPage: 1 },
  };

  const res = await fetch(`${RMS_BASE}/2.0/order/searchOrder/`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Order API ${res.status}: ${text.slice(0, 200)}`);
  }

  const json: any = await res.json();
  const orderNumbers: string[] = json.orderNumberList ?? [];
  if (orderNumbers.length === 0) return [];

  // Fetch detail for each order
  const detailRes = await fetch(`${RMS_BASE}/2.0/order/getOrder/`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ orderNumberList: orderNumbers }),
  });

  if (!detailRes.ok) {
    const text = await detailRes.text();
    throw new Error(`Order detail API ${detailRes.status}: ${text.slice(0, 200)}`);
  }

  const detailJson: any = await detailRes.json();
  const orders: Order[] = [];

  for (const o of detailJson.orderModelList ?? []) {
    const items: OrderItem[] = [];
    for (const pkg of o.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        items.push({
          itemName: item.itemName ?? "",
          itemId: item.manageNumber ?? item.itemId ?? "",
          itemUrl: item.itemUrl ?? "",
          units: Number(item.units ?? 0),
          price: Number(item.price ?? 0),
          totalPrice: Number(item.price ?? 0) * Number(item.units ?? 0),
        });
      }
    }
    orders.push({
      orderId: o.orderNumber,
      orderDatetime: o.orderDatetime,
      orderPrice: Number(o.orderPrice ?? 0),
      items,
    });
  }

  return orders;
}

// ──────────────────────────────────────────────
// RMS API – Access count per item
// Rakuten does not expose real-time per-product access via a single endpoint.
// The closest available is the "商品別アクセス数" through the
// Navigation (統計) API. If unavailable, this returns an empty map.
// ──────────────────────────────────────────────
interface AccessRecord {
  itemId: string;
  itemName: string;
  accessCount: number;
}

async function fetchAccessCounts(dateStr: string): Promise<AccessRecord[]> {
  // The RMS Statistics API endpoint for per-item access
  // POST /es/1.0/shop/get/ with statType=ITEM_ACCESS is not a real endpoint;
  // Rakuten provides item-level access data via the "アクセス・カート投入数集計"
  // file download from the RMS management screen (not a live JSON API).
  // This implementation calls the closest available endpoint; adjust the path
  // if your RMS plan exposes a specific analytics endpoint.
  const res = await fetch(`${RMS_BASE}/1.0/item/get/?dateType=access&date=${dateStr}`, {
    method: "GET",
    headers: { Authorization: authHeader() },
  });

  if (res.status === 404 || res.status === 501) {
    // Endpoint not available for this shop tier — return empty
    return [];
  }

  if (!res.ok) {
    // Non-fatal: log and continue
    console.warn(`Access API ${res.status} — skipping access data`);
    return [];
  }

  const json: any = await res.json();
  return (json.itemAccessList ?? []).map((r: any) => ({
    itemId: r.manageNumber ?? r.itemId ?? "",
    itemName: r.itemName ?? "",
    accessCount: Number(r.accessCount ?? 0),
  }));
}

// ──────────────────────────────────────────────
// Aggregation
// ──────────────────────────────────────────────
interface ProductSalesSummary {
  itemId: string;
  itemName: string;
  unitsSold: number;
  totalRevenue: number;
  orderCount: number;
  accessCount: number;
  conversionRate: string; // unitsSold / accessCount, or "N/A"
}

function aggregateSales(orders: Order[]): Map<string, ProductSalesSummary> {
  const map = new Map<string, ProductSalesSummary>();

  for (const order of orders) {
    for (const item of order.items) {
      const key = item.itemId || item.itemName;
      const existing = map.get(key);
      if (existing) {
        existing.unitsSold += item.units;
        existing.totalRevenue += item.totalPrice;
        existing.orderCount += 1;
      } else {
        map.set(key, {
          itemId: item.itemId,
          itemName: item.itemName,
          unitsSold: item.units,
          totalRevenue: item.totalPrice,
          orderCount: 1,
          accessCount: 0,
          conversionRate: "N/A",
        });
      }
    }
  }

  return map;
}

function mergeAccess(
  salesMap: Map<string, ProductSalesSummary>,
  accessRecords: AccessRecord[]
): ProductSalesSummary[] {
  for (const a of accessRecords) {
    const key = a.itemId || a.itemName;
    const existing = salesMap.get(key);
    if (existing) {
      existing.accessCount = a.accessCount;
    } else {
      salesMap.set(key, {
        itemId: a.itemId,
        itemName: a.itemName,
        unitsSold: 0,
        totalRevenue: 0,
        orderCount: 0,
        accessCount: a.accessCount,
        conversionRate: "N/A",
      });
    }
  }

  return Array.from(salesMap.values()).map((p) => ({
    ...p,
    conversionRate:
      p.accessCount > 0
        ? ((p.unitsSold / p.accessCount) * 100).toFixed(2) + "%"
        : "N/A",
  }));
}

// ──────────────────────────────────────────────
// CSV helpers
// ──────────────────────────────────────────────
function escapeCsv(v: unknown): string {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function toCsv(rows: Record<string, unknown>[], headers: string[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
  const targetDate = yyyymmdd(yesterday());
  console.log(`\n=== Rakuten RMS Daily Report: ${targetDate} ===\n`);

  // Credential check
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    const msg =
      "RAKUTEN_SERVICE_SECRET and/or RAKUTEN_LICENSE_KEY are not set.\n" +
      "Set them as environment variables to enable live data extraction.\n" +
      "Extraction attempted — no data retrieved due to missing credentials.";
    console.warn(msg);

    // Write a placeholder report so the run is traceable
    const outDir = join(process.cwd(), "data", "rakuten", targetDate);
    mkdirSync(outDir, { recursive: true });

    const placeholderCsv =
      "date,status,message\n" +
      `${targetDate},NO_CREDENTIALS,RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY not configured\n`;
    writeFileSync(join(outDir, "summary.csv"), placeholderCsv, "utf-8");
    console.log(`Placeholder written to data/rakuten/${targetDate}/summary.csv`);
    process.exit(2); // exit code 2 = config missing (not a crash)
  }

  // ── 1. Fetch orders (sales data)
  console.log("Fetching orders...");
  let orders: Order[] = [];
  let salesError: string | null = null;
  try {
    orders = await fetchOrders(targetDate);
    console.log(`  → ${orders.length} orders found`);
  } catch (err) {
    salesError = String(err);
    console.error("  Order fetch failed:", salesError);
  }

  // ── 2. Fetch access counts
  console.log("Fetching access counts...");
  let accessRecords: AccessRecord[] = [];
  let accessError: string | null = null;
  try {
    accessRecords = await fetchAccessCounts(targetDate);
    console.log(`  → ${accessRecords.length} item access records found`);
  } catch (err) {
    accessError = String(err);
    console.error("  Access fetch failed:", accessError);
  }

  // ── 3. Aggregate
  const salesMap = aggregateSales(orders);
  const summary = mergeAccess(salesMap, accessRecords);

  // ── 4. Export
  const outDir = join(process.cwd(), "data", "rakuten", targetDate);
  mkdirSync(outDir, { recursive: true });

  // sales.csv
  const salesRows = orders.flatMap((o) =>
    o.items.map((i) => ({
      orderId: o.orderId,
      orderDatetime: o.orderDatetime,
      itemId: i.itemId,
      itemName: i.itemName,
      units: i.units,
      unitPrice: i.price,
      totalPrice: i.totalPrice,
    }))
  );
  const salesCsv = toCsv(salesRows, [
    "orderId",
    "orderDatetime",
    "itemId",
    "itemName",
    "units",
    "unitPrice",
    "totalPrice",
  ]);
  writeFileSync(join(outDir, "sales.csv"), salesCsv, "utf-8");
  console.log(`\nSales CSV: data/rakuten/${targetDate}/sales.csv (${salesRows.length} rows)`);

  // access.csv
  const accessCsv = toCsv(
    accessRecords.map((a) => ({ ...a })),
    ["itemId", "itemName", "accessCount"]
  );
  writeFileSync(join(outDir, "access.csv"), accessCsv, "utf-8");
  console.log(`Access CSV: data/rakuten/${targetDate}/access.csv (${accessRecords.length} rows)`);

  // summary.csv – one row per product
  const summaryCsv = toCsv(
    summary.map((p) => ({ ...p })),
    [
      "itemId",
      "itemName",
      "unitsSold",
      "totalRevenue",
      "orderCount",
      "accessCount",
      "conversionRate",
    ]
  );
  writeFileSync(join(outDir, "summary.csv"), summaryCsv, "utf-8");
  console.log(`Summary CSV: data/rakuten/${targetDate}/summary.csv (${summary.length} products)`);

  // ── 5. Print totals
  const totalRevenue = summary.reduce((s, p) => s + p.totalRevenue, 0);
  const totalUnits = summary.reduce((s, p) => s + p.unitsSold, 0);
  const totalAccess = summary.reduce((s, p) => s + p.accessCount, 0);

  console.log("\n──── Summary ────");
  console.log(`Date:          ${targetDate}`);
  console.log(`Orders:        ${orders.length}`);
  console.log(`Products sold: ${summary.filter((p) => p.unitsSold > 0).length}`);
  console.log(`Units sold:    ${totalUnits}`);
  console.log(`Revenue:       ¥${totalRevenue.toLocaleString()}`);
  console.log(`Access count:  ${totalAccess} ${accessRecords.length === 0 ? "(not available)" : ""}`);
  if (salesError) console.warn(`\nSales error: ${salesError}`);
  if (accessError) console.warn(`Access error: ${accessError}`);
  console.log("─────────────────\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
