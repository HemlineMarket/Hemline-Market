// File: /api/stripe/webhook.js
// Verifies Stripe signatures, pays out sellers, and auto-creates Shippo labels
// when checkout completes.
//
// ENV required:
// - STRIPE_SECRET_KEY
// - STRIPE_WEBHOOK_SECRET
// - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
// - SUPABASE_SERVICE_ROLE_KEY
// - SHIPPO_API_KEY

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
    if (!secret) return res.status(500).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    event = stripe.webhooks.constructEvent(buf, signature, secret);
  } catch (err) {
    console.error("⚠️ Stripe signature verification failed:", err?.message || err);
    return res.status(400).send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  // Acknowledge immediately so Stripe doesn’t retry
  res.status(200).json({ received: true });

  // ---- Post-ack processing ---------------------------------------------------
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // ---- Payouts (existing logic) ----
        let bySeller = {};
        try {
          bySeller = JSON.parse(session.metadata?.sellers_json || "{}");
        } catch (_) {
          bySeller = {};
        }
        const sellerIds = Object.keys(bySeller || {});
        if (sellerIds.length) {
          const piId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id;
          if (piId) {
            const pi = await stripe.paymentIntents.retrieve(piId, { expand: ["latest_charge"] });
            const chargeId =
              typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
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

        // ---- Auto-create Shippo Label ----
        try {
          const orderId = session.metadata?.orderId;
          if (!orderId) {
            console.warn("[shippo] Missing orderId in metadata");
            break;
          }

          // Use shipping address from Stripe session
          const addr_to = session.shipping?.address;
          if (!addr_to) {
            console.warn("[shippo] No shipping address in session");
            break;
          }

          const address_to = {
            name: session.shipping?.name || "Buyer",
            street1: addr_to.line1,
            street2: addr_to.line2 || undefined,
            city: addr_to.city,
            state: addr_to.state,
            zip: addr_to.postal_code,
            country: addr_to.country,
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
            length: "10",
            width: "8",
            height: "2",
            distance_unit: "in",
            weight: "1",
            mass_unit: "lb",
          };

          const resLabel = await fetch(
            `${process.env.NEXT_PUBLIC_SITE_URL || ""}/api/shippo/create_label`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId,
                address_from,
                address_to,
                parcel,
              }),
            }
          );

          const data = await resLabel.json();
          if (!resLabel.ok) {
            console.error("[shippo] label creation failed", data);
          } else {
            console.log("[shippo] label created", data.tracking_number);

            // Persist in order_shipments table
            await supabase.from("order_shipments").insert([
              {
                order_id: orderId,
                tracking_number: data.tracking_number,
                tracking_url: data.tracking_url,
                label_url: data.label_url,
                carrier: data.rate?.provider || null,
                service: data.rate?.servicelevel?.name || null,
                status: "LABEL_CREATED",
              },
            ]);
          }
        } catch (err) {
          console.error("[shippo] auto-label error:", err);
        }

        break;
      }

      case "payout.paid":
      case "payout.failed":
      case "payout.created": {
        const p = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          id: p.id,
          status: p.status,
          amount: p.amount,
          arrival_date: p.arrival_date,
        });
        break;
      }

      default:
        console.log("[stripe] unhandled event:", event.type);
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
  }
}
