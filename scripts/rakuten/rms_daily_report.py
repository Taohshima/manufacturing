#!/usr/bin/env python3
"""
Rakuten RMS Daily Sales & Traffic Report
Fetches yesterday's sales-by-product and access-count-by-product from Rakuten RMS APIs.

Required environment variables:
  RAKUTEN_SERVICE_SECRET   - serviceSecret from RMS > 店舗設定 > システム設定 > API設定
  RAKUTEN_LICENSE_KEY      - licenseKey  from RMS > 店舗設定 > システム設定 > API設定

Optional:
  RAKUTEN_REPORT_DATE      - Override date (YYYY-MM-DD). Defaults to yesterday (JST).
  RAKUTEN_OUTPUT_DIR       - Output directory. Defaults to ./reports/rakuten
"""

import base64
import csv
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

JST = timezone(timedelta(hours=9), "JST")

SERVICE_SECRET = os.getenv("RAKUTEN_SERVICE_SECRET", "")
LICENSE_KEY = os.getenv("RAKUTEN_LICENSE_KEY", "")
REPORT_DATE_STR = os.getenv("RAKUTEN_REPORT_DATE", "")

DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parents[2] / "reports" / "rakuten"
OUTPUT_DIR = Path(os.getenv("RAKUTEN_OUTPUT_DIR", DEFAULT_OUTPUT_DIR))

RMS_API_BASE = "https://api.rms.rakuten.co.jp"

# Order status codes to include (受注 → 発送完了)
# 100=注文確認待ち, 200=楽天確認中, 300=発送待ち, 400=変更確定待ち,
# 500=発送済, 600=支払手続中, 700=支払済, 800=キャンセル確定待ち, 900=キャンセル確定
ORDER_STATUS_INCLUDE = [100, 200, 300, 400, 500, 600, 700]


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _auth_header(service_secret: str, license_key: str) -> str:
    token = base64.b64encode(f"{service_secret}:{license_key}".encode()).decode()
    return f"ESA {token}"


def _session(service_secret: str, license_key: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Authorization": _auth_header(service_secret, license_key),
        "Content-Type": "application/json; charset=utf-8",
    })
    return s


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------

def report_date(date_str: str) -> datetime:
    if date_str:
        return datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=JST)
    yesterday = datetime.now(JST) - timedelta(days=1)
    return yesterday.replace(hour=0, minute=0, second=0, microsecond=0)


def day_range(day: datetime) -> tuple[str, str]:
    start = day.replace(hour=0, minute=0, second=0)
    end = day.replace(hour=23, minute=59, second=59)
    fmt = "%Y-%m-%dT%H:%M:%S+0900"
    return start.strftime(fmt), end.strftime(fmt)


# ---------------------------------------------------------------------------
# Sales data  (Order Search API v2.0)
# ---------------------------------------------------------------------------

def fetch_orders(session: requests.Session, start: str, end: str) -> list[dict]:
    """Fetch all orders for the given day range, paginating as needed."""
    url = f"{RMS_API_BASE}/es/2.0/order/searchOrder"
    all_orders: list[dict] = []
    offset = 0
    page_limit = 100

    while True:
        payload = {
            "dateRangeValue": 1,                    # 1 = 注文日
            "startDatetime": start,
            "endDatetime": end,
            "orderProgressList": ORDER_STATUS_INCLUDE,
            "PagingConditionItem": {
                "pageLimit": page_limit,
                "offset": offset,
            },
        }
        resp = session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        error_code = data.get("MessageModelList", [{}])[0].get("messageType", "")
        if error_code == "E":
            msg = data.get("MessageModelList", [{}])[0].get("message", "Unknown error")
            raise RuntimeError(f"Order API error: {msg}")

        orders = data.get("orderNumberList", []) or []
        # searchOrder returns order numbers; we then fetch details
        if not orders:
            break
        all_orders.extend(orders)

        paging = data.get("PaginationOutputModel", {})
        total = paging.get("totalRecordsFound", 0)
        offset += page_limit
        if offset >= total:
            break

    return all_orders


