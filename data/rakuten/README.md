# Rakuten RMS Data Extraction

## Status
No Rakuten RMS integration is currently configured in this project.

## What's needed to enable extraction

1. **Rakuten RMS API credentials** — obtain from Rakuten Merchant Server (RMS) web portal:
   - `RAKUTEN_RMS_SERVICE_SECRET` — service secret key
   - `RAKUTEN_RMS_LICENSE_KEY` — license key
   - `RAKUTEN_SHOP_URL` — your shop URL (e.g. `your-shop.rakuten.co.jp`)

2. **Add credentials to `.env.local`**:
   ```
   RAKUTEN_RMS_SERVICE_SECRET=your_service_secret
   RAKUTEN_RMS_LICENSE_KEY=your_license_key
   RAKUTEN_SHOP_URL=your-shop.rakuten.co.jp
   ```

3. **Install a script or integration** — a fetch script using the RMS REST API:
   - Sales by product: `GET /order/1.0/searchOrder` (order search)
   - Access/traffic: `GET /stat/2.0/product` (product statistics)

## Extraction Logs

| Date       | Status  | Notes                                      |
|------------|---------|---------------------------------------------|
| 2026-06-24 | FAILED  | No credentials or integration configured   |
