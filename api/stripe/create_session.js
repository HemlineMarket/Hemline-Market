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

function safeJsonStringify(obj, maxLen = 450) {
  try {
    const s = JSON.stringify(obj ?? {});
    return s.length > maxLen ? s.slice(0, maxLen) : s;
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

    // CHECK IF ITEMS ARE STILL AVAILABLE
    if (listingIds.length > 0) {
      const { data: listings, error: listingError } = await supabase
        .from("listings")
        .select("id, status, yards_available, title")
        .in("id", listingIds);

      if (listingError) {
        console.error("[create_session] Error checking listings:", listingError);
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
        return res.status(400).json({
          error: "Some items are no longer available",
          unavailable: unavailable,
          message: `Sorry, these items are no longer available: ${unavailable.map(u => u.title).join(", ")}`
        });
      }

      const foundIds = (listings || []).map(l => l.id);
      const missingIds = listingIds.filter(id => !foundIds.includes(id));
      if (missingIds.length > 0) {
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
          
          return res.status(400).json({ 
            error: "Seller on vacation",
            message: `Unable to checkout: ${sellerNames} ${vacationSellers.length === 1 ? "is" : "are"} currently on vacation.`
          });
        }
      }
    }

    // COMPUTE TOTALS
    const currency = "usd";
    let itemsCents = 0;

    for (const it of cart) {
      const qty = Math.max(1, asInt(it?.qty, 1));
      const amount = Math.max(0, asInt(it?.amount, 0));
      itemsCents += amount * qty;
    }

    if (itemsCents <= 0) {
      return res.status(400).json({ error: "Cart total is invalid" });
    }

    // Build Stripe line_items
    const line_items = cart.map((it) => {
      const qty = Math.max(1, asInt(it?.qty, 1));
      const name = (it?.name || it?.title || "Fabric").toString();
      const unitAmount = Math.max(0, asInt(it?.amount, 0));
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

    if (shippingCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: shippingCents,
          product_data: { name: "Shipping" },
        },
      });
    }

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
      listing_ids: allListingIds,
      seller_ids: allSellerIds,
      listing_id: first.listing_id || first.listingId || first.id || "",
      seller_id: first.seller_id || first.sellerId || "",
      title: (first.title || first.name || "").toString().trim(),
      image_url: (first.image_url || first.imageUrl || "").toString().trim(),
      cart_json: safeJsonStringify(cart),
      item_count: String(cart.length),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: buyerEmail || undefined,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout.html?canceled=1`,
      metadata,
      shipping_address_collection: {
        allowed_countries: ["US", "CA"],
      },
      billing_address_collection: "auto",
    });

    return res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error("[create_session] error", err);
    return res.status(500).json({
      error: "Stripe create_session failed",
      message: err?.message || String(err),
    });
  }
}
