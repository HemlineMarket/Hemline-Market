// api/create-payment-intent.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// --- Shipping tiers (cents) ---
// < 3 yd  -> $5
// 3–10 yd -> $8
// > 10 yd -> $15
function tierCents(yards) {
  if (yards < 3) return 500;
  if (yards <= 10) return 800;
  return 1500;
}

// If item.yards is missing, count qty as yards (your cart behavior)
function yardsForItem(it) {
  const qty = Number(it.qty || 1);
  if (it.yards !== undefined && it.yards !== null && it.yards !== "") {
    const y = Number(it.yards) || 0;
    return y * qty;
  }
  return qty;
}

function computeTotals(cart) {
  // Subtotal (cents)
  let subtotal = 0;
  for (const it of cart) {
    const unit = Number(it.amount || 0); // cents per unit
    const qty = Number(it.qty || 1);
    if (!Number.isFinite(unit) || unit < 0) throw new Error("Invalid unit price");
    if (!Number.isFinite(qty) || qty < 1) throw new Error("Invalid quantity");
    subtotal += unit * qty;
  }

  // Group yards per seller and compute shipping lines
  const groups = {};
  for (const it of cart) {
    const sellerId = it.sellerId || "default_seller";
    const sellerName = it.sellerName || "Seller";
    const yards = yardsForItem(it);
    if (!groups[sellerId]) groups[sellerId] = { name: sellerName, yards: 0 };
    groups[sellerId].yards += yards;
  }

  const shipLines = Object.values(groups).map(g => ({
    sellerName: g.name,
    yards: g.yards,
    fee_cents: tierCents(g.yards),
  }));

  const shipping = shipLines.reduce((s, l) => s + l.fee_cents, 0);
  const total = subtotal + shipping;

  return { subtotal, shipping, total, shipLines };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { cart, email } = req.body || {};
    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is required" });
    }

    const totals = computeTotals(cart);

    const intent = await stripe.paymentIntents.create({
      amount: totals.total,           // server-computed
      currency: "usd",
      receipt_email: email || undefined,
      automatic_payment_methods: { enabled: true },
      metadata: {
        subtotal_cents: String(totals.subtotal),
        shipping_cents: String(totals.shipping),
        ship_breakdown: JSON.stringify(
          totals.shipLines.map(l => ({
            seller: l.sellerName,
            yards: Number(l.yards.toFixed(2)),
            fee_cents: l.fee_cents,
          }))
        ),
      },
    });

    return res.status(200).json({
      clientSecret: intent.client_secret,
      totals, // optional, handy for client sanity display
    });
  } catch (err) {
    console.error("create-payment-intent error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
