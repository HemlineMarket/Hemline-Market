// File: /api/stripe/webhook.js
// Verifies Stripe signatures, pays out sellers, auto-creates Shippo labels,
// and updates profiles.payouts_enabled on account.updated.
//
// ENV required:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET
// - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
// - SUPABASE_SERVICE_ROLE_KEY
// - SHIPPO_API_KEY
// - SITE_URL or NEXT_PUBLIC_SITE_URL (for internal fetches)

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getBaseUrl() {
  const base =
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "";
  return base.replace(/\/$/, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let event;
  try {
    const buf = await buffer(req);
    const signature = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET");
    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error("⚠️ Stripe signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  // Acknowledge first so Stripe doesn't retry
  res.status(200).json({ received: true });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // ----- TRANSFERS TO CONNECTED ACCOUNTS -----
        let bySeller = {};
        try { bySeller = JSON.parse(session.metadata?.sellers_json || "{}"); } catch { bySeller = {}; }
        const sellerIds = Object.keys(bySeller || {});
        if (sellerIds.length) {
          const piId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;
          if (piId) {
            const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
            const chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
            if (chargeId) {
              for (const acctId of sellerIds) {
                const amount = Math.max(0, Number(bySeller[acctId] || 0));
                if (!amount) continue;
                try {
                  const tr = await stripe.transfers.create({
                    amount,
                    currency: "usd",
                    destination: acctId,
                    source_transaction: chargeId,
                    metadata: {
                      checkout_session: session.id,
                      subtotal_cents: String(session.amount_subtotal ?? ""),
                      shipping_cents: session.metadata?.shipping_cents ?? "",
                    },
                  });
                  console.log("[stripe] transfer.created", { id: tr.id, amount, destination: acctId });
                } catch (err) {
                  console.error(`[stripe] transfer error for ${acctId}:`, err?.message || err);
                }
              }
            }
          }
        }

        // ----- AUTO-CREATE SHIPPO LABEL -----
        try {
          const orderId = session.metadata?.orderId;
          const addr = session.shipping?.address;
          if (!orderId || !addr) break;

          const address_to = {
            name: session.shipping?.name || "Buyer",
            street1: addr.line1,
            street2: addr.line2 || undefined,
            city: addr.city,
            state: addr.state,
            zip: addr.postal_code,
            country: addr.country,
            phone: session.customer_details?.phone || undefined,
            email: session.customer_details?.email || undefined,
          };

          const address_from = {
            name: "Hemline Seller",
            street1: "215 Clayton St",
            city: "San Francisco",
            state: "CA",
            zip: "94117",
            country: "US",
            email: "support@hemline.market",
            phone: "4155550101",
          };

          const parcel = {
            length: "10", width: "8", height: "2", distance_unit: "in",
            weight: "1", mass_unit: "lb",
          };

          const base = getBaseUrl();
          if (!base) { console.warn("[shippo] Missing SITE_URL; skip label"); break; }

          const resLabel = await fetch(`${base}/api/shippo/create_label`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId, address_from, address_to, parcel }),
          });

          const data = await resLabel.json().catch(() => ({}));
          if (!resLabel.ok) {
            console.error("[shippo] label creation failed", data);
          } else {
            console.log("[shippo] label created", data.tracking_number);
            // Optional: persist here; primary path is shippo webhook upsert.
            await supabase.from("order_shipments").upsert({
              order_id: orderId,
              tracking_number: data.tracking_number || null,
              tracking_url: data.tracking_url || null,
              label_url: data.label_url || null,
              carrier: data.rate?.provider || null,
              service: data.rate?.servicelevel?.name || null,
              status: "LABEL_CREATED",
              updated_at: new Date().toISOString(),
            }, { onConflict: "order_id" });
          }
        } catch (err) {
          console.error("[shippo] auto-label error:", err);
        }

        // ----- SEND BUYER CONFIRMATION EMAIL -----
        try {
          const to =
            session.customer_details?.email ||
            session.customer_email ||
            null;
          const orderId = session.metadata?.orderId || session.client_reference_id || null;

          let items = [];
          try {
            items = JSON.parse(session.metadata?.items_json || "[]");
            if (!Array.isArray(items)) items = [];
          } catch { items = []; }

          const base = getBaseUrl();
          if (to && orderId && base) {
            const resp = await fetch(`${base}/api/send-order-confirmation`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ to, orderId, items }),
            });
            if (!resp.ok) {
              const j = await resp.json().catch(() => ({}));
              console.error("[stripe-webhook] confirmation email failed", resp.status, j);
            }
          }
        } catch (err) {
          console.error("[stripe-webhook] confirmation email error:", err?.message || err);
        }

        break;
      }

      // ===== NEW: reflect Connect onboarding status in profiles =====
      case "account.updated": {
        const acct = event.data.object; // Stripe Account object
        const acctId = acct?.id;
        if (!acctId) break;

        // Mark payouts_enabled if both flags are true
        const enabled = !!(acct.charges_enabled && acct.payouts_enabled);

        // Update profile where stripe_account_id matches this account
        const { error } = await supabase
          .from("profiles")
          .update({ payouts_enabled: enabled })
          .eq("stripe_account_id", acctId);

        if (error) {
          console.error("[profiles] update payouts_enabled error:", error);
        } else {
          console.log("[profiles] payouts_enabled =", enabled, "for", acctId);
        }
        break;
      }

      // (Optional) Log payout lifecycle events
      case "payout.paid":
      case "payout.failed":
      case "payout.created": {
        const p = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          id: p.id, status: p.status, amount: p.amount, arrival_date: p.arrival_date,
        });
        break;
      }

      default:
        console.log("[stripe] unhandled event:", event.type);
    }
  } catch (err) {
    // We already responded 200 above; just log for diagnostics
    console.error("Stripe webhook handler error:", err);
  }
}
