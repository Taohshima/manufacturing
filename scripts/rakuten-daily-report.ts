#!/usr/bin/env tsx
/**
 * Rakuten RMS daily sales & access report
 *
 * Fetches the previous day's orders from the Rakuten RMS Order API v2.0,
 * aggregates sales by item, and writes a UTF-8 BOM CSV to exports/.
 *
 * Required env vars:
 *   RAKUTEN_SERVICE_SECRET  – RMS Web Service service secret
 *   RAKUTEN_LICENSE_KEY     – RMS Web Service license key
 *
 * Run:
 *   npm run rakuten:daily
 *   npx tsx scripts/rakuten-daily-report.ts
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

// ── Credentials ───────────────────────────────────────────────────────────────

const SERVICE_SECRET = process.env.RAKUTEN_SERVICE_SECRET?.trim()
const LICENSE_KEY    = process.env.RAKUTEN_LICENSE_KEY?.trim()
const EXPORTS_DIR    = join(process.cwd(), 'exports')

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for yesterday in JST (UTC+9). */
function yesterdayJST(): string {
  const now = new Date()
  const jstMs   = now.getTime() + 9 * 60 * 60 * 1000
  const jstDate = new Date(jstMs)
  jstDate.setUTCDate(jstDate.getUTCDate() - 1)
  return jstDate.toISOString().slice(0, 10)
}

// ── API helpers ───────────────────────────────────────────────────────────────

const RMS_BASE = 'https://api.rms.rakuten.co.jp/es'

