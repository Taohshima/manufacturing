/**
 * Rakuten RMS daily sales and traffic data extractor.
 *
 * Required environment variables:
 *   RAKUTEN_SERVICE_SECRET  – RMS Web Service サービスシークレット
 *   RAKUTEN_LICENSE_KEY     – RMS Web Service ライセンスキー
 *   RAKUTEN_SHOP_URL        – ショップURL (e.g. "myshop")
 *
 * Usage:
 *   npx tsx scripts/rakuten-rms-extract.ts
 *   npx tsx scripts/rakuten-rms-extract.ts --date 2026-06-22
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? "";
const LICENSE_KEY = process.env.RAKUTEN_LICENSE_KEY ?? "";
const SHOP_URL = process.env.RAKUTEN_SHOP_URL ?? "";

const RMS_BASE = "https://api.rms.rakuten.co.jp/es";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeader(): string {
  const encoded = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString(
    "base64"
  );
  return `ESA ${encoded}`;
}

function getTargetDate(): string {
  // Accept --date YYYY-MM-DD argument, otherwise use yesterday (JST)
  const idx = process.argv.indexOf("--date");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];

  const now = new Date();
  // JST = UTC+9
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() - 1);
  return jst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function jstRange(date: string): { start: string; end: string } {
  return {
    start: `${date}T00:00:00+09:00`,
    end: `${date}T23:59:59+09:00`,
  };
}

async function rmsPost(path: string, body: unknown): Promise<unknown> {
  const url = `${RMS_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RMS API ${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Types (minimal)
// ---------------------------------------------------------------------------

interface OrderItem {
  itemName: string;
  itemUrl: string;
  units: number;
  itemPrice: number;
  priceTaxIncl: number;
}

interface Order {
  orderNumber: string;
  orderDatetime: string;
  totalPrice: number;
  PackageModelList: Array<{
    ItemModelList: Array<{
      itemName: string;
      itemUrl: string;
      units: number;
      itemPrice: number;
      priceTaxIncl: number;
    }>;
  }>;
}

interface SearchOrderResponse {
  MessageModelList?: Array<{ messageType: string; message: string }>;
  PaginationResponseModel?: { totalRecordsAmount: number; totalPages: number };
  orderNumberList?: string[];
}

interface GetOrderResponse {
  MessageModelList?: Array<{ messageType: string; message: string }>;
  OrderModelList?: Order[];
}

// ---------------------------------------------------------------------------
// Step 1 – Fetch order numbers for the target date
// ---------------------------------------------------------------------------

async function fetchOrderNumbers(date: string): Promise<string[]> {
  const { start, end } = jstRange(date);
  let page = 1;
  const allNumbers: string[] = [];

  while (true) {
    const body = {
      dateType: "1", // 1 = 注文日時
      startDatetime: start,
      endDatetime: end,
      PaginationRequestModel: {
        requestRecordsAmount: 100,
        requestPage: page,
      },
    };

    const data = (await rmsPost(
      "/2.0/order/searchOrder/",
      body
    )) as SearchOrderResponse;

    const numbers = data.orderNumberList ?? [];
    allNumbers.push(...numbers);

    const pagination = data.PaginationResponseModel;
    if (!pagination || page >= pagination.totalPages) break;
    page++;
  }

  return allNumbers;
}

// ---------------------------------------------------------------------------
// Step 2 – Fetch full order details in batches of 100
// ---------------------------------------------------------------------------

async function fetchOrderDetails(numbers: string[]): Promise<Order[]> {
  const orders: Order[] = [];
  for (let i = 0; i < numbers.length; i += 100) {
    const chunk = numbers.slice(i, i + 100);
    const data = (await rmsPost("/2.0/order/getOrder/", {
      orderNumberList: chunk,
      version: 2,
    })) as GetOrderResponse;
    if (data.OrderModelList) orders.push(...data.OrderModelList);
  }
  return orders;
}

// ---------------------------------------------------------------------------
// Step 3 – Aggregate sales by product
// ---------------------------------------------------------------------------

interface ProductSales {
  itemUrl: string;
  itemName: string;
  orderCount: number;
  unitsSold: number;
  totalRevenue: number;
}

function aggregateSales(orders: Order[]): ProductSales[] {
  const map = new Map<string, ProductSales>();

  for (const order of orders) {
    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const key = item.itemUrl;
        if (!map.has(key)) {
          map.set(key, {
            itemUrl: item.itemUrl,
            itemName: item.itemName,
            orderCount: 0,
            unitsSold: 0,
            totalRevenue: 0,
          });
        }
        const rec = map.get(key)!;
        rec.orderCount += 1;
        rec.unitsSold += item.units;
        rec.totalRevenue += item.units * (item.priceTaxIncl ?? item.itemPrice);
      }
    }
  }

  return [...map.values()].sort((a, b) => b.totalRevenue - a.totalRevenue);
}

// ---------------------------------------------------------------------------
// Step 4 – Access (page view) data
//
// NOTE: Rakuten RMS Web Service does not expose a public item-level page-view
// API. Access analytics are only available via the RMS management console
// (RMS > 分析 > アクセス解析) and must be downloaded manually, or via the
// separate "R-Analytics" service if contracted.
//
// This function returns an empty map and logs the limitation.
// ---------------------------------------------------------------------------

type AccessMap = Map<string, number>;

async function fetchAccessData(_date: string): Promise<AccessMap> {
  console.warn(
    "⚠  アクセス数APIは楽天RMS Web Serviceの標準エンドポイントでは非公開です。"
  );
  console.warn(
    "   RMS管理画面 > 分析 > アクセス解析 からCSVエクスポートするか、"
  );
  console.warn("   R-Analyticsサービスをご利用ください。");
  return new Map();
}

// ---------------------------------------------------------------------------
// Step 5 – Write CSVs
// ---------------------------------------------------------------------------

function esc(v: string | number): string {
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(filePath: string, rows: string[][]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";
  fs.writeFileSync(filePath, "﻿" + content, "utf8"); // BOM for Excel
  console.log(`  Wrote: ${filePath} (${rows.length - 1} rows)`);
}

function writeSalesCsv(
  date: string,
  sales: ProductSales[],
  access: AccessMap
): string {
  const file = path.join("data", `rakuten_sales_${date.replace(/-/g, "")}.csv`);
  const header = [
    "対象日",
    "商品URL",
    "商品名",
    "注文件数",
    "販売数",
    "売上合計(税込)",
    "アクセス数",
    "転換率(%)",
  ];
  const rows = [header];

  for (const p of sales) {
    const pageViews = access.get(p.itemUrl) ?? 0;
    const cvr =
      pageViews > 0 ? ((p.orderCount / pageViews) * 100).toFixed(2) : "";
    rows.push([
      date,
      p.itemUrl,
      p.itemName,
      String(p.orderCount),
      String(p.unitsSold),
      String(p.totalRevenue),
      pageViews > 0 ? String(pageViews) : "N/A",
      cvr || "N/A",
    ]);
  }

  writeCsv(file, rows);
  return file;
}

function writeSummaryTxt(
  date: string,
  orders: Order[],
  sales: ProductSales[],
  outFile: string
): void {
  const totalRevenue = sales.reduce((s, p) => s + p.totalRevenue, 0);
  const totalUnits = sales.reduce((s, p) => s + p.unitsSold, 0);

  const lines = [
    `楽天市場 日次レポート`,
    `対象日: ${date}`,
    `抽出日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
    ``,
    `── サマリー ──────────────────────`,
    `注文件数     : ${orders.length} 件`,
    `総販売数     : ${totalUnits} 点`,
    `売上合計     : ¥${totalRevenue.toLocaleString()} (税込)`,
    ``,
    `── 商品別売上 TOP ${Math.min(sales.length, 20)} ──────────────`,
    `${"商品名".padEnd(40)} ${"注文".padStart(5)} ${"数量".padStart(5)} ${"売上".padStart(12)}`,
    "─".repeat(66),
  ];

  for (const p of sales.slice(0, 20)) {
    const name = p.itemName.length > 38 ? p.itemName.slice(0, 37) + "…" : p.itemName;
    lines.push(
      `${name.padEnd(40)} ${String(p.orderCount).padStart(5)} ${String(p.unitsSold).padStart(5)} ¥${p.totalRevenue.toLocaleString().padStart(10)}`
    );
  }

  lines.push("");
  lines.push(`アクセス数: RMS管理画面よりCSVエクスポート必要 (API非公開)`);
  lines.push(`詳細: ${outFile}`);

  const txt = lines.join("\n");
  const txtFile = outFile.replace(".csv", ".txt");
  fs.writeFileSync(txtFile, txt, "utf8");
  console.log(`  Wrote: ${txtFile}`);
  console.log("\n" + txt);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const date = getTargetDate();
  console.log(`\n楽天RMS データ抽出 — 対象日: ${date}\n`);

  // Credential check
  const missing: string[] = [];
  if (!SERVICE_SECRET) missing.push("RAKUTEN_SERVICE_SECRET");
  if (!LICENSE_KEY) missing.push("RAKUTEN_LICENSE_KEY");

  if (missing.length > 0) {
    const msg = [
      `[ERROR] 必要な環境変数が設定されていません: ${missing.join(", ")}`,
      ``,
      `設定方法:`,
      `  export RAKUTEN_SERVICE_SECRET="<サービスシークレット>"`,
      `  export RAKUTEN_LICENSE_KEY="<ライセンスキー>"`,
      `  export RAKUTEN_SHOP_URL="<ショップURL>"  # 任意`,
      ``,
      `楽天RMS > ツール・サービス > RMS Web Service > 利用申請・設定 で取得できます。`,
    ].join("\n");

    console.error(msg);

    // Write a placeholder CSV so the scheduler can detect the missing-creds case
    const dir = "data";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const placeholder = path.join(dir, `rakuten_sales_${date.replace(/-/g, "")}_NO_CREDENTIALS.txt`);
    fs.writeFileSync(
      placeholder,
      `Rakuten RMS extraction attempted on ${new Date().toISOString()}\n` +
        `Target date: ${date}\n` +
        `Result: FAILED – missing environment variables: ${missing.join(", ")}\n`,
      "utf8"
    );
    console.log(`\n  Placeholder written: ${placeholder}`);
    process.exit(1);
  }

  try {
    // 1. Order numbers
    console.log("1. 注文番号を取得中...");
    const orderNumbers = await fetchOrderNumbers(date);
    console.log(`   → ${orderNumbers.length} 件の注文番号を取得`);

    // 2. Order details
    console.log("2. 注文詳細を取得中...");
    const orders =
      orderNumbers.length > 0 ? await fetchOrderDetails(orderNumbers) : [];
    console.log(`   → ${orders.length} 件の注文詳細を取得`);

    // 3. Sales aggregation
    console.log("3. 商品別売上を集計中...");
    const sales = aggregateSales(orders);
    console.log(`   → ${sales.length} 商品`);

    // 4. Access data (best-effort)
    console.log("4. アクセス数を取得中...");
    const access = await fetchAccessData(date);

    // 5. Export
    console.log("5. CSVを出力中...");
    const csvFile = writeSalesCsv(date, sales, access);
    writeSummaryTxt(date, orders, sales, csvFile);

    console.log("\n✓ 抽出完了");
  } catch (err) {
    console.error("\n[ERROR] RMS API呼び出しに失敗しました:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
