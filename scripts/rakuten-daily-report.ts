/**
 * Rakuten RMS Daily Sales & Traffic Report
 *
 * Fetches yesterday's order data via Rakuten RMS Order API v2,
 * aggregates by product item, optionally merges access count data
 * from a manually exported RMS analytics CSV, and writes a daily report CSV.
 *
 * Setup:
 *   Set RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY in .env.local
 *   Run: npm run rakuten:report
 *
 * Access count data:
 *   RMS does not expose an API for per-item access counts.
 *   Download the "商品別アクセス解析" CSV from RMS > アクセス解析,
 *   save it as reports/access-YYYY-MM-DD.csv, then re-run this script
 *   to merge access data into the report.
 */

import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RMS_BASE = 'https://api.rms.rakuten.co.jp'
const REPORTS_DIR = path.resolve(__dirname, '../reports')

function getCredentials() {
  const serviceSecret = process.env.RAKUTEN_SERVICE_SECRET
  const licenseKey = process.env.RAKUTEN_LICENSE_KEY
  if (!serviceSecret || !licenseKey) {
    throw new Error(
      'Missing Rakuten credentials. Set RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY in .env.local'
    )
  }
  return { serviceSecret, licenseKey }
}

function buildAuthHeader(serviceSecret: string, licenseKey: string): string {
  const encoded = Buffer.from(`${serviceSecret}:${licenseKey}`).toString('base64')
  return `ESA ${encoded}`
}

// ---------------------------------------------------------------------------
// Date helpers (JST = UTC+9)
// ---------------------------------------------------------------------------

function getYesterdayJST(): { date: string; start: string; end: string } {
  const now = new Date()
  // Shift to JST
  const jstOffset = 9 * 60 * 60 * 1000
  const jstNow = new Date(now.getTime() + jstOffset)
  const yesterday = new Date(jstNow)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)

  const y = yesterday.getUTCFullYear()
  const m = String(yesterday.getUTCMonth() + 1).padStart(2, '0')
  const d = String(yesterday.getUTCDate()).padStart(2, '0')
  const date = `${y}-${m}-${d}`
  return {
    date,
    start: `${date}T00:00:00+0900`,
    end: `${date}T23:59:59+0900`,
  }
}

// ---------------------------------------------------------------------------
// Rakuten RMS Order API v2 types
// ---------------------------------------------------------------------------

interface SearchOrderRequest {
  dateType: number // 1=受注日, 2=注文確定日
  startDatetime: string
  endDatetime: string
  orderProgressList?: number[] // 100=注文確認待, 200=楽天処理中, 300=発送待ち, 400=変更確定待, 500=発送済, 600=支払手続中, 700=支払済, 800=キャンセル確定待, 900=キャンセル確定
  PaginationRequestModel: {
    requestRecordsAmount: number
    requestPage: number
  }
}

interface SearchOrderResponse {
  MessageModel: { errorCode?: string; message?: string }
  PaginationResponseModel?: {
    total: number
    totalPage: number
    requestPage: number
  }
  orderNumberList?: string[]
}

interface GetOrderRequest {
  orderNumberList: string[]
}

interface OrderItem {
  itemNumber: string
  itemName: string
  unitPrice: number
  units: number
  price: number // unitPrice * units
  manageNumber?: string // 商品管理番号
  selectType?: string
  itemId?: number
}

interface Order {
  orderNumber: string
  orderDatetime: string
  totalPrice: number
  cancelFlag?: number
  packageModelList?: Array<{
    itemModelList?: OrderItem[]
  }>
}

