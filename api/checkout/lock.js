// File: /api/checkout/lock.js
// Server-side checkout lock to prevent race conditions
//
// When a user clicks "Checkout" and we're about to redirect to Stripe,
// we lock these items for 10 minutes. If another user tries to checkout
// the same items, they get blocked.
//
// POST - Acquire lock for items (before Stripe redirect)
// DELETE - Release lock (on cancel/timeout)
// GET - Check if items are locked
//
// This prevents two people from paying for the same fabric simultaneously.

import { createClient } from "@supabase/supabase-js";

const LOCK_DURATION_MS = 10 * 60 * 1000; // 10 minutes

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// UUID validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(str) {
  return str && typeof str === "string" && UUID_REGEX.test(str);
}

export default async function handler(req, res) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: "Database not configured" });
  }

  // Clean up expired locks on every request (lightweight garbage collection)
  const now = new Date().toISOString();
  await supabase
    .from("checkout_locks")
    .delete()
    .lt("expires_at", now);

  // POST - Acquire lock
  if (req.method === "POST") {
    const { listing_ids, user_id } = req.body || {};

    if (!user_id || !isValidUUID(user_id)) {
      return res.status(400).json({ error: "Valid user_id required" });
    }

    if (!Array.isArray(listing_ids) || listing_ids.length === 0) {
      return res.status(400).json({ error: "listing_ids array required" });
    }

    // Validate all IDs
    const validIds = listing_ids.filter(isValidUUID);
    if (validIds.length !== listing_ids.length) {
      return res.status(400).json({ error: "Invalid listing_id format" });
    }

    // Check if any items are already locked by someone else
    const { data: existingLocks, error: checkError } = await supabase
      .from("checkout_locks")
      .select("listing_id, user_id, expires_at")
      .in("listing_id", validIds)
      .gt("expires_at", now);

    if (checkError) {
      console.error("[checkout/lock] Check error:", checkError);
      return res.status(500).json({ error: "Failed to check locks" });
    }

    // Filter locks that belong to OTHER users
    const blockedBy = (existingLocks || []).filter(lock => lock.user_id !== user_id);
    
    if (blockedBy.length > 0) {
      return res.status(409).json({
        error: "Items locked by another buyer",
        locked_items: blockedBy.map(l => l.listing_id),
        message: "One or more items are being purchased by another buyer. Please try again in a few minutes."
      });
    }

    // Also check if items are already SOLD
    const { data: listings, error: listingError } = await supabase
      .from("listings")
      .select("id, status, title")
      .in("id", validIds);

    if (listingError) {
      console.error("[checkout/lock] Listing check error:", listingError);
      return res.status(500).json({ error: "Failed to verify items" });
    }

    const soldItems = (listings || []).filter(l => 
      (l.status || "").toUpperCase() === "SOLD"
    );

    if (soldItems.length > 0) {
      return res.status(400).json({
        error: "Items no longer available",
        sold_items: soldItems.map(l => ({ id: l.id, title: l.title })),
        message: `Sorry, these items have already sold: ${soldItems.map(l => l.title).join(", ")}`
      });
    }

    // Create locks (upsert to handle refresh)
    const expiresAt = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
    const locks = validIds.map(listing_id => ({
      listing_id,
      user_id,
      expires_at: expiresAt,
      created_at: now
    }));

    const { error: insertError } = await supabase
      .from("checkout_locks")
      .upsert(locks, { 
        onConflict: "listing_id",
        ignoreDuplicates: false 
      });

    if (insertError) {
      console.error("[checkout/lock] Insert error:", insertError);
      return res.status(500).json({ error: "Failed to acquire lock" });
    }

    return res.status(200).json({ 
      ok: true, 
      locked_until: expiresAt,
      listing_ids: validIds
    });
  }

  // DELETE - Release lock
  if (req.method === "DELETE") {
    const { listing_ids, user_id } = req.body || {};

    if (!user_id || !isValidUUID(user_id)) {
      return res.status(400).json({ error: "Valid user_id required" });
    }

    if (!Array.isArray(listing_ids) || listing_ids.length === 0) {
      return res.status(400).json({ error: "listing_ids array required" });
    }

    // Only allow releasing your own locks
    const { error } = await supabase
      .from("checkout_locks")
      .delete()
      .in("listing_id", listing_ids)
      .eq("user_id", user_id);

    if (error) {
      console.error("[checkout/lock] Delete error:", error);
      return res.status(500).json({ error: "Failed to release lock" });
    }

    return res.status(200).json({ ok: true });
  }

  // GET - Check locks
  if (req.method === "GET") {
    const listings = req.query.listings;
    if (!listings) {
      return res.status(200).json({ locks: {} });
    }

    const listingIds = listings.split(",").filter(isValidUUID);
    if (listingIds.length === 0) {
      return res.status(200).json({ locks: {} });
    }

    const { data: locks, error } = await supabase
      .from("checkout_locks")
      .select("listing_id, user_id, expires_at")
      .in("listing_id", listingIds)
      .gt("expires_at", now);

    if (error) {
      console.error("[checkout/lock] GET error:", error);
      return res.status(500).json({ error: "Failed to check locks" });
    }

    const result = {};
    const userId = req.query.user_id;
    (locks || []).forEach(lock => {
      result[lock.listing_id] = {
        locked: true,
        isYours: userId ? lock.user_id === userId : false,
        expires_at: lock.expires_at
      };
    });

    return res.status(200).json({ locks: result });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
