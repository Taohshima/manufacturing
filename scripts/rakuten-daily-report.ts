/**
 * Rakuten RMS Daily Sales & Traffic Extractor
 *
 * Fetches the previous day's order (sales) and item access data from Rakuten RMS
 * Web API v2.0, then writes three CSV files under data/rakuten/:
 *   YYYY-MM-DD-sales.csv    – sales aggregated per item
 *   YYYY-MM-DD-traffic.csv  – access counts per item (if available via API)
 *   YYYY-MM-DD-summary.csv  – combined view with CVR
 *
 * Required environment variables:
 *   RAKUTEN_SERVICE_SECRET   – RMS serviceSecret (サービスシークレット)
 *   RAKUTEN_LICENSE_KEY      – RMS licenseKey (ライセンスキー)
 *
 * Optional:
 *   RAKUTEN_TARGET_DATE      – Override target date (YYYY-MM-DD, default = yesterday JST)
 *   RAKUTEN_OUTPUT_DIR       – Output directory (default = ./data/rakuten)
 *
 * Run:
 *   npx tsx scripts/rakuten-daily-report.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── Config ───────────────────────────────────────────────────────────────────

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET ?? ''
const LICENSE_KEY = process.env.RAKUTEN_LICENSE_KEY ?? ''
const OUTPUT_DIR = process.env.RAKUTEN_OUTPUT_DIR ?? path.join(process.cwd(), 'data', 'rakuten')
const BASE_URL = 'https://api.rms.rakuten.co.jp/es/2.0'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function authHeader(): string {
  const encoded = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString('base64')
  return `ESA ${encoded}`
}

/** Returns yesterday's date in JST (UTC+9) as { date, start, end } */
function targetDateRange(overrideDate?: string): { date: string; start: string; end: string } {
  if (overrideDate) {
    return {
      date: overrideDate,
      start: `${overrideDate}T00:00:00+09:00`,
      end:   `${overrideDate}T23:59:59+09:00`,
    }
  }
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const yesterday = new Date(jstNow)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const date = yesterday.toISOString().slice(0, 10)
  return {
    date,
    start: `${date}T00:00:00+09:00`,
    end:   `${date}T23:59:59+09:00`,
  }
}

