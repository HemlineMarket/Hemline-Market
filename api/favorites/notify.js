// File: /api/favorites/notify.js
// Creates a favorite-record and notifies the seller that someone favorited their listing.
//
// ENV:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// SITE_URL

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

function site() {
  return (process.env.SITE_URL || "").replace(/\/$/, "");
}

async function notify(payload) {
  try {
    await fetch(`${site()}/api/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Must be logged in
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthenticated" });

  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return res.status(401).json({ error: "Invalid session" });

  const { listing_id } = req.body || {};
  if (!listing_id) return res.status(400).json({ error: "Missing listing_id" });

  // Fetch listing info
  const { data: listing, error: listingErr } = await client
    .from("listings")
    .select("*")
    .eq("id", listing_id)
    .single();

  if (listingErr || !listing)
    return res.status(404).json({ error: "Listing not found" });

  // Cannot favorite your own listing
  if (listing.seller_id === user.id) {
    return res.status(400).json({ error: "Cannot favorite your own item" });
  }

  // Insert favorite (prevent duplicates)
  await client
    .from("favorites")
    .upsert(
      {
        user_id: user.id,
        listing_id,
      },
      {
        onConflict: "user_id, listing_id",
      }
    );

  // Notify seller
  await notify({
    user_id: listing.seller_id,
    kind: "favorite",
    title: "Your item was favorited",
    body: `${listing.title || "Your fabric"} is getting attention.`,
    href: `${site()}/listing.html?id=${listing_id}`,
  });

  return res.status(200).json({ success: true });
}
