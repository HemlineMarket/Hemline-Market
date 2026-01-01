// File: /api/cart/hold.js
// Manages cart holds - shows "In someone's cart" on browse/index
//
// POST - Create or refresh hold (when item added to cart)
// DELETE - Remove hold (when item removed from cart)
// GET - Check holds for multiple listings (for browse page)

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    // POST - Create/refresh hold
    if (req.method === "POST") {
      const { listing_id, user_id } = req.body || {};
      
      if (!listing_id) {
        return res.status(400).json({ error: "Missing listing_id" });
      }

      // Delete any existing hold for this listing first
      await supabaseAdmin
        .from("cart_holds")
        .delete()
        .eq("listing_id", listing_id);

      // Create new hold (no expiry - lasts until item removed from cart or purchased)
      const { data, error } = await supabaseAdmin
        .from("cart_holds")
        .insert({ 
          listing_id, 
          user_id: user_id || null
        })
        .select()
        .single();

      if (error) {
        console.error("[cart/hold] POST error:", error);
        return res.status(500).json({ error: "Failed to create hold", details: error.message });
      }

      return res.status(200).json({ ok: true, hold: data });
    }

    // DELETE - Remove hold
    if (req.method === "DELETE") {
      const { listing_id, user_id } = req.body || {};
      
      if (!listing_id) {
        return res.status(400).json({ error: "Missing listing_id" });
      }

      const query = supabaseAdmin
        .from("cart_holds")
        .delete()
        .eq("listing_id", listing_id);
      
      // If user_id provided, only delete that user's hold
      if (user_id) {
        query.eq("user_id", user_id);
      }

      const { error } = await query;

      if (error) {
        console.error("[cart/hold] DELETE error:", error);
        return res.status(500).json({ error: "Failed to remove hold" });
      }

      return res.status(200).json({ ok: true });
    }

    // GET - Check holds for listings
    if (req.method === "GET") {
      const { listings, user_id } = req.query;
      
      // Parse listing IDs (comma-separated)
      const listingIds = listings ? listings.split(",").filter(Boolean) : [];
      
      if (!listingIds.length) {
        return res.status(200).json({ holds: {} });
      }

      // Get all holds for these listings (no expiry check)
      const { data: holds, error } = await supabaseAdmin
        .from("cart_holds")
        .select("listing_id, user_id")
        .in("listing_id", listingIds);

      if (error) {
        console.error("[cart/hold] GET error:", error);
        return res.status(500).json({ error: "Failed to fetch holds" });
      }

      // Build response: { listing_id: { held: true, isYours: boolean } }
      const result = {};
      (holds || []).forEach(h => {
        result[h.listing_id] = {
          held: true,
          isYours: user_id ? h.user_id === user_id : false
        };
      });

      return res.status(200).json({ holds: result });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("[cart/hold] Unhandled error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