def fetch_order_details(session: requests.Session, order_numbers: list[str]) -> list[dict]:
    """Fetch detailed order data in batches of 100."""
    url = f"{RMS_API_BASE}/es/2.0/order/getOrder"
    details: list[dict] = []

    for i in range(0, len(order_numbers), 100):
        batch = order_numbers[i:i + 100]
        payload = {"orderNumberList": batch}
        resp = session.post(url, json=payload, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        orders = data.get("OrderModelList", []) or []
        details.extend(orders)

    return details


def aggregate_sales(order_details: list[dict]) -> list[dict]:
    """Aggregate order line items into per-product sales totals."""
    totals: dict[str, dict] = defaultdict(lambda: {
        "item_id": "",
        "item_name": "",
        "order_count": 0,
        "units_sold": 0,
        "gross_sales": 0,
    })

    for order in order_details:
        for package in order.get("PackageModelList", []):
            for item in package.get("ItemModelList", []):
                item_id = item.get("itemId", "") or item.get("manageNumber", "")
                key = item_id or item.get("itemName", "UNKNOWN")
                row = totals[key]
                row["item_id"] = item_id
                row["item_name"] = item.get("itemName", "")
                row["order_count"] += 1
                row["units_sold"] += int(item.get("units", 0) or 0)
                unit_price = float(item.get("price", 0) or 0)
                units = int(item.get("units", 0) or 0)
                row["gross_sales"] += unit_price * units

    return sorted(totals.values(), key=lambda x: x["gross_sales"], reverse=True)


# ---------------------------------------------------------------------------
# Access data  (Item Statistics / Access Statistics API)
# ---------------------------------------------------------------------------

def fetch_access_stats(session: requests.Session, date: datetime) -> list[dict]:
    """
    Attempt to fetch per-item access counts from the RMS Statistics API.
    Rakuten exposes this via /es/1.0/statistic/getAccessStatistics (undocumented for some plans).
    Falls back to an empty list with a warning if unavailable.
    """
    date_str = date.strftime("%Y%m%d")
    url = f"{RMS_API_BASE}/es/1.0/statistic/getAccessStatistics"
    params = {
        "dateType": "day",
        "startDate": date_str,
        "endDate": date_str,
        "statisticType": "item",
    }

    try:
        resp = session.get(url, params=params, timeout=30)
        if resp.status_code == 404:
            print("[WARN] Access Statistics API returned 404 — endpoint may not be enabled for this shop plan.")
            return []
        if resp.status_code == 401:
            print("[WARN] Access Statistics API returned 401 — check credentials / API permissions.")
            return []
        resp.raise_for_status()
        data = resp.json()
        return _parse_access_response(data)
    except requests.RequestException as exc:
        print(f"[WARN] Access Statistics API request failed: {exc}")
        return []


def _parse_access_response(data: dict) -> list[dict]:
    rows = []
    for entry in data.get("itemStatisticModelList", []) or []:
        rows.append({
            "item_id": entry.get("itemUrl", "") or entry.get("itemId", ""),
            "item_name": entry.get("itemName", ""),
            "page_views": int(entry.get("pageView", 0) or 0),
            "visitors": int(entry.get("visitor", 0) or 0),
            "add_to_cart": int(entry.get("addToCart", 0) or 0),
        })
    return sorted(rows, key=lambda x: x["page_views"], reverse=True)


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------

def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Wrote {len(rows)} rows → {path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    # ---- Credential check --------------------------------------------------
    if not SERVICE_SECRET or not LICENSE_KEY:
        missing = []
        if not SERVICE_SECRET:
            missing.append("RAKUTEN_SERVICE_SECRET")
        if not LICENSE_KEY:
            missing.append("RAKUTEN_LICENSE_KEY")
        print("=" * 60)
        print("Rakuten RMS Daily Report — CREDENTIALS MISSING")
        print("=" * 60)
        print(f"\nMissing environment variable(s): {', '.join(missing)}")
        print("\nTo run this report, set:")
        print("  export RAKUTEN_SERVICE_SECRET='your-service-secret'")
        print("  export RAKUTEN_LICENSE_KEY='your-license-key'")
        print("\nThese can be found in Rakuten RMS:")
        print("  店舗設定 > システム設定 > RMS Web Service > serviceSecret / licenseKey")
        print("\nExtraction attempted — no data retrieved due to missing credentials.")
        # Write a stub CSV so the run is traceable
        day = report_date(REPORT_DATE_STR)
        date_label = day.strftime("%Y-%m-%d")
        stub_path = OUTPUT_DIR / date_label / "extraction_log.txt"
        stub_path.parent.mkdir(parents=True, exist_ok=True)
        stub_path.write_text(
            f"Extraction attempted: {datetime.now(JST).isoformat()}\n"
            f"Target date: {date_label}\n"
            f"Result: FAILED — missing credentials ({', '.join(missing)})\n",
            encoding="utf-8",
        )
        print(f"\nExtraction log written to: {stub_path}")
        return 1

    # ---- Date range --------------------------------------------------------
    day = report_date(REPORT_DATE_STR)
    date_label = day.strftime("%Y-%m-%d")
    start_dt, end_dt = day_range(day)

    print("=" * 60)
    print(f"Rakuten RMS Daily Report  [{date_label}]")
    print("=" * 60)
    print(f"Order window : {start_dt} → {end_dt}")

    session = _session(SERVICE_SECRET, LICENSE_KEY)

    # ---- Step 1: Sales by product ------------------------------------------
    print("\n[1/3] Fetching order numbers...")
    try:
        order_numbers = fetch_orders(session, start_dt, end_dt)
        print(f"  Found {len(order_numbers)} orders")

        if order_numbers:
            print("[2/3] Fetching order details...")
            order_details = fetch_order_details(session, order_numbers)
            sales_rows = aggregate_sales(order_details)
        else:
            sales_rows = []
            print("  No orders found for this date.")
    except Exception as exc:
        print(f"[ERROR] Sales fetch failed: {exc}")
        sales_rows = []

    # ---- Step 2: Access / traffic by product --------------------------------
    print("[3/3] Fetching access statistics...")
    access_rows = fetch_access_stats(session, day)
    if not access_rows:
        print("  No access data returned (see WARN above if applicable).")

    # ---- Step 3: Merge into combined summary --------------------------------
    sales_by_id = {r["item_id"]: r for r in sales_rows}
    access_by_id = {r["item_id"]: r for r in access_rows}
    all_ids = sorted(set(sales_by_id) | set(access_by_id))

    combined_rows = []
    for item_id in all_ids:
        s = sales_by_id.get(item_id, {})
        a = access_by_id.get(item_id, {})
        combined_rows.append({
            "date": date_label,
            "item_id": item_id,
            "item_name": s.get("item_name") or a.get("item_name", ""),
            "order_count": s.get("order_count", 0),
            "units_sold": s.get("units_sold", 0),
            "gross_sales": round(s.get("gross_sales", 0), 0),
            "page_views": a.get("page_views", 0),
            "visitors": a.get("visitors", 0),
            "add_to_cart": a.get("add_to_cart", 0),
            "conversion_rate_pct": round(
                s.get("order_count", 0) / a["visitors"] * 100, 2
            ) if a.get("visitors") else "",
        })

    # Sort by gross_sales desc, then page_views desc
    combined_rows.sort(key=lambda x: (-(x["gross_sales"] or 0), -(x["page_views"] or 0)))

    # ---- Step 4: Write CSV files -------------------------------------------
    out_dir = OUTPUT_DIR / date_label
    print(f"\nWriting output to: {out_dir}")

    write_csv(
        out_dir / "sales_by_product.csv",
        sales_rows,
        ["item_id", "item_name", "order_count", "units_sold", "gross_sales"],
    )
    write_csv(
        out_dir / "access_by_product.csv",
        access_rows,
        ["item_id", "item_name", "page_views", "visitors", "add_to_cart"],
    )
    write_csv(
        out_dir / "combined_summary.csv",
        combined_rows,
        ["date", "item_id", "item_name",
         "order_count", "units_sold", "gross_sales",
         "page_views", "visitors", "add_to_cart", "conversion_rate_pct"],
    )

    # ---- Console summary ---------------------------------------------------
    print("\n" + "=" * 60)
    print(f"SUMMARY  [{date_label}]")
    print("=" * 60)
    total_orders = sum(r["order_count"] for r in combined_rows)
    total_units = sum(r["units_sold"] for r in combined_rows)
    total_sales = sum(r["gross_sales"] or 0 for r in combined_rows)
    total_pv = sum(r["page_views"] or 0 for r in combined_rows)
    print(f"  Total orders  : {total_orders}")
    print(f"  Total units   : {total_units}")
    print(f"  Gross sales   : ¥{total_sales:,.0f}")
    print(f"  Total PV      : {total_pv}")
    print(f"  Products sold : {len(sales_rows)}")
    print(f"  Products w/PV : {len(access_rows)}")

    if combined_rows:
        top = combined_rows[0]
        print(f"\n  Top product by sales:")
        print(f"    {top['item_name'][:40]}  ¥{top['gross_sales']:,.0f}  ({top['order_count']} orders)")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
