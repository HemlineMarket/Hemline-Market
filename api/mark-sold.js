// File: /api/mark-sold.js
// Marks a listing as SOLD after successful checkout.
// Called by your Stripe webhook OR by the checkout flow immediately before transfers.
//
// ENV REQUIRED:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// SITE_URL
//
// This endpoint uses service-role to bypass RLS, but writes only safe, controlled values.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

// Notification helper
function site() {
  return (process.env.SITE_URL || "").replace(/\/$/, "");
}

async function notify(payload) {
  try {
    await fetch(`${site()}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("[mark-sold] notify error:", err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      listing_id,
      buyer_id,
      seller_id,
      listing_name,
      payment_intent,
      order_id,         // your Stripe session ID
    } = req.body || {};

    if (!listing_id || !buyer_id || !seller_id) {
      return res.status(400).json({
        error: "Missing listing_id, buyer_id, or seller_id",
      });
    }

    // 1) Mark listing SOLD
    const { data: updatedListing, error: listingErr } = await supabase
      .from("listings")
      .update({
        status: "sold",
        sold_at: new Date().toISOString(),
        buyer_id,
        order_id,
        payment_intent,
      })
      .eq("id", listing_id)
      .select()
      .single();

    if (listingErr) {
      return res.status(500).json({
        error: "Cannot update listing",
        detail: listingErr.message,
      });
    }

    // 2) Insert into "orders" table so buyer + seller can view it
    const { data: orderRow, error: orderErr } = await supabase
      .from("orders")
      .insert([
        {
          id: order_id,
          buyer_id,
          seller_id,
          listing_id,
          listing_name,
          payment_intent,
          status: "paid",
        },
      ])
      .select()
      .single();

    if (orderErr) {
      console.error("[mark-sold] order insert error:", orderErr.message);
      // Still continue — listing is correctly set as sold
    }

    // 3) Send notifications

    // Seller: “Your item sold!”
    await notify({
      user_id: seller_id,
      kind: "sale",
      title: "Your item sold!",
      body: `${listing_name || "Your fabric"} has been purchased.`,
      href: `${site()}/orders.html`,
    });

    // Seller: warning not to ship yet (30-minute window)
    await notify({
      user_id: seller_id,
      kind: "warning",
      title: "Do NOT ship yet",
      body: "Buyer may cancel for 30 minutes. Wait before shipping.",
      href: `${site()}/orders.html`,
    });

    // Buyer: order confirmed
    await notify({
      user_id: buyer_id,
      kind: "order",
      title: "Order confirmed",
      body: `Your purchase of ${listing_name ||
        "this item"} is confirmed.`,
      href: `${site()}/orders.html`,
    });

    // Buyer: cancellation window
    await notify({
      user_id: buyer_id,
      kind: "warning",
      title: "30-minute cancellation window",
      body: "You have 30 minutes to cancel from your Orders page.",
      href: `${site()}/orders.html`,
    });

    return res.status(200).json({
      success: true,
      listing: updatedListing,
      order: orderRow || null,
    });
  } catch (err) {
    console.error("[mark-sold] handler error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message });
  }
}
