#!/usr/bin/env python3
"""
Rakuten RMS daily sales & traffic extractor.

Pulls yesterday's order data (sales by product) from the Rakuten RMS Order
Search API and optionally merges access analytics from a CSV downloaded via
RMS > アクセス分析 > 商品別アクセス分析.

Required environment variables:
  RAKUTEN_SERVICE_SECRET   – RMS APIサービスシークレット
  RAKUTEN_LICENSE_KEY      – RMS APIライセンスキー

Optional:
  RAKUTEN_ACCESS_CSV       – Path to access analytics CSV exported from RMS
                             (if omitted, access columns are left blank)
  RAKUTEN_OUTPUT_DIR       – Directory for output CSV (default: ./data/rakuten)
  RAKUTEN_TARGET_DATE      – Override target date as YYYY-MM-DD (default: yesterday)

Usage:
  python3 scripts/rakuten_rms_extract.py
"""

import base64
import csv
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("requests is required: pip install requests")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

JST = timezone(timedelta(hours=9))
RMS_API_BASE = "https://api.rms.rakuten.co.jp"
ORDER_SEARCH_ENDPOINT = f"{RMS_API_BASE}/es/2.0/order/searchOrder/"

SERVICE_SECRET = os.environ.get("RAKUTEN_SERVICE_SECRET", "")
LICENSE_KEY = os.environ.get("RAKUTEN_LICENSE_KEY", "")
ACCESS_CSV_PATH = os.environ.get("RAKUTEN_ACCESS_CSV", "")
OUTPUT_DIR = Path(os.environ.get("RAKUTEN_OUTPUT_DIR", "data/rakuten"))

_target_env = os.environ.get("RAKUTEN_TARGET_DATE", "")
if _target_env:
    TARGET_DATE = date.fromisoformat(_target_env)
else:
    TARGET_DATE = date.today() - timedelta(days=1)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _auth_header() -> str:
    token = base64.b64encode(f"{SERVICE_SECRET}:{LICENSE_KEY}".encode()).decode()
    return f"ESA {token}"


def _jst_range(d: date) -> tuple[str, str]:
    """Return (start, end) ISO-8601 strings in JST for an entire calendar day."""
    start = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=JST)
    end = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=JST)
    fmt = "%Y-%m-%dT%H:%M:%S+09:00"
    return start.strftime(fmt), end.strftime(fmt)


# ---------------------------------------------------------------------------
# Step 1 – Fetch orders from RMS Order Search API
# ---------------------------------------------------------------------------


def fetch_orders(target: date) -> list[dict]:
    """
    Return a flat list of order-item dicts for all orders placed on *target*.
    Paginates automatically (1 000 records per page).
    """
    if not SERVICE_SECRET or not LICENSE_KEY:
        print("[WARN] RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY not set.")
        print("       Skipping API call – sales data will be empty.")
        return []

    start_dt, end_dt = _jst_range(target)
    headers = {
        "Authorization": _auth_header(),
        "Content-Type": "application/json; charset=utf-8",
    }

    all_items: list[dict] = []
    page = 1

    while True:
        payload = {
            "dateType": 1,            # 1 = 注文日
            "startDatetime": start_dt,
            "endDatetime": end_dt,
            "PaginationRequestModel": {
                "requestRecordsAmount": 1000,
                "requestPage": page,
            },
        }

        try:
            resp = requests.post(
                ORDER_SEARCH_ENDPOINT,
                headers=headers,
                json=payload,
                timeout=30,
            )
        except requests.RequestException as exc:
            print(f"[ERROR] RMS API request failed: {exc}")
            break

        if resp.status_code != 200:
            print(f"[ERROR] RMS API returned {resp.status_code}: {resp.text[:400]}")
            break

        body = resp.json()

        # Surface any RMS-level error codes
        message_model = body.get("MessageModel", {})
        if message_model.get("messageType") == "ERROR":
            print(f"[ERROR] RMS API error: {message_model}")
            break

        order_list = body.get("orderNumberList", []) or []
        # The v2 searchOrder returns orderNumberList; actual details need
        # /order/getOrder/ but some responses embed OrderModelList directly.
        order_models = body.get("OrderModelList", []) or []

        for order in order_models:
            order_number = order.get("orderNumber", "")
            order_date = order.get("orderDatetime", "")[:10]
            for pkg in order.get("packageModelList", []) or []:
                for item in pkg.get("itemModelList", []) or []:
                    all_items.append(
                        {
                            "order_number": order_number,
                            "order_date": order_date,
                            "item_id": item.get("itemId", ""),
                            "item_number": item.get("itemNumber", ""),
                            "item_name": item.get("itemName", ""),
                            "units": int(item.get("units", 0)),
                            "unit_price": int(item.get("unitPrice", 0)),
                            "subtotal": int(item.get("price", 0)),
                        }
                    )

        # Check if there are more pages
        pagination = body.get("PaginationResponseModel", {})
        total_pages = pagination.get("totalPages", 1)
        if page >= total_pages:
            break
        page += 1

    return all_items


