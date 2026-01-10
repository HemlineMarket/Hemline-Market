const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
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

    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const { data: transactions, error } = await supabaseAdmin
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Transactions fetch error:", error);
      return res.status(500).json({ error: "Failed to fetch transactions" });
    }

    const typeLabels = {
      sale_proceeds: "Sale",
      purchase: "Purchase",
      refund: "Refund",
      withdrawal: "Withdrawal",
      adjustment: "Adjustment"
    };

    const formatted = (transactions || []).map(tx => ({
      id: tx.id,
      amount_cents: tx.amount_cents,
      amount_dollars: (Math.abs(tx.amount_cents) / 100).toFixed(2),
      is_credit: tx.amount_cents > 0,
      type: tx.type,
      type_label: typeLabels[tx.type] || tx.type,
      description: tx.description,
      created_at: tx.created_at
    }));

    return res.status(200).json({ transactions: formatted });

  } catch (err) {
    console.error("Wallet transactions error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