function escapeCsv(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function toCsvRow(cols: (string | number | undefined | null)[]): string {
  return cols.map(escapeCsv).join(',')
}

async function rmsPost<T>(endpoint: string, body: unknown): Promise<T> {
  const url = `${BASE_URL}${endpoint}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`RMS API error ${res.status} at ${endpoint}: ${text}`)
  }
  return JSON.parse(text) as T
}

// ─── RMS API Types (subset) ───────────────────────────────────────────────────

interface SearchOrderResponse {
  MessageModel: { messageType: string; messageCode: string; message: string | null }
  PaginationResponseModel: {
    returnRecordsAmount: number
    totalRecordsAmount: number
    requestPage: number
  }
  orderNumberList: string[]
}

interface OrderItemModel {
  itemNumber: string
  itemName: string
  units: number
  price: number           // unit price (tax included)
  priceTaxRate?: number
}

interface PackageModel {
  ItemModel: OrderItemModel[]
}

interface OrderModel {
  orderNumber: string
  orderDatetime: string
  totalPrice: number
  PackageModel: PackageModel[]
}

interface GetOrderResponse {
  MessageModel: { messageType: string; messageCode: string; message: string | null }
  OrderModel: OrderModel[]
}

// ─── Sales extraction ─────────────────────────────────────────────────────────

interface SalesRow {
  itemNumber: string
  itemName: string
  orderCount: number
  unitsSold: number
  salesAmount: number
}

async function fetchSales(start: string, end: string): Promise<SalesRow[]> {
  console.log(`[sales] Searching orders from ${start} to ${end} …`)

  // 1. Collect all order numbers (paginated, max 1000/page)
  const allOrderNumbers: string[] = []
  let page = 1
  while (true) {
    const res = await rmsPost<SearchOrderResponse>('/order/searchOrder/', {
      dateType: 1,                // 1 = order date (注文日)
      startDatetime: start,
      endDatetime: end,
      PaginationRequestModel: {
        requestRecordsAmount: 1000,
        requestPage: page,
      },
    })

    if (res.MessageModel.messageType !== 'OK') {
      throw new Error(`searchOrder failed: ${res.MessageModel.message}`)
    }

    const nums = res.orderNumberList ?? []
    allOrderNumbers.push(...nums)

    const total = res.PaginationResponseModel?.totalRecordsAmount ?? 0
    console.log(`[sales] Page ${page}: ${nums.length} orders (total: ${total})`)

    if (allOrderNumbers.length >= total || nums.length === 0) break
    page++
  }

  if (allOrderNumbers.length === 0) {
    console.log('[sales] No orders found for the target date.')
    return []
  }

  // 2. Fetch order details in batches of 100 (API limit)
  const salesMap = new Map<string, SalesRow>()
  const orderSet = new Set<string>() // track unique order numbers per item

  for (let i = 0; i < allOrderNumbers.length; i += 100) {
    const batch = allOrderNumbers.slice(i, i + 100)
    const res = await rmsPost<GetOrderResponse>('/order/getOrder/', {
      orderNumberList: batch,
    })

    if (res.MessageModel.messageType !== 'OK') {
      throw new Error(`getOrder failed: ${res.MessageModel.message}`)
    }

    for (const order of res.OrderModel ?? []) {
      for (const pkg of order.PackageModel ?? []) {
        for (const item of pkg.ItemModel ?? []) {
          const key = item.itemNumber
          if (!salesMap.has(key)) {
            salesMap.set(key, {
              itemNumber: item.itemNumber,
              itemName: item.itemName,
              orderCount: 0,
              unitsSold: 0,
              salesAmount: 0,
            })
          }
          const row = salesMap.get(key)!
          const orderKey = `${order.orderNumber}::${key}`
          if (!orderSet.has(orderKey)) {
            row.orderCount++
            orderSet.add(orderKey)
          }
          row.unitsSold += item.units
          row.salesAmount += item.price * item.units
        }
      }
    }
  }

  return [...salesMap.values()].sort((a, b) => b.salesAmount - a.salesAmount)
}

// ─── Traffic extraction ───────────────────────────────────────────────────────

interface TrafficRow {
  itemNumber: string
  itemName: string
  accessCount: number
  uniqueVisitors: number
}

/**
 * Rakuten RMS standard Web API (v2.0) does NOT expose daily item-level access
 * counts programmatically. Access analytics (R-Karte / アクセス解析) are only
 * available through the RMS management panel as a browser-based report or
 * manual CSV download.
 *
 * This function returns an empty array and prints an explanatory message.
 * To populate traffic data, download the CSV from RMS → アクセス解析 →
 * 商品別アクセス数 and merge it with the sales output.
 */
async function fetchTraffic(_date: string): Promise<{ rows: TrafficRow[]; available: boolean }> {
  console.log(
    '[traffic] NOTE: The Rakuten RMS Web API v2.0 does not provide daily item-level ' +
    'access counts (アクセス数). Traffic data is only accessible via the RMS management ' +
    'panel: アクセス解析 → 商品別アクセス数. Please export that CSV manually and place it ' +
    'in the output directory for offline merging.'
  )
  return { rows: [], available: false }
}

// ─── CSV writers ──────────────────────────────────────────────────────────────

function writeSalesCsv(filePath: string, date: string, rows: SalesRow[]): void {
  const header = toCsvRow(['対象日', '商品番号', '商品名', '注文件数', '販売数量', '売上金額（税込）', '平均単価'])
  const body = rows.map(r =>
    toCsvRow([
      date,
      r.itemNumber,
      r.itemName,
      r.orderCount,
      r.unitsSold,
      r.salesAmount,
      r.unitsSold > 0 ? Math.round(r.salesAmount / r.unitsSold) : 0,
    ])
  )
  fs.writeFileSync(filePath, [header, ...body].join('\n') + '\n', 'utf8')
  console.log(`[output] Wrote sales CSV → ${filePath} (${rows.length} items)`)
}

function writeTrafficCsv(filePath: string, date: string, rows: TrafficRow[], available: boolean): void {
  const header = toCsvRow(['対象日', '商品番号', '商品名', 'アクセス数', 'ユニークビジター数'])
  let body: string[]
  if (!available) {
    body = [toCsvRow([date, 'N/A', 'API未対応 - RMS管理画面よりCSVダウンロードが必要', '', ''])]
  } else {
    body = rows.map(r =>
      toCsvRow([date, r.itemNumber, r.itemName, r.accessCount, r.uniqueVisitors])
    )
  }
  fs.writeFileSync(filePath, [header, ...body].join('\n') + '\n', 'utf8')
  console.log(`[output] Wrote traffic CSV → ${filePath}`)
}

function writeSummaryCsv(
  filePath: string,
  date: string,
  salesRows: SalesRow[],
  trafficRows: TrafficRow[],
  trafficAvailable: boolean,
): void {
  const trafficMap = new Map(trafficRows.map(r => [r.itemNumber, r]))
  const header = toCsvRow([
    '対象日', '商品番号', '商品名', '注文件数', '販売数量',
    '売上金額（税込）', 'アクセス数', 'CVR（%）',
  ])
  const body = salesRows.map(r => {
    const t = trafficMap.get(r.itemNumber)
    const access = t?.accessCount ?? ''
    const cvr = t && t.accessCount > 0
      ? ((r.orderCount / t.accessCount) * 100).toFixed(2)
      : trafficAvailable ? '0.00' : 'N/A'
    return toCsvRow([
      date, r.itemNumber, r.itemName,
      r.orderCount, r.unitsSold, r.salesAmount,
      access, cvr,
    ])
  })
  fs.writeFileSync(filePath, [header, ...body].join('\n') + '\n', 'utf8')
  console.log(`[output] Wrote summary CSV → ${filePath}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Rakuten RMS Daily Report Extractor ===')

  // Validate credentials
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    console.error(
      '\nERROR: Missing Rakuten RMS credentials.\n' +
      'Set the following environment variables before running:\n' +
      '  RAKUTEN_SERVICE_SECRET=<your serviceSecret>\n' +
      '  RAKUTEN_LICENSE_KEY=<your licenseKey>\n\n' +
      'These can be found in the RMS management panel under:\n' +
      '  店舗設定 → システム設定 → API設定\n'
    )
    process.exit(1)
  }

  const { date, start, end } = targetDateRange(process.env.RAKUTEN_TARGET_DATE)
  console.log(`Target date (JST): ${date}`)
  console.log(`Output directory:  ${OUTPUT_DIR}\n`)

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  // Fetch data
  let salesRows: SalesRow[] = []
  let extractionError: string | null = null

  try {
    salesRows = await fetchSales(start, end)
    console.log(`[sales] Aggregated ${salesRows.length} unique items.\n`)
  } catch (err) {
    extractionError = err instanceof Error ? err.message : String(err)
    console.error(`[sales] Extraction failed: ${extractionError}`)
  }

  const { rows: trafficRows, available: trafficAvailable } = await fetchTraffic(date)

  // Write output files
  const salesFile   = path.join(OUTPUT_DIR, `${date}-sales.csv`)
  const trafficFile = path.join(OUTPUT_DIR, `${date}-traffic.csv`)
  const summaryFile = path.join(OUTPUT_DIR, `${date}-summary.csv`)

  if (extractionError) {
    // Write an error-state sales CSV so the run is always traceable
    const errHeader = toCsvRow(['対象日', '商品番号', '商品名', '注文件数', '販売数量', '売上金額（税込）', '平均単価'])
    const errRow    = toCsvRow([date, 'ERROR', extractionError, '', '', '', ''])
    fs.writeFileSync(salesFile, [errHeader, errRow].join('\n') + '\n', 'utf8')
    console.log(`[output] Wrote error-state sales CSV → ${salesFile}`)
  } else {
    writeSalesCsv(salesFile, date, salesRows)
  }

  writeTrafficCsv(trafficFile, date, trafficRows, trafficAvailable)
  writeSummaryCsv(summaryFile, date, salesRows, trafficRows, trafficAvailable)

  // Print console summary
  console.log('\n=== Summary ===')
  console.log(`Date:          ${date}`)
  console.log(`Items sold:    ${salesRows.length}`)
  console.log(`Total orders:  ${salesRows.reduce((s, r) => s + r.orderCount, 0)}`)
  console.log(`Total units:   ${salesRows.reduce((s, r) => s + r.unitsSold, 0)}`)
  console.log(`Total revenue: ¥${salesRows.reduce((s, r) => s + r.salesAmount, 0).toLocaleString('ja-JP')}`)
  console.log(`Traffic data:  ${trafficAvailable ? 'available' : 'not available via API (see traffic CSV for instructions)'}`)

  if (!extractionError && salesRows.length === 0) {
    console.log('\nNOTE: Extraction completed successfully but no orders were found for the target date.')
  }

  console.log('\nDone.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
