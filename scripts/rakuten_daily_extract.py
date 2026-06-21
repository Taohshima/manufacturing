#!/usr/bin/env python3
"""
Rakuten RMS daily sales and traffic data extractor.

Reads credentials from environment variables:
  RAKUTEN_SERVICE_SECRET  - RMS service secret
  RAKUTEN_LICENSE_KEY     - RMS license key

Outputs two CSV files per run:
  data/rakuten_sales_YYYYMMDD.csv   - sales by product (from Order API v2)
  data/rakuten_traffic_YYYYMMDD.csv - access counts by product (from Navigate API)
"""

import os
import sys
import json
import base64
import datetime
import csv
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "https://api.rms.rakuten.co.jp/es"
DATA_DIR = Path(__file__).parent.parent / "data"

# Target date: yesterday (JST)
JST = datetime.timezone(datetime.timedelta(hours=9))
TODAY_JST = datetime.datetime.now(JST).date()
TARGET_DATE = TODAY_JST - datetime.timedelta(days=1)
DATE_STR = TARGET_DATE.strftime("%Y%m%d")
DATE_LABEL = TARGET_DATE.strftime("%Y-%m-%d")

# Order statuses to include (all non-cancelled/non-returned orders)
ORDER_STATUS_LIST = [300, 400, 500, 600, 700, 800, 900]


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def build_auth_header(service_secret: str, license_key: str) -> str:
    token = base64.b64encode(f"{service_secret}:{license_key}".encode()).decode()
    return f"ESA {token}"


def get_credentials() -> tuple[str, str]:
    secret = os.environ.get("RAKUTEN_SERVICE_SECRET", "")
    key = os.environ.get("RAKUTEN_LICENSE_KEY", "")
    return secret, key


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def api_post(path: str, payload: dict, auth: str) -> dict:
    url = BASE_URL + path
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": auth,
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_get(path: str, params: dict, auth: str) -> dict:
    url = BASE_URL + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={"Authorization": auth},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Sales extraction (Order API v2)
# ---------------------------------------------------------------------------

def fetch_orders(auth: str) -> list[dict]:
    """Fetch all orders for TARGET_DATE and return raw order list."""
    start = f"{DATE_LABEL} 00:00:00"
    end = f"{DATE_LABEL} 23:59:59"

    payload = {
        "dateType": 1,
        "startDatetime": start,
        "endDatetime": end,
        "orderProgressList": ORDER_STATUS_LIST,
    }

    print(f"  Calling Order Search API for {DATE_LABEL} ...")
    try:
        resp = api_post("/2.0/order/searchOrder", payload, auth)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Order API HTTP {e.code}: {body}") from e

    error_code = resp.get("errorCode") or resp.get("error_code") or ""
    if error_code:
        raise RuntimeError(f"Order API error: {error_code} - {resp}")

    order_numbers = resp.get("orderNumberList", [])
    if not order_numbers:
        print("  No orders found for the target date.")
        return []

    print(f"  Found {len(order_numbers)} order(s). Fetching details ...")

    # Fetch order details in batches of 100
    orders = []
    batch_size = 100
    for i in range(0, len(order_numbers), batch_size):
        batch = order_numbers[i : i + batch_size]
        detail_resp = api_post(
            "/2.0/order/getOrder",
            {"orderNumberList": batch, "version": 2},
            auth,
        )
        orders.extend(detail_resp.get("orderModelList", []))

    return orders


def aggregate_sales(orders: list[dict]) -> list[dict]:
    """Aggregate orders into per-product sales rows."""
    product_map: dict[str, dict] = {}

    for order in orders:
        for package in order.get("packageModelList", []):
            for item in package.get("itemModelList", []):
                item_id = item.get("itemNumber") or item.get("itemUrl") or "UNKNOWN"
                item_name = item.get("itemName", "")
                unit_price = float(item.get("unitPrice", 0) or 0)
                qty = int(item.get("units", 0) or 0)
                price = float(item.get("price", unit_price * qty) or 0)

                if item_id not in product_map:
                    product_map[item_id] = {
                        "item_number": item_id,
                        "item_name": item_name,
                        "unit_price": unit_price,
                        "quantity_sold": 0,
                        "total_sales_jpy": 0.0,
                        "order_count": 0,
                    }

                product_map[item_id]["quantity_sold"] += qty
                product_map[item_id]["total_sales_jpy"] += price
                product_map[item_id]["order_count"] += 1

    return sorted(
        product_map.values(),
        key=lambda r: r["total_sales_jpy"],
        reverse=True,
    )


def write_sales_csv(rows: list[dict], path: Path) -> None:
    fieldnames = [
        "date",
        "item_number",
        "item_name",
        "unit_price",
        "quantity_sold",
        "total_sales_jpy",
        "order_count",
    ]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({"date": DATE_LABEL, **row})
    print(f"  Saved: {path}")