interface GetOrderResponse {
  MessageModel: { errorCode?: string; message?: string }
  orderModelList?: Order[]
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function searchOrders(
  auth: string,
  params: SearchOrderRequest
): Promise<SearchOrderResponse> {
  const res = await fetch(`${RMS_BASE}/es/2.0/order/searchOrder/`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json;charset=utf-8',
    },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    throw new Error(`searchOrder HTTP ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<SearchOrderResponse>
}

async function getOrders(auth: string, orderNumbers: string[]): Promise<GetOrderResponse> {
  const res = await fetch(`${RMS_BASE}/es/2.0/order/getOrder/`, {
    method: 'POST',
    headers: {
      Authorization: auth,
      'Content-Type': 'application/json;charset=utf-8',
    },
    body: JSON.stringify({ orderNumberList: orderNumbers } as GetOrderRequest),
  })
  if (!res.ok) {
    throw new Error(`getOrder HTTP ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<GetOrderResponse>
}

// ---------------------------------------------------------------------------
// Aggregate sales by item
// ---------------------------------------------------------------------------

interface SalesSummary {
  itemNumber: string
  itemName: string
  orderCount: number
  unitsSold: number
  revenue: number
}

function aggregateSales(orders: Order[]): Map<string, SalesSummary> {
  const map = new Map<string, SalesSummary>()

  for (const order of orders) {
    // Skip cancelled orders
    if (order.cancelFlag === 1) continue

    for (const pkg of order.packageModelList ?? []) {
      for (const item of pkg.itemModelList ?? []) {
        const key = item.itemNumber || item.manageNumber || item.itemName
        const existing = map.get(key)
        const revenue = item.price ?? item.unitPrice * item.units
        if (existing) {
          existing.unitsSold += item.units
          existing.revenue += revenue
          // Count distinct orders that include this item
          existing.orderCount += 1
        } else {
          map.set(key, {
            itemNumber: item.itemNumber || item.manageNumber || '',
            itemName: item.itemName,
            orderCount: 1,
            unitsSold: item.units,
            revenue,
          })
        }
      }
    }
  }

  return map
}

// ---------------------------------------------------------------------------
// Access count CSV loader
// ---------------------------------------------------------------------------

// Expected columns from RMS アクセス解析 CSV export (may vary by export type):
//   商品管理番号, 商品名, 閲覧数, ユニーク閲覧数, カート投入数, カート投入ユニーク数
interface AccessRow {
  itemNumber: string
  pageViews: number
  uniqueVisitors: number
  cartAdds: number
}

function loadAccessCSV(filePath: string): Map<string, AccessRow> {
  const map = new Map<string, AccessRow>()
  if (!fs.existsSync(filePath)) return map

  const raw = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n').filter(Boolean)
  if (lines.length < 2) return map

  // Detect header row (first non-empty line)
  const headers = lines[0].split(',').map((h: string) => h.trim().replace(/^"|"$/g, ''))

  const idx = {
    itemNumber: headers.findIndex((h: string) => h.includes('商品管理番号') || h.toLowerCase() === 'item_number'),
    itemName: headers.findIndex((h: string) => h.includes('商品名')),
    pageViews: headers.findIndex((h: string) => h.includes('閲覧数') && !h.includes('ユニーク')),
    uniqueVisitors: headers.findIndex((h: string) => h.includes('ユニーク閲覧')),
    cartAdds: headers.findIndex((h: string) => h.includes('カート投入数') && !h.includes('ユニーク')),
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c: string) => c.trim().replace(/^"|"$/g, ''))
    const itemNumber = idx.itemNumber >= 0 ? cols[idx.itemNumber] : ''
    if (!itemNumber) continue
    map.set(itemNumber, {
      itemNumber,
      pageViews: idx.pageViews >= 0 ? parseInt(cols[idx.pageViews] || '0', 10) : 0,
      uniqueVisitors: idx.uniqueVisitors >= 0 ? parseInt(cols[idx.uniqueVisitors] || '0', 10) : 0,
      cartAdds: idx.cartAdds >= 0 ? parseInt(cols[idx.cartAdds] || '0', 10) : 0,
    })
  }

  console.log(`  Loaded ${map.size} rows from access CSV: ${filePath}`)
  return map
}

// ---------------------------------------------------------------------------
// CSV writer
// ---------------------------------------------------------------------------

