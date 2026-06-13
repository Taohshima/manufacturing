/**
 * Rakuten RMS Daily Sales & Traffic Report
 *
 * Fetches yesterday's sales-by-product and access-count-by-product from the
 * Rakuten RMS API, then writes a date-stamped CSV to ./exports/.
 *
 * Required environment variables:
 *   RAKUTEN_SERVICE_SECRET  – RMS API service secret
 *   RAKUTEN_LICENSE_KEY     – RMS API license key
 *   RAKUTEN_SHOP_URL        – Shop URL identifier (e.g. "myshop" from myshop.rakuten.co.jp)
 *
 * Optional:
 *   --date YYYY-MM-DD       – Override target date (default: yesterday JST)
 *
 * Usage:
 *   npm run rakuten:daily
 *   npm run rakuten:daily -- --date 2026-06-12
 *
 * API references:
 *   Order API:    https://api.rms.rakuten.co.jp/es/2.0/order/searchOrder/
 *   Order Detail: https://api.rms.rakuten.co.jp/es/2.0/order/getOrder/
 *   Access Stats: https://api.rms.rakuten.co.jp/es/2.0/statistic/getItemAccessCount
 */

import * as fs from 'fs'
import * as path from 'path'

// ─── Configuration ────────────────────────────────────────────────────────────

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET
const LICENSE_KEY = process.env.RAKUTEN_LICENSE_KEY
const SHOP_URL = process.env.RAKUTEN_SHOP_URL ?? ''
const BASE_URL = 'https://api.rms.rakuten.co.jp'
const EXPORTS_DIR = path.resolve(process.cwd(), 'exports')

// ─── Types ────────────────────────────────────────────────────────────────────

interface PackageItem {
  itemName: string
  itemId: string
  manageNumber: string
  unitPrice: number
  units: number
  price: number
}

interface PackageModel {
  packageId: number
  PackageItemModelList: PackageItem[]
}

interface OrderModel {
  orderNumber: string
  orderDatetime: string
  totalPrice: number
  PackageModelList: PackageModel[]
}

interface OrderSearchResponse {
  MessageModelList: Array<{ messageType: string; messageCode: string; message: string }>
  PaginationResponseModel: {
    requestRecordsAmount: number
    requestPage: number
    totalRecordsAmount: number
    totalPages: number
  }
  orderNumberList: string[]
}

interface OrderDetailResponse {
  MessageModelList: Array<{ messageType: string; messageCode: string; message: string }>
  OrderModelList: OrderModel[]
}

interface AccessStatItem {
  itemUrl: string
  itemName: string
  accessCount: number
}

interface AccessStatResponse {
  MessageModelList: Array<{ messageType: string; messageCode: string; message: string }>
  itemAccessCountList?: AccessStatItem[]
  data?: AccessStatItem[]
}

interface SalesRow {
  manageNumber: string
  itemId: string
  itemName: string
  unitsSold: number
  revenue: number
  orderCount: number
  accessCount: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAuthHeader(): string {
  const token = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString('base64')
  return `ESA ${token}`
}

/** Returns target date as YYYY-MM-DD in JST, defaulting to yesterday. */
function resolveTargetDate(): string {
  const args = process.argv.slice(2)
  const flagIdx = args.indexOf('--date')
  if (flagIdx !== -1 && args[flagIdx + 1]) {
    const supplied = args[flagIdx + 1]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(supplied)) {
      console.error(`Invalid --date format. Expected YYYY-MM-DD, got: ${supplied}`)
      process.exit(1)
    }
    return supplied
  }
  // Yesterday in JST (UTC+9)
  const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  jstNow.setUTCDate(jstNow.getUTCDate() - 1)
  return jstNow.toISOString().slice(0, 10)
}

function toJSTDatetimeRange(date: string): { start: string; end: string; compact: string } {
  return {
    start: `${date}T00:00:00+0900`,
    end: `${date}T23:59:59+0900`,
    compact: date.replace(/-/g, ''),
  }
}

