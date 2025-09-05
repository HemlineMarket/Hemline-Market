export default async function handler(req, res) {
  // Always block checkout during test phase
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  return res.status(503).json({
    error: "Checkout is disabled in test mode. No payments are processed.",
  });
}
