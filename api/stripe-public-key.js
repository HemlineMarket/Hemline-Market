export default function handler(req, res) {
  // Only allow GET
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Grab publishable key from env
  const pk =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY;

  if (!pk) {
    return res.status(500).json({ error: "Missing publishable key" });
  }

  // HARD GUARD: block live publishable keys
  if (!pk.startsWith("pk_test_")) {
    return res.status(503).json({ error: "Live publishable key blocked. Use test key." });
  }

  return res.status(200).json({ publishableKey: pk, env: "test" });
}