# ---------------------------------------------------------------------------
# Step 2 – Aggregate sales by product
# ---------------------------------------------------------------------------


def aggregate_sales(order_items: list[dict]) -> dict[str, dict]:
    """
    Roll up order items to a per-product summary keyed by item_number.
    """
    summary: dict[str, dict] = {}

    for item in order_items:
        key = item["item_number"] or item["item_id"]
        if key not in summary:
            summary[key] = {
                "item_number": key,
                "item_name": item["item_name"],
                "order_count": 0,
                "units_sold": 0,
                "total_sales": 0,
            }
        summary[key]["order_count"] += 1
        summary[key]["units_sold"] += item["units"]
        summary[key]["total_sales"] += item["subtotal"]

    return summary


# ---------------------------------------------------------------------------
# Step 3 – Load access analytics (optional CSV from RMS UI)
# ---------------------------------------------------------------------------
#
# Access analytics are NOT available through the standard RMS REST API.
# To obtain them:
#   RMS > ショップマネージャー > アクセス分析 > 商品別アクセス分析
#   → 日別 → 対象日を選択 → CSVダウンロード
#
# Expected columns (Rakuten standard export):
#   商品番号, 商品名, PV数, ユニークユーザー数, カート投入数
#


def load_access_csv(csv_path: str) -> dict[str, dict]:
    """
    Parse the access analytics CSV from RMS and return a dict keyed by
    item_number (商品番号).
    """
    if not csv_path:
        return {}

    path = Path(csv_path)
    if not path.exists():
        print(f"[WARN] Access CSV not found: {csv_path}")
        return {}

    access: dict[str, dict] = {}
    try:
        with open(path, encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Try common Rakuten column names
                item_no = (
                    row.get("商品番号")
                    or row.get("item_number")
                    or row.get("管理番号")
                    or ""
                ).strip()
                if not item_no:
                    continue
                access[item_no] = {
                    "page_views": _int(row, ["PV数", "page_views", "PV"]),
                    "unique_users": _int(row, ["ユニークユーザー数", "unique_users", "UU数"]),
                    "cart_adds": _int(row, ["カート投入数", "cart_adds"]),
                }
    except Exception as exc:
        print(f"[WARN] Failed to parse access CSV: {exc}")

    return access


def _int(row: dict, keys: list[str]) -> int:
    for k in keys:
        v = row.get(k, "").replace(",", "").strip()
        if v.isdigit():
            return int(v)
    return 0


# ---------------------------------------------------------------------------
# Step 4 – Merge and export
# ---------------------------------------------------------------------------


def export_csv(
    sales: dict[str, dict],
    access: dict[str, dict],
    target: date,
    output_dir: Path,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = output_dir / f"rakuten_daily_{target.strftime('%Y%m%d')}.csv"

    all_keys = sorted(set(sales) | set(access))

    fieldnames = [
        "date",
        "item_number",
        "item_name",
        "units_sold",
        "order_count",
        "total_sales",
        "page_views",
        "unique_users",
        "cart_adds",
    ]

    with open(filename, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for key in all_keys:
            s = sales.get(key, {})
            a = access.get(key, {})
            writer.writerow(
                {
                    "date": target.isoformat(),
                    "item_number": key,
                    "item_name": s.get("item_name", a.get("item_name", "")),
                    "units_sold": s.get("units_sold", 0),
                    "order_count": s.get("order_count", 0),
                    "total_sales": s.get("total_sales", 0),
                    "page_views": a.get("page_views", ""),
                    "unique_users": a.get("unique_users", ""),
                    "cart_adds": a.get("cart_adds", ""),
                }
            )

    return filename


# ---------------------------------------------------------------------------
# Step 5 – Console summary table
# ---------------------------------------------------------------------------


def print_summary(
    sales: dict[str, dict],
    access: dict[str, dict],
    target: date,
    output_path: Path,
) -> None:
    all_keys = sorted(set(sales) | set(access))

    print()
    print(f"=== Rakuten RMS Daily Report  {target.isoformat()} ===")
    print()

    if not all_keys:
        print("  No data found for this date.")
        print("  Possible reasons:")
        print("  - No orders were placed on this date")
        print("  - API credentials are missing or incorrect")
        print("  - RAKUTEN_ACCESS_CSV was not provided")
    else:
        col = "{:<20} {:<40} {:>8} {:>7} {:>12} {:>8} {:>8} {:>8}"
        header = col.format(
            "Item Number", "Item Name", "Units", "Orders",
            "Sales (¥)", "PV", "UU", "Cart"
        )
        print(header)
        print("-" * len(header))

        total_units = total_orders = total_sales = 0
        for key in all_keys:
            s = sales.get(key, {})
            a = access.get(key, {})
            name = (s.get("item_name") or a.get("item_name") or "")[:38]
            u = s.get("units_sold", 0)
            o = s.get("order_count", 0)
            rev = s.get("total_sales", 0)
            pv = a.get("page_views", "-")
            uu = a.get("unique_users", "-")
            cart = a.get("cart_adds", "-")
            total_units += u
            total_orders += o
            total_sales += rev
            print(col.format(key[:20], name, u, o, f"{rev:,}", pv, uu, cart))

        print("-" * len(header))
        print(col.format("TOTAL", "", total_units, total_orders, f"{total_sales:,}", "", "", ""))

    print()
    print(f"Output saved → {output_path.resolve()}")
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    print(f"[INFO] Target date : {TARGET_DATE.isoformat()}")
    print(f"[INFO] Output dir  : {OUTPUT_DIR.resolve()}")
    print()

    # Step 1 & 2 – orders
    print("[1/3] Fetching orders from Rakuten RMS Order API …")
    order_items = fetch_orders(TARGET_DATE)
    print(f"      → {len(order_items)} line-item(s) retrieved")

    sales = aggregate_sales(order_items)
    print(f"      → {len(sales)} unique product(s) sold")

    # Step 3 – access data
    print("[2/3] Loading access analytics …")
    if ACCESS_CSV_PATH:
        access = load_access_csv(ACCESS_CSV_PATH)
        print(f"      → {len(access)} product(s) with access data")
    else:
        access = {}
        print("      → RAKUTEN_ACCESS_CSV not set; skipping access data")
        print("        (Download from RMS > アクセス分析 > 商品別アクセス分析 > CSVダウンロード)")

    # Step 4 – export
    print("[3/3] Writing CSV …")
    out = export_csv(sales, access, TARGET_DATE, OUTPUT_DIR)
    print(f"      → {out.resolve()}")

    # Summary
    print_summary(sales, access, TARGET_DATE, out)


if __name__ == "__main__":
    main()
