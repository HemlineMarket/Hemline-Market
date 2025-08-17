export default async function handler(req, res) {
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return res.status(500).json({ ok: false, error: "Missing STRIPE_SECRET_KEY" });
    }

    const r = await fetch("https://api.stripe.com/v1/account", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ ok: false, error: `Stripe error: ${text}` });
    }

    const acct = await r.json();
    return res.status(200).json({ ok: true, account: acct.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
