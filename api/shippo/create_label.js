// FILE: api/shippo/create_label.js
// FIX: Added JWT authentication - only seller can create labels for their orders (BUG #15)
// Creates a shipping label via Shippo for a given order
// Persists the label + tracking to Supabase (db_shipments)
// Also nudges buyer + seller via notifications.
//
// CHANGE: Now requires valid JWT token, and user must be the seller of the order
//
// Env required:
//   SHIPPO_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import { logError } from "../_logger";
import { rateLimit } from "../_rateLimit";

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" } },
};

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

export default async function handler(req, res) {
  // Basic rate-limit
  if (!rateLimit(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // FIX: Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { orderId, address_from, address_to, parcel } = req.body || {};
    if (!orderId || !address_from || !address_to || !parcel) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // FIX: Verify user is the seller of this order
    const { data: order, error: orderCheckErr } = await supabaseAdmin
      .from("orders")
      .select("seller_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderCheckErr || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.seller_id !== user.id) {
      return res.status(403).json({ error: "Only the seller can create labels for this order" });
    }

    const apiKey = process.env.SHIPPO_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing SHIPPO_API_KEY" });
    }

    // -----------------------------------------------------------------------
    // 1) Create shipment in Shippo
    // -----------------------------------------------------------------------
    const shipmentRes = await fetch("https://api.goshippo.com/shipments/", {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        address_from,
        address_to,
        parcels: [parcel],
        async: false,
        metadata: `order:${orderId}`,
      }),
    });

    const shipment = await shipmentRes.json();

    if (
      !shipmentRes.ok ||
      !shipment?.rates ||
      !Array.isArray(shipment.rates) ||
      shipment.rates.length === 0
    ) {
      await logError(
        "/api/shippo/create_label",
        "No shipping rates found or Shippo error",
        { status: shipmentRes.status, body: shipment }
      );
      return res.status(400).json({
        error: "No shipping rates found",
        details: shipment,
      });
    }

    // -----------------------------------------------------------------------
    // 2) Pick the cheapest rate
    // -----------------------------------------------------------------------
    const rate = shipment.rates
      .slice()
      .sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))[0];

    // -----------------------------------------------------------------------
    // 3) Buy the label (Shippo transaction)
    // -----------------------------------------------------------------------
    const transactionRes = await fetch(
      "https://api.goshippo.com/transactions/",
      {
        method: "POST",
        headers: {
          Authorization: `ShippoToken ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rate: rate.object_id,
          label_file_type: "PDF",
          async: false,
          metadata: `order:${orderId}`,
        }),
      }
    );

    const tx = await transactionRes.json();

    if (!transactionRes.ok || tx.status !== "SUCCESS") {
      await logError(
        "/api/shippo/create_label",
        "Label purchase not successful",
        { status: transactionRes.status, body: tx }
      );
      return res.status(502).json({
        error: "Label purchase not successful",
        details: tx,
      });
    }

    const trackingNumber = tx.tracking_number || null;
    const trackingUrl =
      tx.tracking_url_provider || tx.tracking_url || null;
    const carrier = tx.rate?.provider || null;
    const service = tx.rate?.servicelevel?.name || null;
    const amountCents = tx.rate?.amount
      ? Math.round(parseFloat(tx.rate.amount) * 100)
      : null;

    // -----------------------------------------------------------------------
    // 4) Persist shipment in db_shipments (one row per order)
    // -----------------------------------------------------------------------
    try {
      const payload = {
        order_id: orderId,
        shippo_transaction_id: tx.object_id || null,
        label_url: tx.label_url || null,
        tracking_number: trackingNumber,
        tracking_url: trackingUrl,
        carrier,
        service,
        amount_cents: amountCents,
        status: "LABEL_PURCHASED",
        raw: tx,
      };

      // Keep only the latest label per order
      await supabaseAdmin.from("db_shipments").delete().eq("order_id", orderId);
      await supabaseAdmin.from("db_shipments").insert(payload);
    } catch (dbErr) {
      await logError(
        "/api/shippo/create_label",
        "db_shipments insert error",
        dbErr
      );
    }

    // -----------------------------------------------------------------------
    // 5) Try to update orders table + create notifications
    //    (all best-effort; failures are logged but do not break response)
    // -----------------------------------------------------------------------
    let orderRow = null;
    try {
      const { data: orderData, error: orderErr } = await supabaseAdmin
        .from("orders")
        .select("id, buyer_id, seller_id, short_id, created_at")
        .eq("id", orderId)
        .maybeSingle();

      if (!orderErr && orderData) {
        orderRow = orderData;

        // Soft update of order with tracking info; ignore if columns don't exist
        await supabaseAdmin
          .from("orders")
          .update({
            shipping_status: "LABEL_PURCHASED",
            tracking_number: trackingNumber,
            tracking_url: trackingUrl,
            shipping_carrier: carrier,
            shipping_service: service,
            label_url: tx.label_url || null,
          })
          .eq("id", orderId);
      }
    } catch (orderErr) {
      await logError(
        "/api/shippo/create_label",
        "orders update error",
        orderErr
      );
    }

    // Notifications – only if we could load an order row
    try {
      if (orderRow) {
        const { buyer_id, seller_id, short_id } = orderRow;
        const humanId = short_id || orderId;
        const href = `/orders.html`;

        const notifs = [];

        if (buyer_id) {
          notifs.push({
            user_id: buyer_id,
            type: "order",
            kind: "shipment_buyer",
            title: "Your order is getting ready to ship",
            body: `A shipping label was created for order ${humanId}. If this order is less than 30 minutes old, you still have a short window to cancel before it becomes final.`,
            href,
            link: href,
          });
        }

        if (seller_id) {
          notifs.push({
            user_id: seller_id,
            type: "order",
            kind: "shipment_seller",
            title: "Shipping label created",
            body: `You generated a shipping label for order ${humanId}. If the order is under 30 minutes old, wait for the cancel window to pass before dropping it off.`,
            href,
            link: href,
          });
        }

        if (notifs.length) {
          await supabaseAdmin.from("notifications").insert(
            notifs.map((n) => ({
              ...n,
              is_read: false,
            }))
          );
        }
      }
    } catch (notifErr) {
      await logError(
        "/api/shippo/create_label",
        "notifications insert error",
        notifErr
      );
    }

    // -----------------------------------------------------------------------
    // 6) Return response to client
    // -----------------------------------------------------------------------
    return res.status(200).json({
      orderId,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      label_url: tx.label_url || null,
      carrier,
      service,
      rate: tx.rate || null,
    });
  } catch (err) {
    await logError("/api/shippo/create_label", "Unhandled error", {
      message: err?.message || err,
    });
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
