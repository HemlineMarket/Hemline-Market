# Admin APIs

Protected endpoints for internal admin use.  
All require the `x-admin-token` header with `ADMIN_SECRET`.

## Endpoints

- `GET /api/admin/orders` — list recent orders
- `GET /api/admin/users` — list recent users
- `GET /api/admin/shipments` — list recent shipments
- `GET /api/admin/index` — health check + list of admin endpoints

## Environment

- `ADMIN_SECRET` — random secret string set in Vercel (used in headers)
- `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
