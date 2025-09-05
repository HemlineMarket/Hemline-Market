export default function handler(req, res) {
  // Accept only GET
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Support either var name you may have set
  const pk =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    process.env.STRIPE_PUBLISHABLE_KEY;

  if (!pk) return res.status(500).json({ error: "Missing publishable key" });

  // HARD GUARD: block live keys in any environment
  if (!pk.startsWith("pk_test_")) {
    return res.status(503).json({ error: "Live publishable key blocked. Use test key." });
  }

  return res.status(200).json({ publishableKey: pk, env: "test" });
}
