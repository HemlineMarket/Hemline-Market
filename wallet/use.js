// api/wallet/use.js
// Use wallet credit at checkout

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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

    const { amount_cents, order_id } = req.body;

    if (!amount_cents || amount_cents <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Use credit via database function
    const { data, error } = await supabaseAdmin.rpc("use_wallet_credit", {
      p_user_id: user.id,
      p_amount_cents: amount_cents,
      p_description: "Purchase",
      p_order_id: order_id || null
    });

    if (error) {
      console.error("Use credit error:", error);
      return res.status(500).json({ error: "Failed to use credit" });
    }

    const result = data?.[0] || data;

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error_message,
        balance_cents: result.new_balance_cents
      });
    }

    return res.status(200).json({
      success: true,
      amount_used_cents: amount_cents,
      new_balance_cents: result.new_balance_cents,
      transaction_id: result.transaction_id
    });

  } catch (err) {
    console.error("Wallet use error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
