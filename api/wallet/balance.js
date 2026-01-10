import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { data: wallet, error: walletError } = await supabaseAdmin
      .from("wallets")
      .select("id, balance_cents, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (walletError) {
      console.error("Wallet fetch error:", walletError);
      return res.status(500).json({ error: "Failed to fetch wallet" });
    }

    const balance_cents = wallet?.balance_cents || 0;

    return res.status(200).json({
      balance_cents,
      balance_dollars: (balance_cents / 100).toFixed(2),
      has_wallet: !!wallet,
      wallet_id: wallet?.id || null
    });

  } catch (err) {
    console.error("Wallet balance error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
