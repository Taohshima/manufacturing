/**
 * Rakuten RMS Daily Sales & Traffic Report
 *
 * Required environment variables:
 *   RAKUTEN_SERVICE_SECRET  - RMS API service secret
 *   RAKUTEN_LICENSE_KEY     - RMS API license key
 *
 * Usage:
 *   npx tsx scripts/rakuten-daily-report.ts [YYYY-MM-DD]
 *   (defaults to yesterday if no date provided)
 *
 * Output:
 *   data/rakuten-daily-YYYY-MM-DD.csv
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? "";
const LICENSE_KEY = process.env.RAKUTEN_LICENSE_KEY ?? "";
const RMS_BASE = "https://api.rms.rakuten.co.jp";

// ---- Types ----------------------------------------------------------------

interface RmsOrderItem {
  itemName: string;
  itemId: string;
  itemUrl: string;
  units: number;
  price: number; // unit price
}

interface ProductSummary {
  itemId: string;
  itemName: string;
  itemUrl: string;
  salesAmount: number;
  salesQuantity: number;
  orderCount: number;
  accessCount: number; // page views; -1 if unavailable
}

// ---- Helpers ---------------------------------------------------------------

function authHeader(): string {
  const encoded = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString("base64");
  return `ESA ${encoded}`;
}

function targetDate(arg?: string): { dateStr: string; start: string; end: string } {
  const d = arg ? new Date(arg) : (() => {
    const t = new Date();
    t.setDate(t.getDate() - 1);
    return t;
  })();
  const dateStr = d.toISOString().split("T")[0]; // YYYY-MM-DD
  return { dateStr, start: `${dateStr} 00:00:00`, end: `${dateStr} 23:59:59` };
}

function csvEscape(v: string | number): string {
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ---- RMS API Calls ---------------------------------------------------------

/** Step 1: search orders → list of order numbers */
async function searchOrderNumbers(start: string, end: string): Promise<string[]> {
  const url = `${RMS_BASE}/es/2.0/order/searchOrder`;
  const orderNumbers: string[] = [];
  let page = 1;

  while (true) {
    const body = {
      dateType: 1, // 1 = order date
      startDatetime: start,
      endDatetime: end,
      PaginationRequestModel: {
        requestRecordsAmount: 100,
        requestPage: page,
        SortModelList: [{ sortColumn: 1, sortDirection: 1 }],
      },
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
      const text = await res.text().catch(() => "");
      throw new Error(`searchOrder HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      orderNumberList?: string[];
      MessageModelList?: { messageType: string; messageCode: string; message: string }[];
    };

    // Surface any API-level errors
    const errors = (json.MessageModelList ?? []).filter((m) => m.messageType === "ERROR");
    if (errors.length) {
      throw new Error(`searchOrder API error: ${errors.map((e) => e.message).join("; ")}`);
    }

    const batch = json.orderNumberList ?? [];
    orderNumbers.push(...batch);

    if (batch.length < 100) break; // last page
    page++;
  }

  return orderNumbers;
}

/** Step 2: fetch order details (items, amounts) for up to 100 orders at once */
async function getOrderDetails(orderNumbers: string[]): Promise<RmsOrderItem[]> {
  if (orderNumbers.length === 0) return [];

  const url = `${RMS_BASE}/es/2.0/order/getOrder`;
  const items: RmsOrderItem[] = [];

  // API accepts max 100 order numbers per call
  for (let i = 0; i < orderNumbers.length; i += 100) {
    const chunk = orderNumbers.slice(i, i + 100);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ orderNumberList: chunk }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`getOrder HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      OrderModelList?: {
        orderNumber: string;
        PackageModelList?: {
          ItemModelList?: {
            itemName: string;
            itemId: string;
            itemUrl: string;
            units: number;
            price: number;
          }[];
        }[];
      }[];
      MessageModelList?: { messageType: string; messageCode: string; message: string }[];
    };

    const errors = (json.MessageModelList ?? []).filter((m) => m.messageType === "ERROR");
    if (errors.length) {
      throw new Error(`getOrder API error: ${errors.map((e) => e.message).join("; ")}`);
    }

    for (const order of json.OrderModelList ?? []) {
      for (const pkg of order.PackageModelList ?? []) {
        for (const item of pkg.ItemModelList ?? []) {
          items.push({
            itemName: item.itemName,
            itemId: item.itemId,
            itemUrl: item.itemUrl ?? "",
            units: item.units,
            price: item.price,
          });
        }
      }
    }
  }

  return items;
}

/**
 * Step 3: fetch item access counts for a given date.
 * Rakuten RMS does not expose an official access-count REST endpoint,
 * so this function attempts the Cabinet/Statistics API and returns -1
 * (unavailable) per item if the endpoint is absent or unauthorised.
 */
async function fetchAccessCounts(
  _dateStr: string,
  _itemIds: string[]
): Promise<Map<string, number>> {
  // Placeholder: Rakuten RMS Web Service does not currently offer a
  // per-item page-view count via the public REST API. Merchants can
  // retrieve access stats manually from the RMS Analytics dashboard
  // (https://rms.rakuten.co.jp > アクセス解析). Automated retrieval
  // would require screen-scraping or a future API endpoint.
  return new Map(); // empty → callers will set accessCount = -1
}

// ---- Aggregation & Output --------------------------------------------------

function aggregateItems(rawItems: RmsOrderItem[]): Map<string, ProductSummary> {
  const map = new Map<string, ProductSummary>();

  for (const item of rawItems) {
    const key = item.itemId || item.itemName;
    const existing = map.get(key);
    if (existing) {
      existing.salesAmount += item.price * item.units;
      existing.salesQuantity += item.units;
      existing.orderCount += 1;
    } else {
      map.set(key, {
        itemId: item.itemId,
        itemName: item.itemName,
        itemUrl: item.itemUrl,
        salesAmount: item.price * item.units,
        salesQuantity: item.units,
        orderCount: 1,
        accessCount: -1,
      });
    }
  }

  return map;
}

function buildCsv(dateStr: string, summaries: ProductSummary[]): string {
  const BOM = "﻿";
  const header = [
    "date",
    "item_id",
    "item_name",
    "sales_amount",
    "sales_quantity",
    "order_count",
    "access_count",
    "item_url",
  ].join(",");

  const rows = summaries.map((s) =>
    [
      dateStr,
      s.itemId,
      s.itemName,
      s.salesAmount,
      s.salesQuantity,
      s.orderCount,
      s.accessCount === -1 ? "N/A" : s.accessCount,
      s.itemUrl,
    ]
      .map(csvEscape)
      .join(",")
  );

  return BOM + [header, ...rows].join("\n") + "\n";
}

// ---- Main ------------------------------------------------------------------

async function main() {
  const targetArg = process.argv[2];
  const { dateStr, start, end } = targetDate(targetArg);

  console.log(`=== Rakuten RMS Daily Report: ${dateStr} ===`);

  // Credential check — write a stub CSV so every run leaves a record
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    const outDir = join(ROOT, "data");
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, `rakuten-daily-${dateStr}.csv`);
    const BOM = "﻿";
    const stub =
      BOM +
      "date,status,note\n" +
      `${dateStr},ERROR,RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY are not set — extraction attempted but aborted\n`;
    writeFileSync(outPath, stub, "utf-8");
    console.error(
      "ERROR: RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY must be set.\n" +
        "Set them in your .env file and re-run.\n" +
        `Stub record written to: ${outPath}`
    );
    process.exit(1);
  }

  // 1. Fetch order numbers
  console.log(`Fetching orders for ${start} – ${end} …`);
  const orderNumbers = await searchOrderNumbers(start, end);
  console.log(`  Found ${orderNumbers.length} order(s).`);

  // 2. Fetch order details
  const rawItems = await getOrderDetails(orderNumbers);
  console.log(`  Resolved ${rawItems.length} line item(s).`);

  // 3. Aggregate by product
  const summaryMap = aggregateItems(rawItems);

  // 4. Fetch access counts (best-effort)
  const accessMap = await fetchAccessCounts(dateStr, [...summaryMap.keys()]);
  for (const [key, summary] of summaryMap) {
    if (accessMap.has(key)) summary.accessCount = accessMap.get(key)!;
  }

  // 5. Sort by sales amount descending
  const summaries = [...summaryMap.values()].sort(
    (a, b) => b.salesAmount - a.salesAmount
  );

  // 6. Write CSV
  const outDir = join(ROOT, "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `rakuten-daily-${dateStr}.csv`);
  const csv = buildCsv(dateStr, summaries);
  writeFileSync(outPath, csv, "utf-8");

  // 7. Print summary table to console
  console.log(`\nProduct Sales Summary (${dateStr}):`);
  if (summaries.length === 0) {
    console.log("  No sales data for this date.");
  } else {
    console.log(
      `  ${"Item ID".padEnd(24)} ${"Sales (JPY)".padStart(12)} ${"Qty".padStart(6)} ${"Orders".padStart(8)} ${"Access".padStart(8)}`
    );
    console.log("  " + "-".repeat(64));
    for (const s of summaries) {
      const id = (s.itemId || s.itemName).slice(0, 22).padEnd(24);
      const sales = s.salesAmount.toLocaleString("ja-JP").padStart(12);
      const qty = String(s.salesQuantity).padStart(6);
      const orders = String(s.orderCount).padStart(8);
      const access = (s.accessCount === -1 ? "N/A" : String(s.accessCount)).padStart(8);
      console.log(`  ${id} ${sales} ${qty} ${orders} ${access}`);
    }
  }

  const totalSales = summaries.reduce((acc, s) => acc + s.salesAmount, 0);
  const totalQty = summaries.reduce((acc, s) => acc + s.salesQuantity, 0);
  const totalOrders = orderNumbers.length;
  console.log(`\n  Total: ¥${totalSales.toLocaleString("ja-JP")} / ${totalQty} units / ${totalOrders} orders`);
  console.log(`  Access counts: not available via RMS REST API (see RMS Analytics dashboard)`);
  console.log(`\nOutput saved to: ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