function escapeCsv(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function rowToCsv(values: Array<string | number | null>): string {
  return values.map(escapeCsv).join(',')
}

// ─── Order API ────────────────────────────────────────────────────────────────

async function fetchOrderNumbers(start: string, end: string): Promise<string[]> {
  const allNumbers: string[] = []
  let page = 1
  let totalPages = 1

  console.log(`  Searching orders from ${start} to ${end} …`)

  while (page <= totalPages) {
    const body = {
      dateType: 1, // 1 = order date
      startDatetime: start,
      endDatetime: end,
      PaginationRequestModel: { requestRecordsAmount: 1000, requestPage: page },
    }

    const res = await fetch(`${BASE_URL}/es/2.0/order/searchOrder/`, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Order search failed (HTTP ${res.status}): ${text}`)
    }

    const data: OrderSearchResponse = await res.json()

    const errors = data.MessageModelList?.filter((m) => m.messageType === 'ERROR') ?? []
    if (errors.length > 0) {
      const msgs = errors.map((e) => `[${e.messageCode}] ${e.message}`).join('; ')
      throw new Error(`Order search API error: ${msgs}`)
    }

    const nums = data.orderNumberList ?? []
    allNumbers.push(...nums)
    totalPages = data.PaginationResponseModel?.totalPages ?? 1
    console.log(`    Page ${page}/${totalPages}: ${nums.length} orders`)
    page++
  }

  return allNumbers
}

async function fetchOrderDetails(orderNumbers: string[]): Promise<OrderModel[]> {
  if (orderNumbers.length === 0) return []

  const CHUNK = 100
  const allOrders: OrderModel[] = []

  for (let i = 0; i < orderNumbers.length; i += CHUNK) {
    const chunk = orderNumbers.slice(i, i + CHUNK)
    console.log(`  Fetching order details ${i + 1}–${i + chunk.length} of ${orderNumbers.length} …`)

    const res = await fetch(`${BASE_URL}/es/2.0/order/getOrder/`, {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({ orderNumberList: chunk, version: 2 }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Order detail fetch failed (HTTP ${res.status}): ${text}`)
    }

    const data: OrderDetailResponse = await res.json()

    const errors = data.MessageModelList?.filter((m) => m.messageType === 'ERROR') ?? []
    if (errors.length > 0) {
      const msgs = errors.map((e) => `[${e.messageCode}] ${e.message}`).join('; ')
      throw new Error(`Order detail API error: ${msgs}`)
    }

    allOrders.push(...(data.OrderModelList ?? []))
  }

  return allOrders
}

function aggregateSales(orders: OrderModel[]): Map<string, SalesRow> {
  const map = new Map<string, SalesRow>()

  for (const order of orders) {
    const seenInOrder = new Set<string>()

    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.PackageItemModelList ?? []) {
        const key = item.manageNumber || item.itemId || item.itemName
        seenInOrder.add(key)

        const existing = map.get(key)
        if (existing) {
          existing.unitsSold += item.units ?? 0
          existing.revenue += item.price ?? 0
        } else {
          map.set(key, {
            manageNumber: item.manageNumber ?? '',
            itemId: item.itemId ?? '',
            itemName: item.itemName ?? '',
            unitsSold: item.units ?? 0,
            revenue: item.price ?? 0,
            orderCount: 0,
            accessCount: null,
          })
        }
      }
    }

    // Count each order once per SKU it contained
    for (const key of seenInOrder) {
      const row = map.get(key)
      if (row) row.orderCount++
    }
  }

  return map
}

// ─── Access Statistics API ────────────────────────────────────────────────────

/**
 * Fetches item-level access counts for the given date.
 *
 * Rakuten RMS provides access statistics via the Statistics API.
 * The exact endpoint path may vary by shop configuration — check the
 * RMS API portal (https://rms.rakuten.co.jp) for your shop's API settings.
 *
 * Returns null if the API is unavailable or not configured.
 */
