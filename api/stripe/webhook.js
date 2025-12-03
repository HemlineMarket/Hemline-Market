// File: /api/stripe/webhook.js
// Verifies Stripe signatures, creates Transfers to connected sellers,
// sends buyer confirmation emails, and sends notifications to buyer & seller.
//
// ENV REQUIRED:
// STRIPE_SECRET_KEY
// STRIPE_WEBHOOK_SECRET
// SITE_URL
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
//
// NOTE: Notifications are sent by calling your /api/notify endpoint.

import Stripe from "stripe";
import fetch from "node-fetch";

// Stripe requires RAW body for signature verification
export const config = { api: { bodyParser: false } };

// Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

// Read raw body
function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Base site URL
function siteBase() {
  return (process.env.SITE_URL || "").replace(/\/$/, "");
}

// Helper: call our notification API
async function notify(payload) {
  try {
    const res = await fetch(`${siteBase()}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[webhook] notify() failed:", res.status);
    }
  } catch (err) {
    console.error("[webhook] notify() error:", err?.message || err);
  }
}

// Helper: call our send-order-confirmation endpoint
async function sendOrderEmail({ to, orderId, items }) {
  if (!to) return;
  try {
    const res = await fetch(`${siteBase()}/api/send-order-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, orderId, items }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[webhook] email failed:", res.status, t);
    }
  } catch (err) {
    console.error("[webhook] email error:", err?.message || err);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Verify signature
  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(500).json({
        error: "Missing STRIPE_WEBHOOK_SECRET",
      });
    }
    event = stripe.webhooks.constructEvent(buf, sig, secret);
  } catch (err) {
    console.error("⚠ Stripe signature error:", err?.message || err);
    return res
      .status(400)
      .send(`Webhook Error: ${err?.message || "invalid signature"}`);
  }

  // ACK immediately
  res.status(200).json({ received: true });

  // Post-ACK background processing
  try {
    switch (event.type) {
      /* ---------------------------------------------------------
         1) CHECKOUT COMPLETED
      --------------------------------------------------------- */
      case "checkout.session.completed": {
        const session = event.data.object;

        const buyerEmail =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        // Get line items for the receipt email
        let items = [];
        try {
          const li = await stripe.checkout.sessions.listLineItems(
            session.id,
            { limit: 20 }
          );
          items =
            li.data?.map((x) => ({
              name:
                x.description ||
                x.price?.nickname ||
                "Item",
              qty: x.quantity || 1,
            })) || [];
        } catch (_) {
          items = [];
        }

        // Send order email
        await sendOrderEmail({
          to: buyerEmail,
          orderId: session.id,
          items,
        });

        // Determine sellers for transfers
        let sellersJSON = {};
        try {
          sellersJSON = JSON.parse(
            session.metadata?.sellers_json || "{}"
          );
        } catch {
          sellersJSON = {};
        }

        const sellerAccounts = Object.keys(sellersJSON);
        if (!sellerAccounts.length) {
          console.log("[webhook] no sellers_json found");
          break;
        }

        // Retrieve payment intent to pull charge ID
        const piId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id;

        if (!piId) {
          console.warn(
            "[webhook] missing payment_intent on session"
          );
          break;
        }

        const pi = await stripe.paymentIntents.retrieve(
          piId,
          { expand: ["latest_charge"] }
        );

        const chargeId =
          typeof pi.latest_charge === "string"
            ? pi.latest_charge
            : pi.latest_charge?.id;

        if (!chargeId) {
          console.warn(
            "[webhook] missing latest_charge; no transfers"
          );
          break;
        }

        // Create transfers to each seller
        for (const acctId of sellerAccounts) {
          const amount = Math.max(
            0,
            Number(sellersJSON[acctId] || 0)
          );
          if (!amount) continue;

          try {
            const tr = await stripe.transfers.create({
              amount,
              currency: "usd",
              destination: acctId,
              source_transaction: chargeId,
              metadata: {
                checkout_session: session.id,
                subtotal_cents:
                  session.amount_subtotal || "",
                shipping_cents:
                  session.metadata?.shipping_cents ||
                  "",
              },
            });
            console.log(
              "[webhook] transfer.created",
              tr.id
            );
          } catch (err) {
            console.error(
              `[webhook] transfer error (${acctId}):`,
              err?.message || err
            );
          }
        }

        /* -------------------------------------------------------
           2) NOTIFICATIONS: Buyer + Seller
        ------------------------------------------------------- */

        // Listing name (fallback)
        const listingName =
          session.metadata?.listing_name ||
          "Your fabric";

        const buyerId = session.metadata?.buyer_id || null;
        const sellerId = session.metadata?.seller_id || null;
        const listingId = session.metadata?.listing_id || null;

        // Notify Seller: “Item Sold”
        if (sellerId) {
          await notify({
            user_id: sellerId,
            kind: "sale",
            title: "Your item sold!",
            body: `${listingName} has been purchased.`,
            href: `${siteBase()}/orders.html`,
          });

          // 30-minute “do not ship yet”
          await notify({
            user_id: sellerId,
            kind: "warning",
            title: "Do NOT ship yet",
            body: "The buyer has a 30-minute cancellation window. Do not ship until it closes.",
            href: `${siteBase()}/orders.html`,
          });
        }

        // Notify Buyer: “Order confirmed”
        if (buyerId) {
          await notify({
            user_id: buyerId,
            kind: "order",
            title: "Order confirmed",
            body: `Your purchase of ${listingName} is confirmed.`,
            href: `${siteBase()}/orders.html`,
          });

          // Buyer cancellation window
          await notify({
            user_id: buyerId,
            kind: "warning",
            title: "You may cancel for 30 minutes",
            body: "You have 30 minutes to cancel this order from your Orders page.",
            href: `${siteBase()}/orders.html`,
          });
        }

        break;
      }

      /* ---------------------------------------------------------
         3) PAYOUT EVENTS (optional logs)
      --------------------------------------------------------- */
      case "payout.paid":
      case "payout.failed":
      case "payout.created": {
        const p = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          id: p.id,
          status: p.status,
          amount: p.amount,
        });
        break;
      }

      /* ---------------------------------------------------------
         4) CONNECT ACCOUNT STATUS EVENTS
      --------------------------------------------------------- */
      case "account.updated":
      case "account.application.authorized":
      case "account.application.deauthorized": {
        const acct = event.data.object;
        console.log(`[stripe] ${event.type}`, {
          account: acct?.id || event.account,
          charges_enabled: acct?.charges_enabled,
          payouts_enabled: acct?.payouts_enabled,
        });
        break;
      }

      /* ---------------------------------------------------------
         5) OTHER EVENTS
      --------------------------------------------------------- */
      default:
        console.log("[stripe] unhandled event:", event.type);
    }
  } catch (err) {
    console.error("Webhook post-processing error:", err);
  }
}
