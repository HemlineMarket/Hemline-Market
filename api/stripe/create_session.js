// FILE: api/stripe/create_session.js
// REPLACE your existing file with this entire file
//
// FIXES:
// - Checks if items are sold before allowing checkout
// - Prevents two people buying same item at once
// - Processes ALL items in cart (not just the first one)

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function getOrigin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  return "https://hemlinemarket.com";
}

function asInt(n, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function safeJsonStringify(obj, maxLen = 500) {
  // Stripe metadata values have a 500 character limit
  // For larger carts, we store just essential data (listing IDs and yards)
  try {
    const s = JSON.stringify(obj ?? {});
    if (s.length <= maxLen) return s;
    
    // If full cart is too long, create a minimal version with just IDs and yards
    const items = Array.isArray(obj) ? obj : (obj ? [obj] : []);
    const minimal = items.map(item => ({
      id: item.listing_id || item.listingId || item.id,
      yards: item.yards || 1
    }));
    let minStr = JSON.stringify(minimal);
    // Drop items from the end until the string fits
    // (better to have partial valid JSON than broken JSON from .slice)
    while (minStr.length > maxLen && minimal.length > 1) {
      minimal.pop();
      minStr = JSON.stringify(minimal);
    }
    // If even a single item is too long, return empty string rather than broken JSON
    if (minStr.length > maxLen) return "";
    return minStr;
  } catch {
    return "";
  }
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Truncate a comma-separated ID list to fit within maxLen chars
// without cutting a UUID in half
function truncateIdList(idString, maxLen = 490) {
  if (idString.length <= maxLen) return idString;
  const ids = idString.split(",");
  let result = "";
  for (const id of ids) {
    const candidate = result ? result + "," + id : id;
    if (candidate.length > maxLen) break;
    result = candidate;
  }
  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const origin = getOrigin(req);
    const body = req.body || {};
    const cart = Array.isArray(body.cart) ? body.cart : [];
    const buyerEmail = (body?.buyer?.email || body?.buyer_email || "").toString().trim();
    const buyerId = (body?.buyer?.id || body?.buyer_id || "").toString().trim();
    const shippingCents = Math.max(0, asInt(body?.shipping_cents, 0));

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });
    }

    if (!cart.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      return res.status(500).json({ error: "Database connection failed" });
    }

    // Get all listing IDs from cart
    const listingIds = cart
      .map(item => item.listing_id || item.listingId || item.id)
      .filter(Boolean);

    const now = new Date().toISOString();

    // ACQUIRE CHECKOUT LOCK FIRST (prevents race condition with other buyers)
    // By creating the lock before checking availability, two simultaneous buyers
    // can't both pass the check before either creates a lock.
    if (listingIds.length > 0 && buyerId) {
      const lockExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const locks = listingIds.map(listing_id => ({
        listing_id,
        user_id: buyerId,
        expires_at: lockExpiresAt,
        created_at: now
      }));

      await supabase
        .from("checkout_locks")
        .upsert(locks, { onConflict: "listing_id", ignoreDuplicates: false });

      // Now re-read locks to check if WE actually hold them
      // (another buyer's upsert may have overwritten ours)
      const { data: currentLocks } = await supabase
        .from("checkout_locks")
        .select("listing_id, user_id, expires_at")
        .in("listing_id", listingIds)
        .gt("expires_at", now);

      if (currentLocks) {
        const blockedBy = currentLocks.filter(lock => lock.user_id !== buyerId);
        if (blockedBy.length > 0) {
          // Another buyer overwrote our lock -- clean up and reject
          await supabase.from("checkout_locks").delete()
            .in("listing_id", listingIds)
            .eq("user_id", buyerId);
          return res.status(409).json({
            error: "Items locked by another buyer",
            locked_items: blockedBy.map(l => l.listing_id),
            message: "One or more items are being purchased by another buyer. Please try again in a few minutes."
          });
        }
      }
    }

    // Helper to release our locks on early-exit failures
    async function releaseLocks() {
      if (listingIds.length > 0 && buyerId) {
        await supabase.from("checkout_locks").delete()
          .in("listing_id", listingIds)
          .eq("user_id", buyerId);
      }
    }

    // CHECK IF ITEMS ARE STILL AVAILABLE
    if (listingIds.length > 0) {
      const { data: listings, error: listingError } = await supabase
        .from("listings")
        .select("id, status, yards_available, title")
        .in("id", listingIds);

      if (listingError) {
        console.error("[create_session] Error checking listings:", listingError);
        await releaseLocks();
        return res.status(500).json({ error: "Could not verify item availability" });
      }

      const unavailable = [];
      for (const listing of listings || []) {
        const status = (listing.status || "").toUpperCase();
        const yards = Number(listing.yards_available);
        
        if (status === "SOLD" || yards <= 0) {
          unavailable.push({
            id: listing.id,
            title: listing.title || "Unknown item",
            reason: status === "SOLD" ? "sold" : "out of stock"
          });
        }
      }

      if (unavailable.length > 0) {
        await releaseLocks();
        return res.status(400).json({
          error: "Some items are no longer available",
          unavailable: unavailable,
          message: `Sorry, these items are no longer available: ${unavailable.map(u => u.title).join(", ")}`
        });
      }

      const foundIds = (listings || []).map(l => l.id);
      const missingIds = listingIds.filter(id => !foundIds.includes(id));
      if (missingIds.length > 0) {
        await releaseLocks();
        return res.status(400).json({
          error: "Some items were not found",
          missing: missingIds
        });
      }
    }

    // VACATION CHECK
    const sellerIds = cart
      .map(item => item.seller_id || item.sellerId)
      .filter(Boolean);
    
    const bodySellerId = (body.seller_id || "").toString().trim();
    if (bodySellerId && !sellerIds.includes(bodySellerId)) {
      sellerIds.push(bodySellerId);
    }

    if (sellerIds.length > 0) {
      const uniqueSellerIds = [...new Set(sellerIds)];
      
      const { data: sellers, error: sellerError } = await supabase
        .from("profiles")
        .select("id, vacation_mode, store_name, first_name")
        .in("id", uniqueSellerIds);

      if (!sellerError && sellers) {
        const vacationSellers = sellers.filter(s => s.vacation_mode === true);
        
        if (vacationSellers.length > 0) {
          const sellerNames = vacationSellers
            .map(s => s.store_name || `${s.first_name}'s Shop` || "This seller")
            .join(", ");
          
          await releaseLocks();
          return res.status(400).json({ 
            error: "Seller on vacation",
            message: `Unable to checkout: ${sellerNames} ${vacationSellers.length === 1 ? "is" : "are"} currently on vacation.`
          });
        }
      }
    }

    // COMPUTE TOTALS
    // amount is per-yard price in cents, must multiply by yards
    const currency = "usd";
    let itemsCents = 0;

    // Helper to calculate line total for an item
    const calcLineTotal = (it) => {
      const qty = Math.max(1, asInt(it?.qty, 1));
      const amount = Math.max(0, asInt(it?.amount, 0)); // cents per yard
      const yards = Math.max(1, parseFloat(it?.yards) || 1);
      
      // If price_total is explicitly set, use it
      if (it?.price_total && asInt(it.price_total, 0) > 0) {
        return asInt(it.price_total, 0) * qty;
      }
      
      // Otherwise: amount (cents/yd) × yards × qty
      return Math.round(amount * yards * qty);
    };

    for (const it of cart) {
      itemsCents += calcLineTotal(it);
    }

    if (itemsCents <= 0) {
      await releaseLocks();
      return res.status(400).json({ error: "Cart total is invalid" });
    }

    // Build Stripe line_items
    const line_items = cart.map((it) => {
      const qty = Math.max(1, asInt(it?.qty, 1));
      const name = (it?.name || it?.title || "Fabric").toString();
      const lineTotal = calcLineTotal(it);
      // Stripe wants unit_amount, so we divide by qty to get per-item price
      const unitAmount = Math.round(lineTotal / qty);
      return {
        quantity: qty,
        price_data: {
          currency,
          unit_amount: unitAmount,
          product_data: {
            name: name.length > 120 ? name.slice(0, 120) : name,
          },
        },
      };
    });

    // NOTE: Shipping is added via shipping_options below (when hasShippingAddress is true)
    // or collected by Stripe. Do NOT add shipping as a line_item here to avoid double-charging.

    // STORE ALL ITEM IDS (not just first one)
    const first = cart[0] || {};
    
    const allListingIds = cart
      .map(item => item.listing_id || item.listingId || item.id)
      .filter(Boolean)
      .join(",");
    
    const allSellerIds = [...new Set(cart
      .map(item => item.seller_id || item.sellerId)
      .filter(Boolean)
    )].join(",");

    const metadata = {
      buyer_email: buyerEmail || "",
      buyer_id: buyerId || "",
      shipping_cents: String(shippingCents),
      price_cents: String(itemsCents),
      listing_ids: truncateIdList(allListingIds, 490),
      seller_ids: truncateIdList(allSellerIds, 490),
      listing_id: first.listing_id || first.listingId || first.id || "",
      seller_id: first.seller_id || first.sellerId || "",
      title: (first.title || first.name || "").toString().trim().slice(0, 200),
      image_url: (first.image_url || first.imageUrl || "").toString().trim().slice(0, 400),
      cart_json: safeJsonStringify(cart),
      item_count: String(cart.length),
    };

    // Build shipping address for pre-fill (if provided)
    const shippingAddr = body.shipping_address || {};
    const hasShippingAddress = !!(shippingAddr.line1 && shippingAddr.city && shippingAddr.state && shippingAddr.postal_code);

    // Add shipping address to metadata so webhook can access it
    if (hasShippingAddress) {
      metadata.ship_name = (shippingAddr.name || "").slice(0, 100);
      metadata.ship_line1 = (shippingAddr.line1 || "").slice(0, 100);
      metadata.ship_line2 = (shippingAddr.line2 || "").slice(0, 100);
      metadata.ship_city = (shippingAddr.city || "").slice(0, 50);
      metadata.ship_state = (shippingAddr.state || "").slice(0, 20);
      metadata.ship_postal = (shippingAddr.postal_code || "").slice(0, 20);
      metadata.ship_country = "US";
    }

    const sessionParams = {
      mode: "payment",
      line_items,
      customer_email: buyerEmail || undefined,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html?canceled=1`,
      metadata,
      billing_address_collection: "auto",
    };

    // Lock already acquired at the top of the handler

    // If we have shipping address from our checkout, use shipping_options instead of collection
    // This shows a fixed shipping rate and skips Stripe's address form
    if (hasShippingAddress) {
      sessionParams.shipping_options = [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: shippingCents, currency: 'usd' },
          display_name: 'Standard Shipping',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 3 },
            maximum: { unit: 'business_day', value: 7 },
          },
        },
      }];
      // Record the shipping address with the payment intent
      sessionParams.payment_intent_data = {
        shipping: {
          name: shippingAddr.name || "Customer",
          address: {
            line1: shippingAddr.line1,
            line2: shippingAddr.line2 || "",
            city: shippingAddr.city,
            state: shippingAddr.state,
            postal_code: shippingAddr.postal_code,
            country: "US",
          },
        },
      };
    } else {
      // No address provided - let Stripe collect it
      sessionParams.shipping_address_collection = {
        allowed_countries: ["US"],
      };
      // When Stripe collects the address, we need to add shipping as a line item
      // since shipping_options isn't being used
      if (shippingCents > 0) {
        sessionParams.line_items.push({
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: shippingCents,
            product_data: { name: "Shipping" },
          },
        });
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error("[create_session] error", err);
    // Release locks on any failure
    try {
      const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];
      const buyerId = (req.body?.buyer?.id || req.body?.buyer_id || "").toString().trim();
      const ids = cart.map(item => item.listing_id || item.listingId || item.id).filter(Boolean);
      if (ids.length > 0 && buyerId) {
        const sb = getSupabaseAdmin();
        if (sb) await sb.from("checkout_locks").delete().in("listing_id", ids).eq("user_id", buyerId);
      }
    } catch (_) {}
    // Sanitize error - don't leak Stripe internals to client
    const safeMessages = {
      card_declined: "Your card was declined. Please try a different payment method.",
      expired_card: "Your card has expired. Please use a different card.",
      incorrect_cvc: "Incorrect CVC. Please check your card details.",
      processing_error: "A processing error occurred. Please try again.",
      rate_limit: "Too many requests. Please wait a moment and try again.",
    };
    const stripeCode = err?.code || err?.raw?.code || "";
    const safeMsg = safeMessages[stripeCode] || "Could not start checkout. Please try again.";
    return res.status(500).json({
      error: "Checkout failed",
      message: safeMsg,
    });
  }
}