async function rmsPost(path: string, body: unknown, auth: string): Promise<unknown> {
  const res = await fetch(`${RMS_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `ESA ${auth}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`RMS API ${path} returned ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SearchOrderResponse {
  OrderNumberList?: string[]
  PaginationResponseModel?: { totalRecordsAmount?: number }
  MessageModelList?: Array<{ messageType: string; message: string }>
}

interface ItemModel {
  itemName?:         string
  itemUrl?:          string
  managementNumber?: string
  units?:            number
  price?:            number
}

interface PackageModel {
  ItemModelList?: ItemModel[]
}

interface OrderModel {
  orderNumber?:     string
  PackageModelList?: PackageModel[]
}

interface GetOrderResponse {
  OrderModelList?:  OrderModel[]
  MessageModelList?: Array<{ messageType: string; message: string }>
}

interface ItemSummary {
  itemName:         string
  itemUrl:          string
  managementNumber: string
  quantity:         number
  revenue:          number
  accessCount:      number | null
}

// ── Data extraction ───────────────────────────────────────────────────────────

/** Collects all order numbers for the given JST date (pages automatically). */
async function searchOrders(date: string, auth: string): Promise<string[]> {
  const start = `${date}T00:00:00+0900`
  const end   = `${date}T23:59:59+0900`
  const allNums: string[] = []
  let page = 1

  while (true) {
    const data = (await rmsPost('/2.0/order/searchOrder', {
      dateType: 1, // 1 = order date
      startDatetime: start,
      endDatetime:   end,
      PaginationRequestModel: { requestRecordsAmount: 1000, requestPage: page },
    }, auth)) as SearchOrderResponse

    const msgs = data.MessageModelList ?? []
    for (const m of msgs) {
      if (m.messageType === 'ERROR') throw new Error(`RMS: ${m.message}`)
    }

    const nums = data.OrderNumberList ?? []
    allNums.push(...nums)

    const total = data.PaginationResponseModel?.totalRecordsAmount ?? 0
    if (allNums.length >= total || nums.length === 0) break
    page++
  }

  return allNums
}

/** Fetches full order details in chunks of 100 (RMS API limit). */
async function getOrders(orderNumbers: string[], auth: string): Promise<OrderModel[]> {
  const CHUNK = 100
  const results: OrderModel[] = []

  for (let i = 0; i < orderNumbers.length; i += CHUNK) {
    const chunk = orderNumbers.slice(i, i + CHUNK)
    const data  = (await rmsPost('/2.0/order/getOrder', {
      orderNumberList: chunk,
      version: 2,
    }, auth)) as GetOrderResponse

    const msgs = data.MessageModelList ?? []
    for (const m of msgs) {
      if (m.messageType === 'ERROR') throw new Error(`RMS getOrder: ${m.message}`)
    }

    results.push(...(data.OrderModelList ?? []))
  }

  return results
}

/** Aggregates order details into a per-item summary map. */
function aggregateByItem(orders: OrderModel[]): Map<string, ItemSummary> {
  const map = new Map<string, ItemSummary>()

  for (const order of orders) {
    for (const pkg of order.PackageModelList ?? []) {
      for (const item of pkg.ItemModelList ?? []) {
        const key = item.itemUrl ?? item.managementNumber ?? item.itemName ?? 'unknown'
        const rev = (item.price ?? 0) * (item.units ?? 0)
        const existing = map.get(key)
        if (existing) {
          existing.quantity += item.units ?? 0
          existing.revenue  += rev
        } else {
          map.set(key, {
            itemName:         item.itemName         ?? '',
            itemUrl:          item.itemUrl          ?? '',
            managementNumber: item.managementNumber ?? '',
            quantity:         item.units            ?? 0,
            revenue:          rev,
            accessCount:      null,
            // NOTE: The Rakuten RMS Web Service API does not provide per-item
            // access counts via REST. Retrieve them manually from the RMS
            // console: 統計 > 商品別アクセス数 and merge into this report.
          })
        }
      }
    }
  }

  return map
}

// ── CSV output ────────────────────────────────────────────────────────────────

function escCsv(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

function buildCsv(date: string, items: Map<string, ItemSummary>): string {
  const header = '日付,商品名,商品URL,管理番号,売上数量,売上金額(円),アクセス数'
  const rows   = [header]

  if (items.size === 0) {
    rows.push(`${date},(受注なし),,,,0,N/A`)
  } else {
    for (const s of items.values()) {
      rows.push([
        date,
        escCsv(s.itemName),
        escCsv(s.itemUrl),
        escCsv(s.managementNumber),
        s.quantity,
        s.revenue,
        s.accessCount ?? 'N/A',
      ].join(','))
    }
  }

  return rows.join('\n') + '\n'
}

function writeErrorCsv(date: string, reason: string): void {
  if (!existsSync(EXPORTS_DIR)) mkdirSync(EXPORTS_DIR, { recursive: true })
  const outPath = join(EXPORTS_DIR, `rakuten-daily-${date}.csv`)
  const csv     = `日付,状態,備考\n${date},エラー,${escCsv(reason)}\n`
  writeFileSync(outPath, '﻿' + csv, 'utf-8')
  console.log(`[INFO]  Error report written → ${outPath}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const date = yesterdayJST()
  console.log(`[INFO]  Target date: ${date} (JST)`)

  // Guard: credentials must be set
  if (!SERVICE_SECRET || !LICENSE_KEY) {
    const msg =
      'RAKUTEN_SERVICE_SECRET and/or RAKUTEN_LICENSE_KEY environment variables are not set. ' +
      'Set them in .env and retry.'
    console.error('[ERROR]', msg)
    writeErrorCsv(date, msg)
    process.exit(1)
  }

  const auth = Buffer.from(`${SERVICE_SECRET}:${LICENSE_KEY}`).toString('base64')

  // Step 1: search orders
  console.log('[STEP 1] Searching orders for', date, '…')
  const orderNumbers = await searchOrders(date, auth)
  console.log(`         → ${orderNumbers.length} order(s) found`)

  // Step 2: fetch order details
  let itemMap = new Map<string, ItemSummary>()
  if (orderNumbers.length > 0) {
    console.log('[STEP 2] Fetching order details…')
    const orders = await getOrders(orderNumbers, auth)
    itemMap      = aggregateByItem(orders)
    console.log(`         → ${itemMap.size} distinct item(s) aggregated`)
  } else {
    console.log('[STEP 2] No orders found — skipping detail fetch')
  }

  // Step 3: access counts
  // Rakuten RMS Web Service API (REST) does not expose per-item access counts.
  // They must be downloaded manually from the RMS console:
  //   RMS管理画面 > 統計 > 商品別アクセス数 > CSV出力
  // accessCount is exported as "N/A" until merged manually.
  console.log('[STEP 3] Access counts: not available via RMS REST API')
  console.log('         Retrieve from RMS console: 統計 > 商品別アクセス数 > CSV出力')

  // Step 4: write CSV
  if (!existsSync(EXPORTS_DIR)) mkdirSync(EXPORTS_DIR, { recursive: true })
  const outPath = join(EXPORTS_DIR, `rakuten-daily-${date}.csv`)
  const csv     = buildCsv(date, itemMap)
  writeFileSync(outPath, '﻿' + csv, 'utf-8') // BOM for Excel

  console.log(`\n[DONE]  Report written → ${outPath}`)

  // Print summary
  const totalQty = [...itemMap.values()].reduce((s, v) => s + v.quantity, 0)
  const totalRev = [...itemMap.values()].reduce((s, v) => s + v.revenue, 0)

  console.log('\n=== Daily Report Summary ===')
  console.log(`Date         : ${date}`)
  console.log(`Orders       : ${orderNumbers.length}`)
  console.log(`Items (SKUs) : ${itemMap.size}`)
  console.log(`Total qty    : ${totalQty}`)
  console.log(`Total revenue: ¥${totalRev.toLocaleString('ja-JP')}`)
  console.log(`Access counts: N/A (manual download required)`)
  console.log('============================')
}

main().catch(err => {
  console.error('[ERROR]', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
