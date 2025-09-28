# Notify APIs

This folder contains all Postmark-based notification endpoints.

## Endpoints

- `POST /api/notify/shipment` — send buyer/seller shipping updates
- `POST /api/notify/refund` — send buyer refund confirmation
- `POST /api/notify/account` — send account verification / onboarding notices
- `POST /api/notify/support` — forward support form submissions to support inbox
- `POST /api/notify/generic` — flexible endpoint for ad-hoc notifications
- `GET  /api/notify/index` — health check, returns available endpoints
- `POST /api/notify/test` — send a test email

## Environment

Requires these env vars in Vercel:

- `POSTMARK_SERVER_TOKEN` — from Postmark server
- `FROM_EMAIL` — verified sending email (e.g. support@hemlinemarket.com)
- `SUPPORT_EMAIL` (optional) — support inbox, defaults to `FROM_EMAIL`
