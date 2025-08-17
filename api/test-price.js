// /api/test-price.js
import { priceToCents, centsToUSD, assertUSD } from "../lib/price.js";

export default function handler(req, res) {
  try {
    const currency = assertUSD();
    const cents = priceToCents("24.99"); // hard-coded test
    const dollars = centsToUSD(cents);
    res.status(200).json({ ok: true, currency, cents, dollars });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
