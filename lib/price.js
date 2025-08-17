// lib/price.js
const USD_MIN_CENTS = 50;         // $0.50 floor to avoid $0 or accidental free
const USD_MAX_CENTS = 2000000;    // $20,000 ceiling (guardrail)

export function assertUSD() {
  const currency = (process.env.STRIPE_CURRENCY || "usd").toLowerCase();
  if (currency !== "usd") {
    throw new Error(`Only USD supported for MVP. Got: ${currency}`);
  }
  return "usd";
}

export function priceToCents(input) {
  // Accept numbers or strings like "24", "24.9", "24.99", "$24.99", " 24.99 USD "
  if (input == null) throw new Error("Missing price");
  const cleaned = String(input).replace(/[^0-9.]/g, "").trim();
  if (!cleaned) throw new Error(`Invalid price: ${input}`);

  // Normalize to two decimals, then convert to integer cents
  const asNumber = Number(cleaned);
  if (!Number.isFinite(asNumber)) throw new Error(`Invalid number: ${input}`);

  // Round to cents (avoids 24.1 -> 2409.999 issues)
  const cents = Math.round(asNumber * 100);

  // Guardrails
  if (cents < USD_MIN_CENTS) throw new Error(`Price too low: ${cents}¢`);
  if (cents > USD_MAX_CENTS) throw new Error(`Price too high: ${cents}¢`);
  return cents;
}

export function centsToUSD(cents) {
  if (!Number.isInteger(cents)) throw new Error("cents must be integer");
  return (cents / 100).toFixed(2);
}