function escapeCsv(value: string | number): string {
  const s = String(value)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function writeCsv(filePath: string, rows: Record<string, string | number>[]): void {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((h: string) => escapeCsv(row[h])).join(',')),
  ]
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf-8')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Load .env.local if running outside Next.js
  const envPath = path.resolve(__dirname, '../.env.local')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)="?([^"]*)"?$/)
      if (match) process.env[match[1]] = match[2]
    }
  }

  const { serviceSecret, licenseKey } = getCredentials()
  const auth = buildAuthHeader(serviceSecret, licenseKey)
  const { date, start, end } = getYesterdayJST()

  console.log(`\nRakuten RMS Daily Report — ${date}`)
  console.log('='.repeat(50))

  // Ensure output directory exists
  fs.mkdirSync(REPORTS_DIR, { recursive: true })

  // -------------------------------------------------------------------------
  // Step 1: Search orders for yesterday
  // -------------------------------------------------------------------------
  console.log('\n[1/4] Searching orders...')

  let allOrderNumbers: string[] = []
  let page = 1
  let totalPages = 1

  do {
    const searchReq: SearchOrderRequest = {
      dateType: 1, // 受注日
      startDatetime: start,
      endDatetime: end,
      // Exclude already-cancelled orders at search level
      orderProgressList: [100, 200, 300, 400, 500, 600, 700],
      PaginationRequestModel: {
        requestRecordsAmount: 100,
        requestPage: page,
      },
    }

    const searchRes = await searchOrders(auth, searchReq)

    if (searchRes.MessageModel?.errorCode && searchRes.MessageModel.errorCode !== '0') {
      throw new Error(
        `searchOrder error ${searchRes.MessageModel.errorCode}: ${searchRes.MessageModel.message}`
      )
    }

    const nums = searchRes.orderNumberList ?? []
    allOrderNumbers = allOrderNumbers.concat(nums)

    if (searchRes.PaginationResponseModel) {
      totalPages = searchRes.PaginationResponseModel.totalPage
      console.log(
        `  Page ${page}/${totalPages} — ${nums.length} orders (total: ${searchRes.PaginationResponseModel.total})`
      )
    }

    page++
  } while (page <= totalPages)

  if (allOrderNumbers.length === 0) {
    console.log('  No orders found for yesterday.')
  } else {
    console.log(`  Found ${allOrderNumbers.length} orders total.`)
  }

  // -------------------------------------------------------------------------
  // Step 2: Fetch order details in batches of 100
  // -------------------------------------------------------------------------
  console.log('\n[2/4] Fetching order details...')

  const allOrders: Order[] = []

  if (allOrderNumbers.length > 0) {
    const BATCH = 100
    for (let i = 0; i < allOrderNumbers.length; i += BATCH) {
      const batch = allOrderNumbers.slice(i, i + BATCH)
      const getRes = await getOrders(auth, batch)

      if (getRes.MessageModel?.errorCode && getRes.MessageModel.errorCode !== '0') {
        throw new Error(
          `getOrder error ${getRes.MessageModel.errorCode}: ${getRes.MessageModel.message}`
        )
      }

      const fetched = getRes.orderModelList ?? []
      allOrders.push(...fetched)
      console.log(`  Batch ${Math.floor(i / BATCH) + 1}: fetched ${fetched.length} orders`)
    }
  }

  console.log(`  Total orders with detail: ${allOrders.length}`)

  // -------------------------------------------------------------------------
  // Step 3: Aggregate sales by item
  // -------------------------------------------------------------------------
  console.log('\n[3/4] Aggregating sales by product...')

  const salesMap = aggregateSales(allOrders)
  console.log(`  Unique products sold: ${salesMap.size}`)

  // -------------------------------------------------------------------------
  // Step 4: Load access count CSV (optional) and build report
  // -------------------------------------------------------------------------
  console.log('\n[4/4] Loading access data and building report...')

  const accessCsvPath = path.join(REPORTS_DIR, `access-${date}.csv`)
  const accessMap = loadAccessCSV(accessCsvPath)

  if (accessMap.size === 0) {
    console.log(
      `  Access data not found. To include it:\n` +
        `  1. Go to RMS > アクセス解析 > 商品別アクセス数\n` +
        `  2. Set date range to ${date}\n` +
        `  3. Export CSV and save as: reports/access-${date}.csv\n` +
        `  4. Re-run: npm run rakuten:report`
    )
  }

  // Merge all known item numbers (from both sales and access data)
  const allItemNumbers = new Set([...salesMap.keys(), ...accessMap.keys()])

  const reportRows = [...allItemNumbers].map((itemNumber) => {
    const sales = salesMap.get(itemNumber)
    const access = accessMap.get(itemNumber)
    return {
      date,
      item_number: itemNumber,
      item_name: sales?.itemName ?? access?.itemNumber ?? itemNumber,
      order_count: sales?.orderCount ?? 0,
      units_sold: sales?.unitsSold ?? 0,
      revenue_jpy: sales?.revenue ?? 0,
      page_views: access?.pageViews ?? '',
      unique_visitors: access?.uniqueVisitors ?? '',
      cart_adds: access?.cartAdds ?? '',
      conversion_rate:
        access?.pageViews && sales?.orderCount
          ? ((sales.orderCount / access.pageViews) * 100).toFixed(2) + '%'
          : '',
    }
  })

  // Sort by revenue descending
  reportRows.sort((a, b) => (b.revenue_jpy as number) - (a.revenue_jpy as number))

  // -------------------------------------------------------------------------
  // Write report CSV
  // -------------------------------------------------------------------------
  const outputPath = path.join(REPORTS_DIR, `rakuten-daily-${date}.csv`)
  writeCsv(outputPath, reportRows)

  // -------------------------------------------------------------------------
  // Print summary table to console
  // -------------------------------------------------------------------------
  console.log(`\n${'='.repeat(80)}`)
  console.log(`RAKUTEN DAILY REPORT  ${date}`)
  console.log('='.repeat(80))

  if (reportRows.length === 0) {
    console.log('No data available for this date.')
  } else {
    console.log(
      [
        'item_number'.padEnd(24),
        'item_name'.padEnd(30),
        'units'.padStart(6),
        'revenue'.padStart(10),
        'views'.padStart(8),
        'CVR'.padStart(7),
      ].join('  ')
    )
    console.log('-'.repeat(90))

    for (const row of reportRows) {
      const name = String(row.item_name).slice(0, 29).padEnd(30)
      const num = String(row.item_number).padEnd(24)
      console.log(
        [
          num,
          name,
          String(row.units_sold).padStart(6),
          `¥${Number(row.revenue_jpy).toLocaleString()}`.padStart(10),
          String(row.page_views).padStart(8),
          String(row.conversion_rate).padStart(7),
        ].join('  ')
      )
    }

    const totalUnits = reportRows.reduce((s, r) => s + (r.units_sold as number), 0)
    const totalRevenue = reportRows.reduce((s, r) => s + (r.revenue_jpy as number), 0)
    console.log('-'.repeat(90))
    console.log(
      [
        'TOTAL'.padEnd(56),
        String(totalUnits).padStart(6),
        `¥${totalRevenue.toLocaleString()}`.padStart(10),
      ].join('  ')
    )
  }

  console.log(`\nReport saved to: ${outputPath}`)

  // Write extraction log
  const logPath = path.join(REPORTS_DIR, 'extraction-log.jsonl')
  const logEntry = {
    timestamp: new Date().toISOString(),
    date,
    ordersFound: allOrderNumbers.length,
    uniqueProducts: salesMap.size,
    accessDataLoaded: accessMap.size > 0,
    outputFile: path.basename(outputPath),
    status: 'success',
  }
  fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf-8')
  console.log(`Extraction logged to: ${logPath}\n`)
}

main().catch((err) => {
  console.error('\nExtraction failed:', err.message)

  // Write failure to log
  const logPath = path.join(REPORTS_DIR, 'extraction-log.jsonl')
  const logEntry = {
    timestamp: new Date().toISOString(),
    status: 'error',
    error: err.message,
  }
  try {
    fs.mkdirSync(REPORTS_DIR, { recursive: true })
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n', 'utf-8')
    console.error(`Error logged to: ${logPath}`)
  } catch {
    // ignore log write failure
  }
  process.exit(1)
})
