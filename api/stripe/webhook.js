// File: /api/stripe/webhook.js
// Handles Stripe webhooks + triggers Hemline Market notifications for:
// - item sold
// - shipping label available
// - cancellation within 30 minutes
// - payout events
// - anything else you want later

import Stripe from "stripe";
import fetch from "node-fetch";

// Let Stripe read RAW body (required for signature)
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
});

/* ----------------------------------------------------------
   HELPERS
---------------------------------------------------------- */

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

function siteBase() {
  return (
    process.env.SITE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    ""
  ).replace(/\/$/, "");
}

async function supabaseInsertNotification({ userId, kind, title, body, href }) {
  if (!userId) return;

  try {
    await fetch(`${siteBase()}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        kind,
        title,
        body,
        href,
      }),
    });
  } catch (err) {
    console.error("[notify] error:", err.message || err);
  }
}

// Email receipts you already handle through this:
async function sendOrderConfirmation({ to, orderId, items }) {
  if (!to) return;
  try {
    const res = await fetch(`${siteBase()}/api/send-order-confirmation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, orderId, items }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[send-order-confirmation] fail:", text);
    }
  } catch (err) {
    console.error("[send-order-confirmation] error:", err);
  }
}

/* ----------------------------------------------------------
   MAIN WEBHOOK HANDLER
---------------------------------------------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let event;
  try {
    const buf = await buffer(req);
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      buf,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("⚠ Stripe signature failed:", err.message);
    return res.status(400).send("Invalid signature");
  }

  // Always ACK immediately
  res.status(200).json({ received: true });

  /* ----------------------------------------------------------
     POST-ACK PROCESSING
  ---------------------------------------------------------- */

  try {
    switch (event.type) {
      /* ------------------------------------------------------
         CHECKOUT COMPLETED → SELLERS GET “ITEM SOLD”
      ------------------------------------------------------ */
      case "checkout.session.completed": {
        const session = event.data.object;

        const buyerEmail =
          session.customer_details?.email ||
          session.customer_email ||
          null;

        // Pull line items for buyer emails
        let items = [];
        try {
          const li = await stripe.checkout.sessions.listLineItems(session.id, {
            limit: 20,
          });
          items =
            li.data?.map((x) => ({
              name: x.description || x.price?.nickname || "Item",
              qty: x.quantity || 1,
            })) || [];
        } catch (_) {}

        // Send buyer email receipt
        await sendOrderConfirmation({
          to: buyerEmail,
          orderId: session.id,
          items,
        });

        /* ------------------------------
           Notify sellers
        ------------------------------ */
        let bySeller = {};
        try {
          bySeller = JSON.parse(session.metadata?.sellers_json || "{}");
        } catch {}

        let listingInfo = {};
        try {
          listingInfo = JSON.parse(session.metadata?.listing_info || "{}");
        } catch {}

        const sellerIds = Object.keys(bySeller);
        for (const uid of sellerIds) {
          const amountCents = Number(bySeller[uid] || 0);

          await supabaseInsertNotification({
            userId: uid,
            kind: "sale",
            title: "Your item sold!",
            body: `You earned $${(amountCents / 100).toFixed(2)}.`,
            href: "orders.html",
          });

          // Mark listing sold
          if (listingInfo[uid]?.listing_id) {
            const listingId = listingInfo[uid].listing_id;
            await fetch(`${siteBase()}/api/listing-mark-sold`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ listing_id: listingId }),
            });
          }
        }

        break;
      }

      /* ------------------------------------------------------
         BUYER CANCELS WITHIN 30 MIN → NOTIFICATIONS
      ------------------------------------------------------ */
      case "checkout.session.expired": {
        const s = event.data.object;
        const buyerId = s.metadata?.buyer_id;
        const sellerId = s.metadata?.seller_id;

        // notify buyer
        if (buyerId) {
          await supabaseInsertNotification({
            userId: buyerId,
            kind: "order_cancel",
            title: "Order cancelled",
            body: "Your payment was cancelled before completion.",
            href: "orders.html",
          });
        }

        // notify seller
        if (sellerId) {
          await supabaseInsertNotification({
            userId: sellerId,
            kind: "order_cancel",
            title: "Order cancelled",
            body: "The buyer cancelled the order.",
            href: "orders.html",
          });
        }
        break;
      }

      /* ------------------------------------------------------
         SHIPPING LABEL CREATED (if you add Shippo hook later)
      ------------------------------------------------------ */
      case "shipping.label.ready": {
        const info = event.data.object;
        const buyerId = info.metadata?.buyer_id;
        if (buyerId) {
          await supabaseInsertNotification({
            userId: buyerId,
            kind: "shipping",
            title: "Shipping label ready",
            body: "Your order is ready to ship.",
            href: "orders.html",
          });
        }
        break;
      }

      /* ------------------------------------------------------
         PAYOUT NOTIFICATIONS
      ------------------------------------------------------ */
      case "payout.paid": {
        const p = event.data.object;
        const sellerId = p.metadata?.seller_user_id;
        if (sellerId) {
          await supabaseInsertNotification({
            userId: sellerId,
            kind: "payout",
            title: "Payout sent",
            body: `Stripe deposited $${(p.amount / 100).toFixed(2)} to your bank.`,
            href: "account.html",
          });
        }
        break;
      }

      case "payout.failed": {
        const p = event.data.object;
        const sellerId = p.metadata?.seller_user_id;
        if (sellerId) {
          await supabaseInsertNotification({
            userId: sellerId,
            kind: "payout",
            title: "Payout failed",
            body: "Stripe could not send your payout. Please check your bank details.",
            href: "account.html",
          });
        }
        break;
      }

      /* ------------------------------------------------------
         DEFAULT LOGGING
      ------------------------------------------------------ */
      default:
        console.log("[stripe webhook] unhandled:", event.type);
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
  }
}
