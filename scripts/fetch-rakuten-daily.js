#!/usr/bin/env node
/**
 * Rakuten RMS daily sales & traffic extraction script
 *
 * Required environment variables:
 *   RAKUTEN_SERVICE_SECRET  - RMS service secret (サービスシークレット)
 *   RAKUTEN_LICENSE_KEY     - RMS license key (ライセンスキー)
 *
 * Usage:
 *   node scripts/fetch-rakuten-daily.js [YYYY-MM-DD]
 *   (defaults to yesterday if no date supplied)
 *
 * Output:
 *   reports/rakuten-daily-YYYY-MM-DD.csv
 *   reports/rakuten-daily-YYYY-MM-DD.log
 */

"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

// ── helpers ──────────────────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d;
}

function rmsAuth(serviceSecret, licenseKey) {
  const token = Buffer.from(`${serviceSecret}:${licenseKey}`).toString("base64");
  return `ESA ${token}`;
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCSV(rows, columns) {
  const bom = "﻿"; // UTF-8 BOM for Excel
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return `${bom}${header}\n${body}`;
}

function httpsPost(url, headers, payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const buf = Buffer.from(payload, "utf-8");
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": buf.length,
      },
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Request timed out")));
    req.write(buf);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Request timed out")));
  });
}

// ── Rakuten RMS Order API (sales by product) ──────────────────────────────────

async function fetchDailySales(auth, dateStr) {
  const startDatetime = `${dateStr}T00:00:00+0900`;
  const endDatetime = `${dateStr}T23:59:59+0900`;

  const payload = JSON.stringify({
    dateType: 1,
    startDatetime,
    endDatetime,
    PaginationRequestModel: { requestRecordsAmount: 1000, requestPage: 1 },
  });

  let res;
  try {
    res = await httpsPost(
      "https://api.rms.rakuten.co.jp/es/2.0/order/searchOrder/",
      { Authorization: auth },
      payload
    );
  } catch (err) {
    return { rows: [], error: `Network error calling Order API: ${err.message}` };
  }

  if (res.status !== 200) {
    return {
      rows: [],
      error: `Order API returned HTTP ${res.status}: ${res.body.slice(0, 300)}`,
    };
  }

  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    return { rows: [], error: "Order API response is not valid JSON" };
  }

  const byItem = new Map();
  const orderModelList = data.OrderModelList ?? [];

  for (const order of orderModelList) {
    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const id = String(item.itemDetailId ?? item.itemId ?? "unknown");
        const name = String(item.itemName ?? "");
        const url = String(item.itemUrl ?? "");
        const units = Number(item.units ?? item.itemCount ?? 0);
        const price = Number(item.itemPrice ?? 0);
        if (byItem.has(id)) {
          const e = byItem.get(id);
          e.orders += 1;
          e.units += units;
          e.amount += price * units;
        } else {
          byItem.set(id, { itemName: name, itemUrl: url, orders: 1, units, amount: price * units });
        }
      }
    }
  }

  const rows = Array.from(byItem.entries()).map(([itemId, v]) => ({
    date: dateStr,
    itemId,
    itemName: v.itemName,
    itemUrl: v.itemUrl,
    orderCount: v.orders,
    unitsSold: v.units,
    salesAmount: v.amount,
  }));

  return { rows };
}

// ── Rakuten Statistics API (access count / page views by product) ─────────────

