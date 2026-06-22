/**
 * Rakuten RMS Daily Sales & Traffic Extractor
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET  - RMS service secret
 *   RAKUTEN_LICENSE_KEY     - RMS license key
 *
 * Output: data/rakuten-daily-YYYY-MM-DD.csv
 *
 * Rakuten RMS API docs:
 *   Orders : https://api.rms.rakuten.co.jp/es/2.0/order/searchOrder/
 *   Access  : https://api.rms.rakuten.co.jp/es/1.0/shop/getShopPageAccessInfo/
 */

import fs from "fs";
import path from "path";

// ── helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function yesterday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

function rmsAuthHeader(serviceSecret: string, licenseKey: string): string {
  const encoded = Buffer.from(`${serviceSecret}:${licenseKey}`).toString(
    "base64"
  );
  return `ESA ${encoded}`;
}

function csvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = v == null ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

// ── types ─────────────────────────────────────────────────────────────────────

interface OrderItem {
  itemName: string;
  itemId: string;
  itemPrice: number;
  units: number;
  salesAmount: number;
}

interface AccessItem {
  itemId: string;
  itemName: string;
  pageViews: number;
  visitors: number;
}

interface ReportRow {
  itemId: string;
  itemName: string;
  units: number;
  salesAmount: number;
  pageViews: number;
  visitors: number;
  conversionRate: string;
}

// ── Rakuten API calls ─────────────────────────────────────────────────────────

