import type { VercelRequest, VercelResponse } from "vercel";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-06-20",
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, amount } = req.body as { name?: string; amount?: number };

    // Simple validation
    if (!name || !amount || !Number.isFinite(amount))
      return res.status(400).json({ error: "Missing name/amount" });

    // amount = cents; keep safe range ($1–$5,000)
    if (amount < 100 || amount > 500000)
      return res.status(400).json({ error: "Invalid amount" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name },
            unit_amount: Math.round(amount),
          },
          quantity: 1,
        },
      ],
      // send them back to dashboard with status
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://hemlinemarket.com"}/dashboard.html?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://hemlinemarket.com"}/dashboard.html?canceled=true`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Checkout failed" });
  }
}
