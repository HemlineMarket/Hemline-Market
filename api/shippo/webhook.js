// File: /api/shippo/webhook.js
// Secure Shippo webhook → updates db_shipments by tracking_number.
// Shippo POST URL should be:
//   https://hemlinemarket.vercel.app/api/shippo/webhook?secret=YOUR_SECRET
//
// Env required:
// - SHIPPO_WEBHOOK_SECRET
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY

export const config = { api: { bodyParser: false } };

import supabaseAdmin from "../_supabaseAdmin";
import { rateLimit } from "../_rateLimit";
import { logError, logInfo, logWarn } from "../_logger";

// --- Read raw webhook body as JSON ---
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function normalizeTrackingStatus(s = "") {
  const up = s.toUpperCase();
  if (up.includes("DELIVER")) return "DELIVERED";
  if (up.includes("FAIL") || up.includes("EXCEPT")) return "ERROR";
  if (up.includes("TRANSIT")) return "IN_TRANSIT";
  return up || "IN_TRANSIT";
}

function normalizeTransactionStatus(s = "") {
  const up = s.toUpperCase();
  if (up === "SUCCESS") return "LABEL_PURCHASED";
  if (up === "ERROR") return "FAILED";
  return up || "CREATED";
}

export default async function handler(req, res) {
  // Rate limit
  if (!rateLimit(req, res)) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Shared secret check
  const given = String(req.query.secret || "");
  if (!given || given !== process.env.SHIPPO_WEBHOOK_SECRET) {
    await logWarn("/api/shippo/webhook", "Unauthorized webhook call", {
      given,
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  let payload;
  try {
    payload = await readBody(req);
  } catch (err) {
    await logError("/api/shippo/webhook", "JSON parse error", {
      message: err?.message || err,
    });
    return res.status(400).json({ error: "Bad JSON" });
  }

  // ACK first so Shippo doesn't retry
  res.status(200).json({ ok: true });

  try {
    const eventType = payload?.event || payload?.event_type || "";
    const data = payload?.data || payload?.object || payload;

    async function updateShipment(trackingNumber, fields) {
      if (!trackingNumber) {
        await logWarn("/api/shippo/webhook", "Missing tracking number", {
          fields,
        });
        return;
      }

      // First get the shipment to find the order and buyer
      const { data: shipment } = await supabaseAdmin
        .from("db_shipments")
        .select("order_id")
        .eq("tracking_number", trackingNumber)
        .maybeSingle();

      const { error } = await supabaseAdmin
        .from("db_shipments")
        .update({
          ...fields,
          updated_at: new Date().toISOString(),
        })
        .eq("tracking_number", trackingNumber);

      if (error) {
        await logError("/api/shippo/webhook", "db_shipments update error", {
          error,
          trackingNumber,
          fields,
        });
      } else {
        await logInfo("/api/shippo/webhook", "db_shipments updated", {
          trackingNumber,
          fields,
        });

        // Send notification to buyer if we have order info
        if (shipment?.order_id && fields.status) {
          try {
            const { data: order } = await supabaseAdmin
              .from("orders")
              .select("buyer_id, listing_title")
              .eq("id", shipment.order_id)
              .maybeSingle();

            if (order?.buyer_id) {
              let notifTitle, notifBody, notifType;
              
              if (fields.status === "IN_TRANSIT" || fields.status === "LABEL_PURCHASED") {
                notifType = "shipped";
                notifTitle = "Your order has shipped!";
                notifBody = order.listing_title 
                  ? `"${order.listing_title}" is on its way.`
                  : "Your fabric is on its way.";
              } else if (fields.status === "DELIVERED") {
                notifType = "delivered";
                notifTitle = "Your order was delivered!";
                notifBody = order.listing_title
                  ? `"${order.listing_title}" has been delivered.`
                  : "Your fabric has been delivered.";
              }

              if (notifTitle) {
                await supabaseAdmin
                  .from("notifications")
                  .insert({
                    user_id: order.buyer_id,
                    type: notifType,
                    kind: notifType,
                    title: notifTitle,
                    body: notifBody,
                    href: `/purchases.html`,
                    link: `/purchases.html`,
                  });
              }
            }
          } catch (notifErr) {
            await logWarn("/api/shippo/webhook", "Failed to create notification", {
              error: notifErr?.message || notifErr,
            });
          }
        }
      }
    }

    // --------------------------
    // TRANSACTION EVENTS
    // --------------------------
    if (/^transaction\./i.test(eventType)) {
      const tx = data?.object || data;

      const trackingNumber =
        tx?.tracking_number ||
        tx?.label?.tracking_number ||
        null;

      const trackingUrl =
        tx?.tracking_url_provider ||
        tx?.tracking_url ||
        null;

      const carrier = tx?.rate?.provider || null;
      const service = tx?.rate?.servicelevel?.name || null;

      const status = normalizeTransactionStatus(tx?.status);

      await updateShipment(trackingNumber, {
        status,
        tracking_url: trackingUrl,
        carrier,
        service,
        ...(tx?.label_url ? { label_url: tx.label_url } : {}),
      });

      return;
    }

    // --------------------------
    // TRACKING UPDATES
    // --------------------------
    if (/track_updated/i.test(eventType) || data?.tracking_status) {
      const trackingNumber =
        data?.tracking_number ||
        data?.tracking?.tracking_number ||
        null;

      const ts = data?.tracking_status || data?.tracking?.tracking_status || {};
      const status = normalizeTrackingStatus(ts?.status || ts?.object_state || "");

      await updateShipment(trackingNumber, { status });
      return;
    }

    // --------------------------
    // UNKNOWN EVENT
    // --------------------------
    await logInfo("/api/shippo/webhook", "Unhandled Shippo event", {
      eventType,
    });
  } catch (err) {
    await logError("/api/shippo/webhook", "Unhandled handler error", {
      message: err?.message || err,
    });
  }
}