async function fetchOrders(
  authHeader: string,
  dateFrom: string,
  dateTo: string
): Promise<OrderItem[]> {
  const url = "https://api.rms.rakuten.co.jp/es/2.0/order/searchOrder/";

  const body = {
    dateType: 1, // 注文日
    startDatetime: `${dateFrom}T00:00:00+0900`,
    endDatetime: `${dateTo}T23:59:59+0900`,
    PaginationRequestModel: { requestRecordsAmount: 1000, requestPage: 1 },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Order API error ${res.status}: ${text.slice(0, 300)}`
    );
  }

  const json = (await res.json()) as {
    MessageModel?: { errorCode?: string; message?: string };
    orderNumberList?: string[];
  };

  if (json.MessageModel?.errorCode) {
    throw new Error(
      `Order API message: [${json.MessageModel.errorCode}] ${json.MessageModel.message}`
    );
  }

  // If no orders, return empty
  if (!json.orderNumberList || json.orderNumberList.length === 0) {
    return [];
  }

  // Fetch order details
  const detailUrl =
    "https://api.rms.rakuten.co.jp/es/2.0/order/getOrder/";
  const detailRes = await fetch(detailUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      orderNumberList: json.orderNumberList,
    }),
  });

  if (!detailRes.ok) {
    const text = await detailRes.text();
    throw new Error(
      `Order detail API error ${detailRes.status}: ${text.slice(0, 300)}`
    );
  }

  const detailJson = (await detailRes.json()) as {
    OrderModelList?: Array<{
      PackageModelList?: Array<{
        ItemModelList?: Array<{
          manageNumber?: string;
          itemName?: string;
          itemId?: string;
          unitPrice?: number;
          units?: number;
          itemTotalPrice?: number;
        }>;
      }>;
    }>;
  };

  // Aggregate by itemId
  const map = new Map<string, OrderItem>();
  for (const order of detailJson.OrderModelList ?? []) {
    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const id = item.itemId ?? item.manageNumber ?? "unknown";
        const name = item.itemName ?? id;
        const units = item.units ?? 0;
        const amount = item.itemTotalPrice ?? (item.unitPrice ?? 0) * units;
        if (map.has(id)) {
          const existing = map.get(id)!;
          existing.units += units;
          existing.salesAmount += amount;
        } else {
          map.set(id, {
            itemId: id,
            itemName: name,
            itemPrice: item.unitPrice ?? 0,
            units,
            salesAmount: amount,
          });
        }
      }
    }
  }

  return Array.from(map.values());
}

async function fetchAccess(
  authHeader: string,
  date: string
): Promise<AccessItem[]> {
  // RMS access analysis: item-level page views
  const url =
    "https://api.rms.rakuten.co.jp/es/1.0/shop/getShopPageAccessInfo/";

  const res = await fetch(
    `${url}?dateType=1&startDate=${date}&endDate=${date}`,
    {
      headers: { Authorization: authHeader },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Access API error ${res.status}: ${text.slice(0, 300)}`
    );
  }

  const json = (await res.json()) as {
    result?: { status?: number; message?: string };
    shopPageAccessInfo?: Array<{
      managePage?: string;
      pageTitle?: string;
      pageViews?: number;
      visitors?: number;
    }>;
  };

  if (json.result?.status && json.result.status !== 0) {
    throw new Error(
      `Access API status ${json.result.status}: ${json.result.message}`
    );
  }

  return (json.shopPageAccessInfo ?? []).map((row) => ({
    itemId: row.managePage ?? "",
    itemName: row.pageTitle ?? row.managePage ?? "",
    pageViews: row.pageViews ?? 0,
    visitors: row.visitors ?? 0,
  }));
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const targetDate = isoDate(yesterday());
  const outputDir = path.join(process.cwd(), "data");
  const outputFile = path.join(outputDir, `rakuten-daily-${targetDate}.csv`);

  const logLines: string[] = [
    `Rakuten RMS Daily Report – ${targetDate}`,
    `Run at: ${new Date().toISOString()}`,
    "",
  ];

  console.log(`=== Rakuten RMS Daily Report: ${targetDate} ===`);

  // Check credentials
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET ?? "";
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY ?? "";

  if (!serviceSecret || !licenseKey) {
    const msg =
      "RAKUTEN_SERVICE_SECRET and/or RAKUTEN_LICENSE_KEY environment variables are not set. " +
      "Cannot connect to Rakuten RMS API. Extraction attempted but no data retrieved.";
    console.warn("[WARN]", msg);
    logLines.push("[WARN] " + msg);

    // Write a placeholder CSV so the output file always exists
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const csvLines = [
      csvRow([
        "date",
        "item_id",
        "item_name",
        "units_sold",
        "sales_amount_jpy",
        "page_views",
        "visitors",
        "conversion_rate_pct",
        "note",
      ]),
      csvRow([
        targetDate,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "No data – API credentials not configured",
      ]),
    ];
    fs.writeFileSync(outputFile, csvLines.join("\n") + "\n", "utf-8");
    console.log(`Output: ${outputFile}`);

    // Write log
    const logFile = path.join(
      outputDir,
      `rakuten-daily-${targetDate}.log`
    );
    fs.writeFileSync(logFile, logLines.join("\n") + "\n", "utf-8");

    process.exit(0);
  }

  const authHeader = rmsAuthHeader(serviceSecret, licenseKey);

  // Fetch data
  let orders: OrderItem[] = [];
  let access: AccessItem[] = [];
  let orderError: string | null = null;
  let accessError: string | null = null;

  try {
    console.log("Fetching order data…");
    orders = await fetchOrders(authHeader, targetDate, targetDate);
    console.log(`  → ${orders.length} product(s) with orders`);
    logLines.push(`Orders fetched: ${orders.length} product(s)`);
  } catch (e) {
    orderError = e instanceof Error ? e.message : String(e);
    console.error("[ERROR] Order fetch failed:", orderError);
    logLines.push("[ERROR] Order fetch: " + orderError);
  }

  try {
    console.log("Fetching access data…");
    access = await fetchAccess(authHeader, targetDate);
    console.log(`  → ${access.length} page(s) with access data`);
    logLines.push(`Access fetched: ${access.length} page(s)`);
  } catch (e) {
    accessError = e instanceof Error ? e.message : String(e);
    console.error("[ERROR] Access fetch failed:", accessError);
    logLines.push("[ERROR] Access fetch: " + accessError);
  }

  // Merge by itemId
  const allIds = new Set([
    ...orders.map((o) => o.itemId),
    ...access.map((a) => a.itemId),
  ]);

  const orderMap = new Map(orders.map((o) => [o.itemId, o]));
  const accessMap = new Map(access.map((a) => [a.itemId, a]));

  const rows: ReportRow[] = [];
  for (const id of allIds) {
    const o = orderMap.get(id);
    const a = accessMap.get(id);
    const units = o?.units ?? 0;
    const pv = a?.pageViews ?? 0;
    const cvr =
      pv > 0 ? ((units / pv) * 100).toFixed(2) + "%" : "N/A";
    rows.push({
      itemId: id,
      itemName: o?.itemName ?? a?.itemName ?? id,
      units,
      salesAmount: o?.salesAmount ?? 0,
      pageViews: pv,
      visitors: a?.visitors ?? 0,
      conversionRate: cvr,
    });
  }

  // Sort by salesAmount desc
  rows.sort((a, b) => b.salesAmount - a.salesAmount);

  // Write CSV
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const note = [orderError && `order_error: ${orderError}`, accessError && `access_error: ${accessError}`]
    .filter(Boolean)
    .join("; ");

  const csvLines = [
    csvRow([
      "date",
      "item_id",
      "item_name",
      "units_sold",
      "sales_amount_jpy",
      "page_views",
      "visitors",
      "conversion_rate_pct",
      "note",
    ]),
  ];

  if (rows.length === 0) {
    csvLines.push(
      csvRow([
        targetDate,
        "",
        "",
        0,
        0,
        0,
        0,
        "N/A",
        note || "No data for this date",
      ])
    );
  } else {
    for (const row of rows) {
      csvLines.push(
        csvRow([
          targetDate,
          row.itemId,
          row.itemName,
          row.units,
          row.salesAmount,
          row.pageViews,
          row.visitors,
          row.conversionRate,
          note,
        ])
      );
    }
  }

  fs.writeFileSync(outputFile, csvLines.join("\n") + "\n", "utf-8");
  console.log(`Output: ${outputFile}`);

  // Summary
  const totalSales = rows.reduce((s, r) => s + r.salesAmount, 0);
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalPV = rows.reduce((s, r) => s + r.pageViews, 0);
  console.log(
    `Summary: ${rows.length} products, ¥${totalSales.toLocaleString()} sales, ${totalUnits} units, ${totalPV} PVs`
  );

  logLines.push("");
  logLines.push(
    `Summary: ${rows.length} products, ¥${totalSales} sales, ${totalUnits} units, ${totalPV} PVs`
  );

  const logFile = path.join(outputDir, `rakuten-daily-${targetDate}.log`);
  fs.writeFileSync(logFile, logLines.join("\n") + "\n", "utf-8");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
