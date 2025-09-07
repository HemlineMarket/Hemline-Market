// /api/stripe-webhook.js
import Stripe from "stripe";

// Vercel/Next needs raw body for Stripe signature verification
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const sig = req.headers["stripe-signature"];
  let event;

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).send(`Raw body error: ${e.message}`);
  }

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`);
  }

  // Handle successful Checkout
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    try {
      // Get line items to show in the email
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 50,
      });

      const toEmail = session.customer_details?.email || session.customer_email;

      // Compose a simple HTML email
      const itemsHtml = lineItems.data
        .map(
          (li) =>
            `<tr>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;">${li.description}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${li.quantity}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">$${(
                li.amount_total / 100
              ).toFixed(2)}</td>
            </tr>`
        )
        .join("");

      const total = (session.amount_total / 100).toFixed(2);
      const currency = (session.currency || "usd").toUpperCase();

      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:#111827">
          <h2 style="margin:0 0 8px;">Thanks for your order!</h2>
          <p style="margin:0 0 12px;">Order <strong>${session.id}</strong> has been confirmed.</p>
          <table style="border-collapse:collapse;width:100%;max-width:560px">
            <thead>
              <tr>
                <th style="text-align:left;padding:6px 10px;border-bottom:2px solid #111827;">Item</th>
                <th style="text-align:center;padding:6px 10px;border-bottom:2px solid #111827;">Qty</th>
                <th style="text-align:right;padding:6px 10px;border-bottom:2px solid #111827;">Amount</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
            <tfoot>
              <tr>
                <td></td>
                <td style="padding:8px 10px;text-align:right;font-weight:700;">Total</td>
                <td style="padding:8px 10px;text-align:right;font-weight:700;">$${total} ${currency}</td>
              </tr>
            </tfoot>
          </table>
          <p style="margin-top:12px;">You can reply to this email if you have any questions.</p>
        </div>
      `;

      // Send via Postmark
      const pmRes = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN,
        },
        body: JSON.stringify({
          From: process.env.FROM_EMAIL,
          To: toEmail,
          Subject: "Your Hemline Market order confirmation",
          HtmlBody: html,
          MessageStream: "outbound",
        }),
      });

      if (!pmRes.ok) {
        const t = await pmRes.text();
        console.error("Postmark error:", t);
      }
    } catch (e) {
      console.error("Webhook handling error:", e);
      // Don’t return 4xx here if email fails; acknowledge to Stripe so it doesn’t retry forever
    }
  }

  return res.json({ received: true });
}