# ---------------------------------------------------------------------------
# Traffic extraction (Navigate / Item Stats API)
# ---------------------------------------------------------------------------

def fetch_item_access_counts(auth: str, item_numbers: list[str]) -> dict[str, int]:
    """
    Attempt to retrieve per-item access counts via the Navigate API.

    Rakuten RMS exposes daily access counts through the Shop Navigate endpoint.
    The endpoint returns item-level pageview data when available.
    Returns a dict of {item_number: access_count}.
    """
    access_map: dict[str, int] = {}

    # Try Navigate Top Items endpoint (returns top-accessed items for a date range)
    params = {
        "dateType": "day",
        "startDate": DATE_LABEL,
        "endDate": DATE_LABEL,
        "paginationOffset": 0,
        "paginationLimit": 1000,
    }

    print("  Calling Navigate API for access counts ...")
    try:
        resp = api_get("/1.0/navigate/topNavigateItem", params, auth)
        navigate_items = resp.get("navigateItemModelList", [])
        for entry in navigate_items:
            item_no = entry.get("itemNumber") or entry.get("item_number", "")
            count = int(entry.get("access_count", 0) or entry.get("accessCount", 0))
            if item_no:
                access_map[item_no] = count
        print(f"  Navigate API returned {len(access_map)} item(s).")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  WARNING: Navigate API HTTP {e.code}: {body[:200]}")
    except Exception as exc:
        print(f"  WARNING: Navigate API unavailable: {exc}")

    return access_map


def write_traffic_csv(
    item_numbers: list[str],
    item_names: dict[str, str],
    access_map: dict[str, int],
    path: Path,
) -> None:
    # Merge all known items — union of sales items and navigate items
    all_ids = sorted(set(item_numbers) | set(access_map.keys()))

    fieldnames = ["date", "item_number", "item_name", "access_count", "data_source"]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for item_id in all_ids:
            count = access_map.get(item_id)
            source = "Navigate API" if item_id in access_map else "N/A"
            writer.writerow(
                {
                    "date": DATE_LABEL,
                    "item_number": item_id,
                    "item_name": item_names.get(item_id, ""),
                    "access_count": count if count is not None else "",
                    "data_source": source,
                }
            )
    print(f"  Saved: {path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def write_empty_csv(path: Path, note: str) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        f.write(f"# {note}\n")
        f.write(f"date,note\n")
        f.write(f"{DATE_LABEL},{note}\n")
    print(f"  Saved (empty): {path}")


def main() -> int:
    print(f"=== Rakuten RMS Daily Extract — {DATE_LABEL} ===")
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    sales_path = DATA_DIR / f"rakuten_sales_{DATE_STR}.csv"
    traffic_path = DATA_DIR / f"rakuten_traffic_{DATE_STR}.csv"

    # --- Credentials check ---
    service_secret, license_key = get_credentials()
    if not service_secret or not license_key:
        msg = (
            "RAKUTEN_SERVICE_SECRET and/or RAKUTEN_LICENSE_KEY environment "
            "variables are not set. Skipping API calls."
        )
        print(f"ERROR: {msg}")
        write_empty_csv(sales_path, msg)
        write_empty_csv(traffic_path, msg)
        return 1

    auth = build_auth_header(service_secret, license_key)

    # --- Sales ---
    exit_code = 0
    sales_rows: list[dict] = []
    item_names: dict[str, str] = {}

    print("\n[1/2] Sales (Order API v2)")
    try:
        orders = fetch_orders(auth)
        sales_rows = aggregate_sales(orders)
        item_names = {r["item_number"]: r["item_name"] for r in sales_rows}
        if sales_rows:
            print(f"  Aggregated {len(sales_rows)} product(s).")
            write_sales_csv(sales_rows, sales_path)
        else:
            write_empty_csv(sales_path, "No sales orders found for date")
    except RuntimeError as exc:
        print(f"  ERROR: {exc}")
        write_empty_csv(sales_path, str(exc))
        exit_code = 2

    # --- Traffic ---
    print("\n[2/2] Traffic (Navigate API)")
    item_numbers = [r["item_number"] for r in sales_rows]
    access_map = fetch_item_access_counts(auth, item_numbers)
    write_traffic_csv(item_numbers, item_names, access_map, traffic_path)

    # --- Summary ---
    print("\n=== Summary ===")
    print(f"  Date           : {DATE_LABEL}")
    print(f"  Products sold  : {len(sales_rows)}")
    total_qty = sum(r["quantity_sold"] for r in sales_rows)
    total_rev = sum(r["total_sales_jpy"] for r in sales_rows)
    print(f"  Units sold     : {total_qty}")
    print(f"  Total revenue  : ¥{total_rev:,.0f}")
    print(f"  Products w/ access data: {len(access_map)}")
    print(f"  Sales CSV      : {sales_path}")
    print(f"  Traffic CSV    : {traffic_path}")
    print("=== Done ===")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
