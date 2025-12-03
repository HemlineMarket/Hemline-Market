// File: api/orders/create.js
// Create order + notify seller

import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const {
      order_id,
      items,
      subtotal_cents,
      shipping_cents,
      total_cents,
      buyer,
      source
    } = JSON.parse(req.body);

    const firstItem = items?.[0] || {};
    const listing_id = firstItem.listing_id;
    const seller_id = firstItem.seller_id;

    // -----------------------------
    // 1. INSERT ORDER
    // -----------------------------
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert({
        id: order_id,
        listing_id,
        seller_id,
        buyer_email: buyer?.email || "",
        stripe_payment_intent: source || "",
        subtotal_cents,
        shipping_cents,
        total_cents
      })
      .select("*")
      .single();

    if (orderErr) {
      console.error("Order insert failed:", orderErr);
      return res.status(500).json({ error: "Insert failed" });
    }

    // -----------------------------
    // 2. NOTIFY SELLER
    // -----------------------------
    if (seller_id) {
      await supabase.from("notifications").insert({
        user_id: seller_id,
        actor_id: seller_id,
        type: "listing_order",
        kind: "purchase",
        title: "New order received",
        body: `Your item has been purchased.`,
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
