/**
 * Rakuten RMS Daily Sales & Access Data Export
 *
 * Fetches yesterday's (or a specified date's) sales by product and access counts
 * from the Rakuten RMS API, then writes a structured CSV to exports/.
 *
 * Usage:
 *   npm run rms:export               # yesterday (JST)
 *   npm run rms:export -- --date=2026-06-09
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET   RMS service secret
 *   RAKUTEN_LICENSE_KEY      RMS license key
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RmsConfig {
  serviceSecret: string;
  licenseKey: string;
}

interface RmsOrderItem {
  itemName: string;
  itemId: string;
  managementNumber: string;
  itemUrl: string;
  unitPrice: number;
  units: number;
  price: number;
}

interface RmsPackage {
  itemModelList: RmsOrderItem[];
}

interface RmsOrder {
  orderNumber: string;
  orderDatetime: string;
  packageModelList: RmsPackage[];
}

interface OrderSearchRequest {
  dateType: number;
  startDatetime: string;
  endDatetime: string;
  PaginationRequestModel: { requestRecordsAmount: number; requestPage: number };
}

interface OrderSearchResponse {
  MessageModelList?: Array<{
    messageType: string;
    messageCode: string;
    message: string;
  }>;
  PaginationResponseModel?: {
    totalRecordsAmount: number;
    totalPages: number;
    requestPage: number;
  };
  orderModelList?: RmsOrder[];
}

interface AccessCountItem {
  itemUrl: string;
  accessCount: number;
}

interface AccessCountResponse {
  itemAccessModelList?: AccessCountItem[];
}

interface ItemSummary {
  itemId: string;
  itemUrl: string;
  itemName: string;
  managementNumber: string;
  unitPrice: number;
  unitsSold: number;
  salesAmount: number;
  accessCount: number | null;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

// Rakuten RMS uses the "ESA" authentication scheme: ESA base64(secret:key)
function authHeader(cfg: RmsConfig): string {
  const encoded = Buffer.from(`${cfg.serviceSecret}:${cfg.licenseKey}`).toString(
    "base64"
  );
  return `ESA ${encoded}`;
}

async function rmsPost<T>(
  cfg: RmsConfig,
  path: string,
  body: unknown
): Promise<T> {
  const url = `https://api.rms.rakuten.co.jp${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(cfg),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `RMS API ${path} → HTTP ${res.status} ${res.statusText}\n${await res.text()}`
    );
  }
  return res.json() as Promise<T>;
}

async function rmsGet<T>(
  cfg: RmsConfig,
  path: string,
  params: Record<string, string> = {}
): Promise<{ ok: boolean; data: T | null; status: number }> {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.rms.rakuten.co.jp${path}${qs ? "?" + qs : ""}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(cfg) },
    });
    if (!res.ok) return { ok: false, data: null, status: res.status };
    return { ok: true, data: (await res.json()) as T, status: res.status };
  } catch {
    return { ok: false, data: null, status: 0 };
  }
}

// ---------------------------------------------------------------------------
// Sales data (Order Search API v2.0)
// ---------------------------------------------------------------------------

async function fetchAllOrders(
  cfg: RmsConfig,
  start: string,
  end: string
): Promise<RmsOrder[]> {
  const all: RmsOrder[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const body: OrderSearchRequest = {
      dateType: 1, // 1 = order date
      startDatetime: start,
      endDatetime: end,
      PaginationRequestModel: { requestRecordsAmount: 100, requestPage: page },
    };

    const res = await rmsPost<OrderSearchResponse>(
      cfg,
      "/es/2.0/order/searchOrder/",
      body
    );

    // Surface any API-level errors
    for (const msg of res.MessageModelList ?? []) {
      if (msg.messageType === "ERROR") {
        throw new Error(`RMS Order API error ${msg.messageCode}: ${msg.message}`);
      }
    }

    const orders = res.orderModelList ?? [];
    all.push(...orders);
    totalPages = res.PaginationResponseModel?.totalPages ?? 1;
    process.stdout.write(
      `\r  Orders: page ${page}/${totalPages}, cumulative ${all.length}   `
    );
    page++;
  } while (page <= totalPages);

  process.stdout.write("\n");
  return all;
}

// ---------------------------------------------------------------------------
// Access count (best-effort — endpoint may not be available on all plans)
// ---------------------------------------------------------------------------

async function fetchAccessCounts(
  cfg: RmsConfig,
  dateStr: string
): Promise<Record<string, number> | null> {
  // Attempt the item access statistics endpoint
  const result = await rmsGet<AccessCountResponse>(
    cfg,
    "/es/1.0/shop/getItemAccessCount/",
    { date: dateStr, dateType: "0" }
  );

  if (!result.ok || !result.data?.itemAccessModelList) {
    if (result.status === 403 || result.status === 404) {
      console.warn(
        `  Access count API returned HTTP ${result.status} — this endpoint may require` +
          " a higher RMS plan tier. Traffic data omitted."
      );
    } else {
      console.warn(
        "  Access count API unavailable. Traffic data will not be included."
      );
    }
    return null;
  }

  const counts: Record<string, number> = {};
  for (const item of result.data.itemAccessModelList) {
    counts[item.itemUrl] = item.accessCount;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Date helpers (JST)
// ---------------------------------------------------------------------------

function jstDateRange(date: Date): {
  start: string;
  end: string;
  dateStr: string;
} {
  // Build YYYY-MM-DD in JST
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  return {
    start: `${dateStr}T00:00:00+0900`,
    end: `${dateStr}T23:59:59+0900`,
    dateStr,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function buildCsv(rows: ItemSummary[], dateStr: string): string {
  const header =
    "date,item_id,item_url,item_name,management_number,unit_price,units_sold,sales_amount,access_count";
  const lines = rows.map((r) =>
    [
      dateStr,
      r.itemId,
      r.itemUrl,
      `"${r.itemName.replace(/"/g, '""')}"`,
      r.managementNumber,
      r.unitPrice,
      r.unitsSold,
      r.salesAmount,
      r.accessCount ?? "",
    ].join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Console summary table
// ---------------------------------------------------------------------------

function printSummary(rows: ItemSummary[], dateStr: string): void {
  if (rows.length === 0) {
    console.log("\nNo sales data found for this date.");
    console.log(
      "Extraction was attempted successfully. No orders were returned by the Rakuten RMS API."
    );
    return;
  }

  const totalUnits = rows.reduce((s, r) => s + r.unitsSold, 0);
  const totalSales = rows.reduce((s, r) => s + r.salesAmount, 0);
  const hasAccess = rows.some((r) => r.accessCount !== null);

  console.log("\n=== Rakuten RMS Daily Sales Summary ===");
  console.log(`Date              : ${dateStr}`);
  console.log(`Products with sales: ${rows.length}`);
  console.log(`Total units sold  : ${totalUnits.toLocaleString()}`);
  console.log(`Total sales amount: ¥${totalSales.toLocaleString()}`);
  if (!hasAccess) {
    console.log("Access counts     : not available (see warning above)");
  }
  console.log("");

  // Column widths
  const C = [28, 14, 8, 14, hasAccess ? 13 : 0];
  const sep = "-".repeat(C.reduce((a, b) => a + b, 0) + C.length * 3);

  const head = [
    "Product Name".padEnd(C[0]),
    "Sales Amount".padStart(C[1]),
    "Units".padStart(C[2]),
    "Unit Price".padStart(C[3]),
    ...(hasAccess ? ["Access Count".padStart(C[4])] : []),
  ].join(" | ");

  console.log(head);
  console.log(sep);

  for (const r of rows) {
    const line = [
      r.itemName.substring(0, C[0]).padEnd(C[0]),
      `¥${r.salesAmount.toLocaleString()}`.padStart(C[1]),
      String(r.unitsSold).padStart(C[2]),
      `¥${r.unitPrice.toLocaleString()}`.padStart(C[3]),
      ...(hasAccess
        ? [(r.accessCount ?? "N/A").toString().padStart(C[4])]
        : []),
    ].join(" | ");
    console.log(line);
  }
  console.log(sep);

  const footer = [
    "TOTAL".padEnd(C[0]),
    `¥${totalSales.toLocaleString()}`.padStart(C[1]),
    String(totalUnits).padStart(C[2]),
    "".padStart(C[3]),
    ...(hasAccess ? ["".padStart(C[4] as number)] : []),
  ].join(" | ");
  console.log(footer);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET;
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY;

  if (!serviceSecret || !licenseKey) {
    console.error(
      "Error: RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY must be set.\n" +
        "Copy .env.example to .env.local and fill in your RMS credentials."
    );
    process.exit(1);
  }

  const cfg: RmsConfig = { serviceSecret, licenseKey };

  // Allow --date=YYYY-MM-DD override; default to yesterday JST
  const dateArg = process.argv
    .find((a) => a.startsWith("--date="))
    ?.split("=")[1];

  let targetDate: Date;
  if (dateArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
      console.error("Invalid date format. Use --date=YYYY-MM-DD");
      process.exit(1);
    }
    targetDate = new Date(`${dateArg}T12:00:00+09:00`);
  } else {
    // Yesterday in JST
    targetDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  const { start, end, dateStr } = jstDateRange(targetDate);

  console.log(`Rakuten RMS export — ${dateStr} (JST)`);
  console.log(`Range: ${start}  →  ${end}\n`);

  // 1. Orders / sales
  console.log("Step 1: Fetching orders...");
  const orders = await fetchAllOrders(cfg, start, end);
  console.log(`  Retrieved ${orders.length} order(s).`);

  // 2. Aggregate by item
  const itemMap = new Map<string, ItemSummary>();

  for (const order of orders) {
    for (const pkg of order.packageModelList ?? []) {
      for (const item of pkg.itemModelList ?? []) {
        const key = item.itemId || item.managementNumber || item.itemUrl;
        const existing = itemMap.get(key);
        if (existing) {
          existing.unitsSold += item.units;
          existing.salesAmount += item.price;
        } else {
          itemMap.set(key, {
            itemId: item.itemId ?? "",
            itemUrl: item.itemUrl ?? "",
            itemName: item.itemName ?? "",
            managementNumber: item.managementNumber ?? "",
            unitPrice: item.unitPrice ?? 0,
            unitsSold: item.units ?? 0,
            salesAmount: item.price ?? 0,
            accessCount: null,
          });
        }
      }
    }
  }

  // 3. Access counts (best-effort)
  console.log("\nStep 2: Fetching access counts...");
  const accessCounts = await fetchAccessCounts(cfg, dateStr);
  if (accessCounts) {
    const matched = Object.keys(accessCounts).length;
    console.log(`  Access data available for ${matched} item URL(s).`);
    for (const summary of itemMap.values()) {
      const count = accessCounts[summary.itemUrl];
      if (count !== undefined) summary.accessCount = count;
    }
  }

  // 4. Sort by sales amount descending
  const rows = [...itemMap.values()].sort(
    (a, b) => b.salesAmount - a.salesAmount
  );

  // 5. Write CSV
  console.log("\nStep 3: Writing CSV...");
  const exportsDir = path.join(process.cwd(), "exports");
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

  const csvPath = path.join(exportsDir, `rakuten-daily-${dateStr}.csv`);
  fs.writeFileSync(csvPath, buildCsv(rows, dateStr), "utf-8");
  console.log(`  Saved: ${csvPath}`);

  // 6. Console summary
  printSummary(rows, dateStr);
}

main().catch((err) => {
  console.error("\nFatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