async function fetchAccessStats(compact: string): Promise<Map<string, number> | null> {
  const endpoints = [
    `/es/2.0/statistic/getItemAccessCount?shopUrl=${encodeURIComponent(SHOP_URL)}&dateFrom=${compact}&dateTo=${compact}`,
    `/es/2.0/statistic/getItemAccessCount?dateFrom=${compact}&dateTo=${compact}`,
    `/es/stats/item-access-count?dateFrom=${compact}&dateTo=${compact}`,
  ]

  for (const endpoint of endpoints) {
    try {
      console.log(`  Trying access stats endpoint: ${endpoint} …`)
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: 'GET',
        headers: { Authorization: getAuthHeader() },
      })

      if (res.status === 404 || res.status === 405) {
        console.log(`    → Endpoint not found (${res.status}), trying next …`)
        continue
      }

      if (!res.ok) {
        const text = await res.text()
        console.warn(`    → HTTP ${res.status}: ${text.slice(0, 200)}`)
        continue
      }

      const data: AccessStatResponse = await res.json()

      const errors = data.MessageModelList?.filter((m) => m.messageType === 'ERROR') ?? []
      if (errors.length > 0) {
        const msgs = errors.map((e) => `[${e.messageCode}] ${e.message}`).join('; ')
        console.warn(`    → API error: ${msgs}`)
        continue
      }

      const items: AccessStatItem[] = data.itemAccessCountList ?? data.data ?? []
      if (items.length === 0) {
        console.log('    → No access data returned for this date.')
        return new Map()
      }

      const accessMap = new Map<string, number>()
      for (const item of items) {
        accessMap.set(item.itemUrl ?? item.itemName, item.accessCount ?? 0)
      }
      console.log(`    → ${accessMap.size} items with access data.`)
      return accessMap
    } catch (err) {
      console.warn(`    → Request error: ${(err as Error).message}`)
    }
  }

  console.warn('  Access statistics API unavailable — column will be empty in CSV.')
  return null
}

// ─── CSV Output ───────────────────────────────────────────────────────────────

function buildCsvContent(
  rows: SalesRow[],
  date: string,
  salesOk: boolean,
  accessOk: boolean
): string {
  const lines: string[] = []

  // Metadata header
  lines.push(`# Rakuten RMS Daily Report`)
  lines.push(`# Date: ${date}`)
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push(`# Shop: ${SHOP_URL || '(not set)'}`)
  lines.push(`# Sales data: ${salesOk ? 'OK' : 'UNAVAILABLE'}`)
  lines.push(`# Access data: ${accessOk ? 'OK' : 'UNAVAILABLE'}`)
  lines.push('')

  // Column headers
  const headers = [
    '管理番号 (manageNumber)',
    '商品ID (itemId)',
    '商品名 (itemName)',
    '販売数 (unitsSold)',
    '売上金額 (revenue)',
    '注文件数 (orderCount)',
    'アクセス数 (accessCount)',
  ]
  lines.push(headers.join(','))

  if (rows.length === 0) {
    lines.push('# No data for this date.')
  } else {
    for (const row of rows) {
      lines.push(
        rowToCsv([
          row.manageNumber,
          row.itemId,
          row.itemName,
          row.unitsSold,
          row.revenue,
          row.orderCount,
          row.accessCount,
        ])
      )
    }
  }

  return lines.join('\n') + '\n'
}

function writeCsv(date: string, content: string): string {
  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true })
  }
  const filename = `rakuten-daily-${date}.csv`
  const filepath = path.join(EXPORTS_DIR, filename)
  fs.writeFileSync(filepath, content, 'utf8')
  return filepath
}

// ─── Summary Table ────────────────────────────────────────────────────────────

