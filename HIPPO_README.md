# Shippo Integration

## Environment Variables
- `SHIPPO_API_KEY` → required for all label/rate/transaction calls (set in Vercel).
- `SHIPPO_WEBHOOK_SECRET` → optional; used to verify webhook signatures (set in Vercel).

## API Endpoints
All live under `/api/shippo/*`:

- `create_label.js` → creates shipment, returns cheapest rate & label.
- `purchase_label.js` → purchases a label for a chosen rate.
- `webhook.js` → receives `transaction_updated` and `track_updated` events from Shippo.

## Notes
- Old `/api/shipping/*` endpoints have been removed (Sept 2025).
- Always use `process.env.SHIPPO_API_KEY` (not `SHIPPO_API_TOKEN`).
- Do not install `node-fetch`; Node 18+ has `fetch` built in.
