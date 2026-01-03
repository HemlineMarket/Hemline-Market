// File: api/orders/create.js
// FIXED VERSION — always sets buyer_id, seller_id, listing_id, status.
// SECURITY FIX: Now requires internal secret (only called from webhook/server)

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // SECURITY FIX: Require internal secret for server-to-server calls
  const internalSecret = req.headers["x-internal-secret"];
  if (!internalSecret || internalSecret !== process.env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const {
      order_id,
      items,
      subtotal_cents,
      shipping_cents,
      total_cents,
      buyer,
      source
    } = body;

    const firstItem = items?.[0] || {};
    const listing_id = firstItem.listing_id || null;
    const seller_id = firstItem.seller_id || null;
    const buyer_id = buyer?.id || buyer?.user_id || null;

    const nowIso = new Date().toISOString();

    // -----------------------------
    // INSERT ORDER  (FIXED)
    // -----------------------------
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert({
        id: order_id,
        listing_id,
        seller_id,
        buyer_id,                 // FIXED
        buyer_email: buyer?.email || "",
        stripe_payment_intent: source || "",
        subtotal_cents,
        shipping_cents,
        total_cents,
        status: "PAID",           // FIXED
        created_at: nowIso,       // FIXED
        updated_at: nowIso        // FIXED
      })
      .select("*")
      .single();

    if (orderErr) {
      console.error("Order insert failed:", orderErr);
      return res.status(500).json({ error: "Insert failed" });
    }

    // -----------------------------
    // NOTIFY SELLER (unchanged)
    // -----------------------------
    if (seller_id) {
      await supabase.from("notifications").insert({
        user_id: seller_id,
        actor_id: buyer_id || seller_id,
        type: "listing_order",
        kind: "purchase",
        title: "New order received",
        body: "Your item has been purchased.",
        href: "orders.html",
        link: "orders.html",
        metadata: {
          order_id,
          listing_id,
          total_cents
        }
      });
    }

    return res.status(200).json({ ok: true, order: orderRow });

  } catch (err) {
    console.error("orders/create error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