function printSummaryTable(rows: SalesRow[], date: string): void {
  console.log('')
  console.log(`╔═══════════════════════════════════════════════════════════════╗`)
  console.log(`║  Rakuten RMS Daily Summary — ${date}                    ║`)
  console.log(`╠═══════════════════════════════╤═══════════╤══════════╤════════╣`)
  console.log(`║ 商品名                        │ 販売数    │ 売上     │ アクセス║`)
  console.log(`╠═══════════════════════════════╪═══════════╪══════════╪════════╣`)

  if (rows.length === 0) {
    console.log(`║ (データなし)                  │           │          │        ║`)
  } else {
    const sorted = [...rows].sort((a, b) => b.revenue - a.revenue)
    for (const row of sorted.slice(0, 20)) {
      const name = row.itemName.slice(0, 29).padEnd(29)
      const units = String(row.unitsSold).padStart(9)
      const rev = `¥${row.revenue.toLocaleString('ja-JP')}`.padStart(8)
      const access = row.accessCount === null ? '    N/A ' : String(row.accessCount).padStart(8)
      console.log(`║ ${name} │ ${units} │ ${rev} │ ${access}║`)
    }
    if (sorted.length > 20) {
      console.log(`║ … ${sorted.length - 20} more rows (see CSV)        │           │          │        ║`)
    }
  }

  console.log(`╠═══════════════════════════════╧═══════════╧══════════╧════════╣`)

  const totalUnits = rows.reduce((s, r) => s + r.unitsSold, 0)
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0)
  const totalAccess = rows.every((r) => r.accessCount === null)
    ? 'N/A'
    : rows.reduce((s, r) => s + (r.accessCount ?? 0), 0).toLocaleString('ja-JP')

  console.log(`║ 合計  ${String(rows.length).padStart(3)} SKU                    │ ${String(totalUnits).padStart(9)} │ ¥${String(totalRev.toLocaleString('ja-JP')).padStart(7)} │ ${String(totalAccess).padStart(6)}  ║`)
  console.log(`╚═══════════════════════════════════════════════════════════════╝`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Credential check
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    console.error(
      '\nError: RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY must be set.\n' +
        'Copy .env.example to .env.local and fill in your RMS API credentials.\n'
    )
    process.exit(1)
  }

  const date = resolveTargetDate()
  const { start, end, compact } = toJSTDatetimeRange(date)

  console.log(`\n=== Rakuten RMS Daily Data Extraction ===`)
  console.log(`Target date : ${date} (JST)`)
  console.log(`Shop URL    : ${SHOP_URL || '(not set — access stats may be limited)'}`)
  console.log('')

  // ── 1. Sales data ────────────────────────────────────────────────────────
  console.log('[1/3] Fetching sales data …')
  let salesMap = new Map<string, SalesRow>()
  let salesOk = false

  try {
    const orderNumbers = await fetchOrderNumbers(start, end)
    console.log(`  Total orders found: ${orderNumbers.length}`)

    if (orderNumbers.length > 0) {
      const orders = await fetchOrderDetails(orderNumbers)
      salesMap = aggregateSales(orders)
    }

    salesOk = true
    console.log(`  Aggregated to ${salesMap.size} unique SKUs.`)
  } catch (err) {
    console.error(`  Sales data unavailable: ${(err as Error).message}`)
  }

  // ── 2. Access data ────────────────────────────────────────────────────────
  console.log('\n[2/3] Fetching access statistics …')
  const accessMap = await fetchAccessStats(compact)
  const accessOk = accessMap !== null

  // ── 3. Merge & export ────────────────────────────────────────────────────
  console.log('\n[3/3] Compiling results …')

  // Build final rows: sales rows enriched with access counts
  const finalRows: SalesRow[] = Array.from(salesMap.values())

  if (accessMap) {
    for (const row of finalRows) {
      // Match by itemId, manageNumber, or itemName as fallback keys
      const keys = [row.itemId, row.manageNumber, row.itemName].filter(Boolean)
      for (const key of keys) {
        if (accessMap.has(key)) {
          row.accessCount = accessMap.get(key)!
          break
        }
      }
    }

    // Add access-only rows (items with traffic but no orders)
    for (const [key, count] of accessMap.entries()) {
      const alreadyPresent = finalRows.some(
        (r) => r.itemId === key || r.manageNumber === key || r.itemName === key
      )
      if (!alreadyPresent) {
        finalRows.push({
          manageNumber: '',
          itemId: key,
          itemName: key,
          unitsSold: 0,
          revenue: 0,
          orderCount: 0,
          accessCount: count,
        })
      }
    }
  }

  // Sort by revenue desc, then units desc
  finalRows.sort((a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold)

  const csvContent = buildCsvContent(finalRows, date, salesOk, accessOk)
  const outputPath = writeCsv(date, csvContent)

  printSummaryTable(finalRows, date)

  console.log(`\nOutput saved to: ${outputPath}`)

  if (!salesOk && !accessOk) {
    console.log('\nNote: No data was available. The CSV has been written with metadata only.')
    console.log('      Verify your RAKUTEN_SERVICE_SECRET and RAKUTEN_LICENSE_KEY are correct.')
    process.exit(2)
  }
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
