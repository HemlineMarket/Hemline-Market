// server.js
require('dotenv').config();
const express = require('express');
const app = express();

// --- Stripe (webhook needs raw body) ---
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Raw body for webhook, JSON elsewhere
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
app.use(express.json());

// --- Email (Resend) ---
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// --- Simple PDF label (temporary) ---
const PDFDocument = require('pdfkit'); // npm i pdfkit
async function makeLabelPDFBuffer(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A6', margin: 18 }); // 4x6-ish
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(12).text('HEMLINE MARKET – PREPAID LABEL', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Order: ${order.id}`);
    doc.text(`Service: ${order.shippingTier.toUpperCase()}`);
    doc.text(`Items total: $${(order.subtotalCents / 100).toFixed(2)}`);
    doc.moveDown(0.5);
    doc.text('SHIP TO:', { underline: true });
    const a = order.shipTo || {};
    doc.text(`${a.name || 'Buyer'}`);
    doc.text(`${a.address1 || ''}`);
    if (a.address2) doc.text(a.address2);
    doc.text(`${a.city || ''}, ${a.state || ''} ${a.postal || ''}`);
    doc.text(`${a.country || 'USA'}`);
    doc.moveDown(0.5);
    doc.text('FROM:', { underline: true });
    const f = order.shipFrom || {};
    doc.text(`${f.name || 'Seller'}`);
    doc.text(`${f.address1 || 'TBD'}`);
    doc.text(`${f.city || ''}, ${f.state || ''} ${f.postal || ''}`);

    doc.moveDown(1);
    doc.fontSize(8).text('Temporary demo label — replace with EasyPost/Shippo later.', { align: 'center' });

    doc.end();
  });
}

// Ship-price mirror of your checkout page
const SHIPPING = { light: 500, standard: 800, heavy: 1400 };

// (Already exists in your app) Create PI example (kept here for reference);
// Ensure you put buyerEmail, shippingTier, items, shipTo in PI metadata from checkout.
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { subtotalCents, shippingTier, buyerEmail, items, shipTo } = req.body;
    const ship = SHIPPING[shippingTier] ?? SHIPPING.standard;
    const amount = Number(subtotalCents) + ship;

    const orderId = 'HM-' + Math.random().toString(36).slice(-6).toUpperCase(); // simple ID

    const pi = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      receipt_email: buyerEmail || undefined,
      metadata: {
        order_id: orderId,
        buyer_email: buyerEmail || '',
        shipping_tier: shippingTier || 'standard',
        subtotal_cents: String(subtotalCents || 0),
        items_json: JSON.stringify(items || []),
        ship_to_json: JSON.stringify(shipTo || {}),
      },
    });

    res.json({ clientSecret: pi.client_secret, orderId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Webhook handler: payment_intent.succeeded -> send emails + label ---
async function handleStripeWebhook(req, res) {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
  } catch (err) {
    console.error('⚠️  Webhook signature verification failed.', err.message);
    return res.sendStatus(400);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;

    // Pull the data we stashed in metadata
    const order = {
      id: pi.metadata.order_id || 'HM-' + pi.id.slice(-6),
      subtotalCents: Number(pi.metadata.subtotal_cents || 0),
      shippingTier: pi.metadata.shipping_tier || 'standard',
      buyerEmail: pi.metadata.buyer_email || '',
      items: safeJSON(pi.metadata.items_json, []),
      shipTo: safeJSON(pi.metadata.ship_to_json, {}),
      shipFrom: {}, // optional: populate later from seller profile
    };

    try {
      // 1) Generate temporary label PDF
      const pdfBuffer = await makeLabelPDFBuffer(order);

      // 2) Email the seller (for now: send to same buyerEmail if you don’t have seller email handy)
      const sellerEmail = process.env.SELLER_FALLBACK_EMAIL || order.buyerEmail;
      await resend.emails.send({
        from: 'Hemline Market <orders@hemlinemarket.com>',
        to: [sellerEmail],
        subject: `Order ${order.id} is paid — your shipping label`,
        html: sellerEmailHtml(order),
        attachments: [{ filename: `${order.id}-label.pdf`, content: pdfBuffer }],
      });

      // 3) Email the buyer
      if (order.buyerEmail) {
        await resend.emails.send({
          from: 'Hemline Market <orders@hemlinemarket.com>',
          to: [order.buyerEmail],
          subject: `Thanks! We received your order ${order.id}`,
          html: buyerEmailHtml(order),
        });
      }

      console.log(`✅ Emails sent for ${order.id}`);
    } catch (err) {
      console.error('Email/label error:', err);
    }
  }

  res.json({ received: true });
}

function safeJSON(s, fallback) {
  try { return JSON.parse(s || ''); } catch { return fallback; }
}

function sellerEmailHtml(order) {
  const ship = SHIPPING[order.shippingTier] ?? SHIPPING.standard;
  const total = (order.subtotalCents + ship) / 100;
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;">
      <h2>Order ${order.id} paid</h2>
      <p>Print and attach the prepaid label (PDF attached).</p>
      <p><strong>Service:</strong> ${order.shippingTier} · <strong>Total:</strong> $${total.toFixed(2)}</p>
      <p><strong>Ship to</strong><br/>
        ${order?.shipTo?.name || 'Buyer'}<br/>
        ${order?.shipTo?.address1 || ''} ${order?.shipTo?.address2 || ''}<br/>
        ${order?.shipTo?.city || ''}, ${order?.shipTo?.state || ''} ${order?.shipTo?.postal || ''}</p>
      <p style="color:#6b7280">This is a temporary label for MVP. We’ll replace this with EasyPost/Shippo soon.</p>
    </div>`;
}

function buyerEmailHtml(order) {
  const ship = SHIPPING[order.shippingTier] ?? SHIPPING.standard;
  const total = (order.subtotalCents + ship) / 100;
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial;">
      <h2>Thanks for your order ${order.id}!</h2>
      <p>We’ll email you once the seller ships.</p>
      <p><strong>Order total:</strong> $${total.toFixed(2)} · <strong>Shipping:</strong> ${order.shippingTier}</p>
      <p>If anything looks off, reply to this email.</p>
    </div>`;
}

// Boot
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
