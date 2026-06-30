/**
 * Rakuten RMS Daily Sales & Traffic Report
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET  - RMS サービスシークレット
 *   RAKUTEN_LICENSE_KEY     - RMS ライセンスキー
 *
 * Usage:
 *   npx tsx scripts/rakuten-daily-report.ts
 *   npx tsx scripts/rakuten-daily-report.ts 2024-06-29   (specify target date YYYY-MM-DD JST)
 *
 * Output:
 *   rakuten_daily_sales_YYYYMMDD.csv
 *   rakuten_daily_traffic_YYYYMMDD.csv   (if access data API is available)
 *   rakuten_daily_summary_YYYYMMDD.csv   (combined)
 */

import * as fs from "fs";
import * as path from "path";

const RMS_BASE = "https://api.rms.rakuten.co.jp/es/2.0";

// ─── Date helpers (Japan Standard Time = UTC+9) ──────────────────────────────

function toJST(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function formatJST(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTargetDateRange(targetDateStr?: string): {
  startDatetime: string;
  endDatetime: string;
  dateLabel: string;
} {
  let target: Date;
  if (targetDateStr) {
    // Parse YYYY-MM-DD as JST midnight
    const [y, m, d] = targetDateStr.split("-").map(Number);
    target = new Date(Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000); // JST midnight → UTC
  } else {
    // Yesterday in JST
    const nowJST = toJST(new Date());
    nowJST.setUTCDate(nowJST.getUTCDate() - 1);
    nowJST.setUTCHours(0, 0, 0, 0);
    target = new Date(nowJST.getTime() - 9 * 60 * 60 * 1000); // Back to UTC
  }

  const jstStart = toJST(target);
  const dateLabel = formatJST(jstStart);

  const startDatetime = `${dateLabel}T00:00:00+0900`;
  const endDatetime = `${dateLabel}T23:59:59+0900`;

  return { startDatetime, endDatetime, dateLabel };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function getAuthHeader(): string {
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET?.trim();
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY?.trim();
  if (!serviceSecret || !licenseKey) {
    throw new Error(
      "環境変数 RAKUTEN_SERVICE_SECRET と RAKUTEN_LICENSE_KEY を設定してください。\n" +
        "RMS管理画面 > システム設定 > API認証設定 で確認できます。"
    );
  }
  return "ESA " + Buffer.from(`${serviceSecret}:${licenseKey}`).toString("base64");
}

// ─── Order API ───────────────────────────────────────────────────────────────

interface SearchOrderResponse {
  MessageResponse?: {
    Message?: {
      code?: string;
      summary?: string;
    }[];
  };
  orderNumberList?: string[];
  PaginationResponse?: {
    totalRecordCount?: number;
    requestPage?: number;
    totalPageCount?: number;
  };
}

async function searchOrderNumbers(
  authHeader: string,
  startDatetime: string,
  endDatetime: string,
  page: number = 1
): Promise<SearchOrderResponse> {
  const body = {
    dateType: 1, // 1 = 注文日
    startDatetime,
    endDatetime,
    PaginationRequestModel: {
      requestRecordsAmount: 1000,
      requestPage: page,
      SortModel: [{ sortColumn: "1", sortDirection: "1" }],
    },
  };

  const res = await fetch(`${RMS_BASE}/order/searchOrder/`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`searchOrder failed: HTTP ${res.status}\n${text}`);
  }

  return res.json() as Promise<SearchOrderResponse>;
}

interface OrderDetail {
  orderNumber: string;
  orderStatus: number;
  packageModelList?: {
    itemModelList?: {
      itemNumber: string;
      itemName: string;
      manageNumber?: string;
      unitPrice: number;
      units: number;
      price: number;
    }[];
  }[];
}

interface GetOrderResponse {
  MessageResponse?: unknown;
  orderModel?: OrderDetail[];
}

async function getOrderDetails(
  authHeader: string,
  orderNumbers: string[]
): Promise<OrderDetail[]> {
  if (orderNumbers.length === 0) return [];

  // API limit: 100 per request
  const results: OrderDetail[] = [];
  const chunks = chunkArray(orderNumbers, 100);

  for (const chunk of chunks) {
    const body = { orderNumberList: chunk };
    const res = await fetch(`${RMS_BASE}/order/getOrder/`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`getOrder failed: HTTP ${res.status}\n${text}`);
    }

    const data = (await res.json()) as GetOrderResponse;
    if (data.orderModel) {
      results.push(...data.orderModel);
    }
  }

  return results;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Sales aggregation ───────────────────────────────────────────────────────

interface SalesRow {
  itemNumber: string;
  itemName: string;
  manageNumber: string;
  unitPrice: number;
  orderCount: number;
  totalUnits: number;
  totalSales: number;
}

// Cancelled statuses: 800=キャンセル確定, 900=購入申込キャンセル
const CANCELLED_STATUSES = new Set([800, 900]);

function aggregateSales(orders: OrderDetail[]): SalesRow[] {
  const map = new Map<string, SalesRow>();

  for (const order of orders) {
    if (CANCELLED_STATUSES.has(order.orderStatus)) continue;

    for (const pkg of order.packageModelList ?? []) {
      for (const item of pkg.itemModelList ?? []) {
        const key = item.itemNumber;
        const existing = map.get(key);
        if (existing) {
          existing.orderCount += 1;
          existing.totalUnits += item.units;
          existing.totalSales += item.price;
        } else {
          map.set(key, {
            itemNumber: item.itemNumber,
            itemName: item.itemName,
            manageNumber: item.manageNumber ?? "",
            unitPrice: item.unitPrice,
            orderCount: 1,
            totalUnits: item.units,
            totalSales: item.price,
          });
        }
      }
    }
  }

  return [...map.values()].sort((a, b) => b.totalSales - a.totalSales);
}

// ─── Traffic / access data ───────────────────────────────────────────────────

interface TrafficRow {
  itemNumber: string;
  itemName: string;
  pageViews: number;
  visitors: number;
}

/**
 * Rakuten RMS does not provide a public REST API for per-product access counts.
 * Access data (アクセス数・訪問者数) is only available via:
 *   1. RMS管理画面 > 商品管理 > アクセス数分析 (CSV手動ダウンロード)
 *   2. R-Analytics / RMS Data Download API (別途契約が必要な場合あり)
 *
 * This function attempts to call the Item Statistics endpoint if available.
 * If not accessible, it returns an empty array and logs a notice.
 */
async function fetchTrafficData(
  authHeader: string,
  dateLabel: string
): Promise<TrafficRow[]> {
  // Attempt: RMS Item Statistics API (undocumented / requires specific contract)
  // Endpoint may vary by seller plan; returns 403/404 if not available.
  try {
    const [y, m, d] = dateLabel.split("-");
    const res = await fetch(
      `${RMS_BASE}/report/item/access/?dateType=daily&date=${y}${m}${d}`,
      {
        method: "GET",
        headers: { Authorization: authHeader },
      }
    );

    if (res.status === 404 || res.status === 403 || res.status === 405) {
      return [];
    }

    if (!res.ok) {
      return [];
    }

    // If the endpoint exists, parse response
    const data = await res.json() as { itemAccessList?: { itemNumber: string; itemName: string; pageViews: number; visitors: number }[] };
    return (data.itemAccessList ?? []).map((r) => ({
      itemNumber: r.itemNumber,
      itemName: r.itemName,
      pageViews: r.pageViews,
      visitors: r.visitors,
    }));
  } catch {
    return [];
  }
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function escapeCSV(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(values: (string | number)[]): string {
  return values.map(escapeCSV).join(",");
}

function writeCsvFile(filePath: string, header: string[], rows: (string | number)[][]): void {
  const lines = [header.join(","), ...rows.map(rowToCSV)];
  fs.writeFileSync(filePath, "﻿" + lines.join("\n"), "utf-8"); // BOM for Excel
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const targetDateArg = process.argv[2]; // optional YYYY-MM-DD
  const outputDir = process.argv[3] ?? ".";

  console.log("=== Rakuten RMS 日次データ取得 ===");

  // 1. Auth
  let authHeader: string;
  try {
    authHeader = getAuthHeader();
  } catch (e) {
    console.error(`\n[ERROR] 認証情報エラー: ${(e as Error).message}`);
    process.exit(1);
  }

  // 2. Date range
  const { startDatetime, endDatetime, dateLabel } = getTargetDateRange(targetDateArg);
  console.log(`対象日: ${dateLabel} (JST)`);
  console.log(`期間: ${startDatetime} ～ ${endDatetime}`);

  // 3. Sales data
  console.log("\n--- 受注データ取得中... ---");
  let allOrderNumbers: string[] = [];
  let attemptedSales = false;
  let salesError: string | null = null;

  try {
    attemptedSales = true;
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const searchRes = await searchOrderNumbers(authHeader, startDatetime, endDatetime, page);
      const nums = searchRes.orderNumberList ?? [];
      allOrderNumbers.push(...nums);

      const paging = searchRes.PaginationResponse;
      if (paging) {
        totalPages = paging.totalPageCount ?? 1;
        console.log(
          `  ページ ${page}/${totalPages} — 累計注文数: ${allOrderNumbers.length}`
        );
      }
      page++;
      if (nums.length === 0) break;
    }

    console.log(`受注件数合計: ${allOrderNumbers.length} 件`);
  } catch (e) {
    salesError = (e as Error).message;
    console.error(`[ERROR] 受注検索失敗: ${salesError}`);
  }

  let salesRows: SalesRow[] = [];
  if (allOrderNumbers.length > 0) {
    console.log("注文詳細取得中...");
    const orderDetails = await getOrderDetails(authHeader, allOrderNumbers);
    salesRows = aggregateSales(orderDetails);
    console.log(`商品種別数: ${salesRows.length} 種`);
  }

  // 4. Traffic data
  console.log("\n--- アクセス数データ取得中... ---");
  const trafficRows = await fetchTrafficData(authHeader, dateLabel);
  const trafficAvailable = trafficRows.length > 0;

  if (!trafficAvailable) {
    console.log(
      "  [INFO] アクセス数データはAPI経由では取得できませんでした。\n" +
      "  RMS管理画面 > 商品管理 > アクセス数分析 からCSVをダウンロードしてください。"
    );
  } else {
    console.log(`  商品アクセスデータ: ${trafficRows.length} 件`);
  }

  // 5. Output CSV files
  const dateSuffix = dateLabel.replace(/-/g, "");
  const outputDirAbs = path.resolve(outputDir);
  if (!fs.existsSync(outputDirAbs)) fs.mkdirSync(outputDirAbs, { recursive: true });

  // 5a. Sales CSV
  const salesCsvPath = path.join(outputDirAbs, `rakuten_daily_sales_${dateSuffix}.csv`);
  if (salesRows.length > 0) {
    writeCsvFile(
      salesCsvPath,
      ["商品番号", "商品名", "管理番号", "単価", "注文件数", "販売数量", "売上合計"],
      salesRows.map((r) => [
        r.itemNumber,
        r.itemName,
        r.manageNumber,
        r.unitPrice,
        r.orderCount,
        r.totalUnits,
        r.totalSales,
      ])
    );
    console.log(`\n[保存] 売上CSV: ${salesCsvPath}`);
  } else {
    // Write empty file with note
    const emptyNote = [
      `対象日,${dateLabel}`,
      `取得試行,${attemptedSales ? "済" : "未"}`,
      `エラー,${salesError ?? "データなし（注文件数0件）"}`,
    ].join("\n");
    fs.writeFileSync(salesCsvPath, "﻿" + emptyNote, "utf-8");
    console.log(`\n[保存] 売上CSV (データなし): ${salesCsvPath}`);
  }

  // 5b. Traffic CSV
  const trafficCsvPath = path.join(outputDirAbs, `rakuten_daily_traffic_${dateSuffix}.csv`);
  if (trafficAvailable) {
    writeCsvFile(
      trafficCsvPath,
      ["商品番号", "商品名", "ページビュー数", "訪問者数"],
      trafficRows.map((r) => [r.itemNumber, r.itemName, r.pageViews, r.visitors])
    );
    console.log(`[保存] アクセスCSV: ${trafficCsvPath}`);
  } else {
    const noticeContent =
      "﻿アクセス数データ取得結果\n" +
      `対象日,${dateLabel}\n` +
      "取得結果,API未対応または権限なし\n" +
      "代替手段,RMS管理画面 > 商品管理 > アクセス数分析 > CSV出力\n";
    fs.writeFileSync(trafficCsvPath, noticeContent, "utf-8");
    console.log(`[保存] アクセスCSV (データなし): ${trafficCsvPath}`);
  }

  // 5c. Summary CSV (sales + traffic joined on itemNumber)
  const summaryCsvPath = path.join(outputDirAbs, `rakuten_daily_summary_${dateSuffix}.csv`);
  const trafficMap = new Map(trafficRows.map((r) => [r.itemNumber, r]));

  if (salesRows.length > 0 || trafficAvailable) {
    const allItemNumbers = new Set([
      ...salesRows.map((r) => r.itemNumber),
      ...trafficRows.map((r) => r.itemNumber),
    ]);

    const summaryData: (string | number)[][] = [];
    for (const itemNumber of allItemNumbers) {
      const s = salesRows.find((r) => r.itemNumber === itemNumber);
      const t = trafficMap.get(itemNumber);
      summaryData.push([
        itemNumber,
        s?.itemName ?? t?.itemName ?? "",
        s?.manageNumber ?? "",
        s?.unitPrice ?? "",
        s?.orderCount ?? 0,
        s?.totalUnits ?? 0,
        s?.totalSales ?? 0,
        t?.pageViews ?? "N/A",
        t?.visitors ?? "N/A",
        t && s ? ((s.orderCount / t.visitors) * 100).toFixed(2) + "%" : "N/A",
      ]);
    }

    summaryData.sort((a, b) => Number(b[6] || 0) - Number(a[6] || 0));

    writeCsvFile(
      summaryCsvPath,
      [
        "商品番号",
        "商品名",
        "管理番号",
        "単価",
        "注文件数",
        "販売数量",
        "売上合計",
        "ページビュー数",
        "訪問者数",
        "転換率",
      ],
      summaryData
    );
    console.log(`[保存] サマリーCSV: ${summaryCsvPath}`);
  }

  // 6. Console summary table
  console.log("\n=== サマリー ===");
  console.log(`対象日: ${dateLabel}`);
  console.log(`受注件数: ${allOrderNumbers.length} 件`);
  console.log(
    `売上合計: ¥${salesRows.reduce((s, r) => s + r.totalSales, 0).toLocaleString()}`
  );
  console.log(`商品種別数: ${salesRows.length} 種`);
  console.log(`アクセスデータ: ${trafficAvailable ? `${trafficRows.length} 件` : "取得不可（API未対応）"}`);

  if (salesRows.length > 0) {
    console.log("\n--- 売上上位商品 (上位10件) ---");
    console.log(
      "商品番号".padEnd(20) +
        "商品名".padEnd(40) +
        "注文数".padStart(6) +
        "数量".padStart(6) +
        "売上".padStart(12)
    );
    console.log("-".repeat(86));
    for (const row of salesRows.slice(0, 10)) {
      console.log(
        row.itemNumber.padEnd(20) +
          row.itemName.substring(0, 38).padEnd(40) +
          String(row.orderCount).padStart(6) +
          String(row.totalUnits).padStart(6) +
          ("¥" + row.totalSales.toLocaleString()).padStart(12)
      );
    }
  }

  if (salesError) {
    console.error(`\n[警告] 受注データ取得エラーあり: ${salesError}`);
    process.exit(1);
  }

  console.log("\n完了。");
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
