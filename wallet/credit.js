// api/wallet/credit.js
// Add credit to seller's wallet after a sale
// Called internally from Stripe webhook

const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Webhook-Secret");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Verify internal webhook secret
    const secret = req.headers["x-webhook-secret"];
    if (secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { seller_id, amount_cents, order_id, description } = req.body;

    if (!seller_id || !amount_cents) {
      return res.status(400).json({ error: "Missing seller_id or amount_cents" });
    }

    if (amount_cents <= 0) {
      return res.status(400).json({ error: "amount_cents must be positive" });
    }

    // Add credit using database function
    const { data, error } = await supabaseAdmin.rpc("add_wallet_credit", {
      p_user_id: seller_id,
      p_amount_cents: amount_cents,
      p_type: "sale_proceeds",
      p_description: description || "Sale proceeds",
      p_order_id: order_id || null
    });

    if (error) {
      console.error("Add credit error:", error);
      return res.status(500).json({ error: "Failed to add credit" });
    }

    const result = data?.[0] || data;

    return res.status(200).json({
      success: true,
      wallet_id: result.wallet_id,
      new_balance_cents: result.new_balance_cents,
      transaction_id: result.transaction_id
    });

  } catch (err) {
    console.error("Wallet credit error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
