// /api/admin/test.js
// Simple admin-only route to verify HM_ADMIN_KEY works.

export default async function handler(req, res) {
  const key = req.headers['x-hm-admin-key'] || req.query.admin_key;

  if (key !== process.env.HM_ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return res.status(200).json({ ok: true, msg: 'Admin route working!' });
}
