// File: public/scripts/purchase-success.js
// Creates a new purchase record after successful Stripe checkout.

(async () => {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.error("[purchase-success] Supabase client missing.");
    return;
  }

  // --- Read parameters returned from Stripe redirect ---
  const url = new URL(window.location.href);
  const listingId = url.searchParams.get("listing_id");
  const yards = Number(url.searchParams.get("yards") || 1);
  const paymentIntent = url.searchParams.get("payment_intent");

  if (!listingId || !paymentIntent) {
    console.warn("[purchase-success] Missing listing_id or payment_intent. Nothing to save.");
    return;
  }

  // --- Ensure user session ---
  async function ensureSession(maxMs = 3000) {
    let { data: { session } } = await supabase.auth.getSession();
    const start = Date.now();
    while (!session?.user && Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 120));
      ({ data: { session } } = await supabase.auth.getSession());
    }
    return session;
  }

  const session = await ensureSession();
  if (!session || !session.user) {
    console.error("[purchase-success] No active user session.");
    return;
  }

  const buyerId = session.user.id;
  const buyerEmail = session.user.email || null;

  // --- Load listing snapshot ---
  const { data: listing, error: listingErr } = await supabase
    .from("listings")
    .select("*")
    .eq("id", listingId)
    .single();

  if (listingErr || !listing) {
    console.error("[purchase-success] Listing load error:", listingErr);
    return;
  }

  // Compute totals
  const centsPerYard = Number(listing.price_cents || 0);
  const totalCents = centsPerYard * yards;

  const snapshot = [{
    id: listing.id,
    name: listing.title || listing.name,
    image_url: listing.image_url,
    yards
  }];

  // --- Insert Purchase Record ---
  const { error: insertErr } = await supabase
    .from("orders")
    .insert({
      buyer_id: buyerId,
      buyer_email: buyerEmail,
      seller_id: listing.user_id,
      listing_id: listing.id,
      listing_title: listing.title || listing.name,
      listing_image_url: listing.image_url,
      listing_snapshot: snapshot,
      total_cents: totalCents,
      currency: "USD",
      stripe_payment_intent: paymentIntent,
      status: "paid"
    });

  if (insertErr) {
    console.error("[purchase-success] Failed to save purchase:", insertErr);
    return;
  }

  console.log("[purchase-success] Purchase saved successfully.");
})();
