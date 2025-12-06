// public/scripts/cart.js
// Manages cart actions, prevents checkout of SOLD or IN_CART listings,
// and sets listing status to IN_CART when user begins checkout.

(async () => {
  const supabase = window.HM && window.HM.supabase;
  if (!supabase) {
    console.error("[cart] Missing Supabase client");
    return;
  }

  // Utility: ensure logged-in user
  async function ensureSession(maxMs = 3000) {
    let { data: { session } } = await supabase.auth.getSession();
    const start = Date.now();
    while (!session?.user && Date.now() - start < maxMs) {
      await new Promise(res => setTimeout(res,120));
      ({ data: { session } } = await supabase.auth.getSession());
    }
    return session;
  }

  // Attach this to your Add-to-cart button from listing.html
  window.HM = window.HM || {};
  window.HM.addToCart = async function(listingId, yards) {
    const session = await ensureSession();
    if (!session || !session.user) {
      window.location.href = "auth.html?view=login";
      return;
    }

    // Load listing state
    const { data: listing, error } = await supabase
      .from("listings")
      .select("status, price_cents, user_id, title, image_url")
      .eq("id", listingId)
      .single();

    if (error || !listing) {
      alert("Unable to load listing.");
      return;
    }

    // Block checkout if listing already sold
    if (listing.status === "SOLD") {
      alert("This item is no longer available.");
      return;
    }

    // Block if someone else currently has it in cart
    if (listing.status === "IN_CART") {
      alert("Someone is already checking out with this item.");
      return;
    }

    // Mark listing IN_CART
    const { error: upd } = await supabase
      .from("listings")
      .update({
        status: "IN_CART",
        cart_set_at: new Date().toISOString()
      })
      .eq("id", listingId);

    if (upd) {
      alert("Unable to reserve item.");
      return;
    }

    // Build the cart object for Stripe session
    const cart = [{
      listing_id: listingId,
      seller_user_id: listing.user_id,
      name: listing.title || "Fabric",
      image_url: listing.image_url,
      qty: 1,
      yards: yards,
      amount: listing.price_cents
    }];

    // Create checkout session
    const res = await fetch("/api/stripe/create_session", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({
        cart,
        buyer: {
          id: session.user.id,
          email: session.user.email
        },
        shipping_cents: 0
      })
    });

    const out = await res.json();

    if (out.url) {
      window.location.href = out.url;
    } else {
      alert("Unable to begin checkout.");
    }
  };


  // Auto-cleanup: if a listing is left IN_CART for > 20 minutes, unlock it.
  // (Runs whenever user loads the site.)
  async function cleanStaleCarts() {
    const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    await supabase
      .from("listings")
      .update({
        status: "ACTIVE",
        cart_set_at: null
      })
      .lt("cart_set_at", cutoff)
      .eq("status", "IN_CART");
  }

  cleanStaleCarts();
})();