async function fetchDailyAccess(auth, dateStr) {
  const datePart = dateStr.replace(/-/g, "");
  const url = `https://api.rms.rakuten.co.jp/es/1.0/statistics/item/get/?dateType=daily&startDate=${datePart}&endDate=${datePart}`;

  let res;
  try {
    res = await httpsGet(url, { Authorization: auth });
  } catch (err) {
    return { rows: [], error: `Network error calling Statistics API: ${err.message}` };
  }

  if (res.status !== 200) {
    return {
      rows: [],
      error: `Statistics API returned HTTP ${res.status}: ${res.body.slice(0, 300)}`,
    };
  }

  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    return { rows: [], error: "Statistics API response is not valid JSON" };
  }

  const itemStatsList = data.itemStatisticsList ?? [];

  const rows = itemStatsList.map((s) => ({
    date: dateStr,
    itemId: String(s.itemId ?? s.manageNumber ?? ""),
    itemName: String(s.itemName ?? ""),
    pageViews: Number(s.pageView ?? s.accessCount ?? 0),
  }));

  return { rows };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  const targetDate = process.argv[2] ? process.argv[2] : isoDate(yesterday());

  console.log("\n=== Rakuten RMS Daily Data Extraction ===");
  console.log(`Target date: ${targetDate}`);
  console.log(`Run time   : ${new Date().toISOString()}\n`);

  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET ?? "";
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY ?? "";

  const reportsDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const outputPath = path.join(reportsDir, `rakuten-daily-${targetDate}.csv`);
  const logPath = path.join(reportsDir, `rakuten-daily-${targetDate}.log`);

  const logLines = [
    "Rakuten RMS Daily Extraction Log",
    `Target date : ${targetDate}`,
    `Run time    : ${new Date().toISOString()}`,
    "---",
  ];

  function log(msg) {
    console.log(msg);
    logLines.push(msg);
  }

  if (!serviceSecret || !licenseKey) {
    log(
      "ERROR: Rakuten RMS credentials not found in environment.\n" +
        "       Set RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY to enable extraction.\n" +
        "       These can be found in RMS > システム設定 > API利用設定."
    );

    const placeholder = toCSV(
      [
        {
          date: targetDate,
          itemId: "(credentials not configured)",
          itemName: "",
          itemUrl: "",
          orderCount: "",
          unitsSold: "",
          salesAmount: "",
          pageViews: "",
          extractionStatus: "CREDENTIALS_MISSING",
        },
      ],
      [
        "date",
        "itemId",
        "itemName",
        "itemUrl",
        "orderCount",
        "unitsSold",
        "salesAmount",
        "pageViews",
        "extractionStatus",
      ]
    );

    fs.writeFileSync(outputPath, placeholder, "utf-8");
    log(`\nPlaceholder CSV written to: ${outputPath}`);
    logLines.push("STATUS: FAILED – credentials missing");
    fs.writeFileSync(logPath, logLines.join("\n"), "utf-8");
    process.exit(1);
  }

  const auth = rmsAuth(serviceSecret, licenseKey);
  log("Credentials found. Calling Rakuten RMS APIs...\n");

  const [salesResult, accessResult] = await Promise.all([
    fetchDailySales(auth, targetDate),
    fetchDailyAccess(auth, targetDate),
  ]);

  if (salesResult.error) {
    log(`[Sales API]   ERROR: ${salesResult.error}`);
  } else {
    log(`[Sales API]   OK – ${salesResult.rows.length} item(s) found`);
  }

  if (accessResult.error) {
    log(`[Traffic API] ERROR: ${accessResult.error}`);
  } else {
    log(`[Traffic API] OK – ${accessResult.rows.length} item(s) found`);
  }

  // Merge sales + access by itemId
  const merged = new Map();

  for (const r of salesResult.rows) {
    merged.set(r.itemId, {
      date: r.date,
      itemId: r.itemId,
      itemName: r.itemName,
      itemUrl: r.itemUrl,
      orderCount: r.orderCount,
      unitsSold: r.unitsSold,
      salesAmount: r.salesAmount,
      pageViews: 0,
    });
  }

  for (const r of accessResult.rows) {
    const existing = merged.get(r.itemId);
    if (existing) {
      existing.pageViews = r.pageViews;
      if (!existing.itemName && r.itemName) existing.itemName = r.itemName;
    } else {
      merged.set(r.itemId, {
        date: r.date,
        itemId: r.itemId,
        itemName: r.itemName,
        itemUrl: "",
        orderCount: 0,
        unitsSold: 0,
        salesAmount: 0,
        pageViews: r.pageViews,
      });
    }
  }

  const rows = Array.from(merged.values()).sort((a, b) => b.salesAmount - a.salesAmount);

  const totalOrders = rows.reduce((s, r) => s + r.orderCount, 0);
  const totalUnits = rows.reduce((s, r) => s + r.unitsSold, 0);
  const totalSales = rows.reduce((s, r) => s + r.salesAmount, 0);
  const totalViews = rows.reduce((s, r) => s + r.pageViews, 0);

  log("\n─── Summary ───────────────────────────────────────────");
  log(`  Products with data : ${rows.length}`);
  log(`  Total orders       : ${totalOrders}`);
  log(`  Total units sold   : ${totalUnits}`);
  log(`  Total sales (JPY)  : ¥${totalSales.toLocaleString()}`);
  log(`  Total page views   : ${totalViews.toLocaleString()}`);
  log("───────────────────────────────────────────────────────\n");

  const columns = [
    "date",
    "itemId",
    "itemName",
    "itemUrl",
    "orderCount",
    "unitsSold",
    "salesAmount",
    "pageViews",
  ];
  const csv = toCSV(rows, columns);
  fs.writeFileSync(outputPath, csv, "utf-8");
  log(`CSV written to: ${outputPath}`);

  const status = salesResult.error && accessResult.error ? "FAILED" : "OK";
  logLines.push(`STATUS: ${status}`);
  fs.writeFileSync(logPath, logLines.join("\n"), "utf-8");

  if (status === "FAILED") process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
