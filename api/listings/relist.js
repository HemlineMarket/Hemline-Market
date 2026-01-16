// FILE: api/listings/relist.js
// Relist a purchased listing - creates a new listing based on an existing one
// with "relisted from [seller name]" watermark on images
//
// POST /api/listings/relist
// Body: { listing_id: "original-listing-uuid" }
// Headers: Authorization: Bearer <token>
//
// The new listing:
// - Copies all details from the original listing
// - Adds relisted_from_listing_id and relisted_from_seller_id
// - Watermarks all images with original seller's store name or name
// - Sets status to DRAFT for the buyer to review/edit before publishing

import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = getSupabaseAdmin();

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return null;
  }

  return user;
}

// Add watermark text to image URL using Supabase transform
// Returns a URL that will render the image with watermark overlay
function createWatermarkedImageUrl(originalUrl, relistText) {
  // If it's a Supabase storage URL, we can use transforms
  // Otherwise, we'll store the relisted_from info and let the frontend handle display
  // For now, we'll just track the metadata - actual watermarking happens in sell.html
  return originalUrl;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    // Require authentication
    const user = await verifyAuth(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized - please sign in" });
    }

    const { listing_id } = req.body || {};

    if (!listing_id) {
      return res.status(400).json({ error: "Missing listing_id" });
    }

    const supabase = getSupabaseAdmin();

    // 1. Verify the user owns this listing (purchased it)
    // Check if there's a DELIVERED order where they're the buyer
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(`
        id,
        buyer_id,
        seller_id,
        listing_id,
        listing_ids,
        status
      `)
      .eq("buyer_id", user.id)
      .eq("status", "DELIVERED")
      .or(`listing_id.eq.${listing_id},listing_ids.cs.{${listing_id}}`)
      .maybeSingle();

    // Also check COMPLETE status (after payout)
    let validOrder = order;
    if (!order) {
      const { data: completeOrder } = await supabase
        .from("orders")
        .select(`
          id,
          buyer_id,
          seller_id,
          listing_id,
          listing_ids,
          status
        `)
        .eq("buyer_id", user.id)
        .eq("status", "COMPLETE")
        .or(`listing_id.eq.${listing_id},listing_ids.cs.{${listing_id}}`)
        .maybeSingle();
      validOrder = completeOrder;
    }

    if (!validOrder) {
      return res.status(403).json({ 
        error: "You can only relist items you've purchased and received" 
      });
    }

    // 2. Get the original listing details
    const { data: originalListing, error: listingErr } = await supabase
      .from("listings")
      .select("*")
      .eq("id", listing_id)
      .maybeSingle();

    if (listingErr || !originalListing) {
      return res.status(404).json({ error: "Original listing not found" });
    }

    // 3. Get the original seller's display name for watermark
    const originalSellerId = originalListing.seller_id;
    const { data: originalSeller } = await supabase
      .from("profiles")
      .select("store_name, first_name, last_name")
      .eq("id", originalSellerId)
      .maybeSingle();

    // Build the "relisted from" text: store_name or "FirstName L."
    let relistFromText = "Hemline Seller";
    if (originalSeller) {
      if (originalSeller.store_name) {
        relistFromText = originalSeller.store_name;
      } else if (originalSeller.first_name) {
        const lastInitial = originalSeller.last_name 
          ? ` ${originalSeller.last_name.charAt(0)}.`
          : "";
        relistFromText = `${originalSeller.first_name}${lastInitial}`;
      }
    }

    // 4. Check if already relisted by this user
    const { data: existingRelist } = await supabase
      .from("listings")
      .select("id")
      .eq("seller_id", user.id)
      .eq("relisted_from_listing_id", listing_id)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingRelist) {
      return res.status(400).json({ 
        error: "You've already created a relist for this item",
        existing_listing_id: existingRelist.id
      });
    }

    // 5. Create the new listing (as DRAFT)
    const newListingData = {
      seller_id: user.id,
      title: originalListing.title,
      description: originalListing.description,
      price: originalListing.price,
      fabric_type: originalListing.fabric_type,
      fabric_content: originalListing.fabric_content,
      color: originalListing.color,
      pattern: originalListing.pattern,
      width_inches: originalListing.width_inches,
      yards_available: originalListing.yards_available || 1,
      condition: originalListing.condition || "like_new", // Relisted items are at least "like new"
      brand: originalListing.brand,
      weight: originalListing.weight,
      stretch: originalListing.stretch,
      transparency: originalListing.transparency,
      care_instructions: originalListing.care_instructions,
      tags: originalListing.tags,
      
      // Shipping fields
      weight_oz: originalListing.weight_oz,
      handling_days_min: originalListing.handling_days_min,
      handling_days_max: originalListing.handling_days_max,
      length_in: originalListing.length_in,
      width_in: originalListing.width_in,
      height_in: originalListing.height_in,
      
      // Copy images (watermark will be applied in frontend)
      image_url_1: originalListing.image_url_1,
      image_url_2: originalListing.image_url_2,
      image_url_3: originalListing.image_url_3,
      image_url_4: originalListing.image_url_4,
      
      // Relist tracking
      relisted_from_listing_id: listing_id,
      relisted_from_seller_id: originalSellerId,
      relisted_from_name: relistFromText,  // Store the display name for watermark
      
      // Set as DRAFT so user can review/edit
      status: "DRAFT",
    };

    const { data: newListing, error: insertErr } = await supabase
      .from("listings")
      .insert(newListingData)
      .select()
      .single();

    if (insertErr) {
      console.error("[relist] Insert error:", insertErr);
      return res.status(500).json({ error: "Failed to create relisted listing" });
    }

    // 6. Create notification for the new seller (buyer who is relisting)
    await supabase.from("notifications").insert({
      user_id: user.id,
      type: "listing",
      kind: "listing",
      title: "Relist created! 📦",
      body: `Your relist of "${newListing.title}" has been created as a draft. Review and publish when ready.`,
      href: `/sell.html?edit=${newListing.id}`,
    });

    return res.status(200).json({
      success: true,
      listing: newListing,
      relisted_from_name: relistFromText,
      message: "Relist created as draft. Images will display 'Relisted from " + relistFromText + "' watermark."
    });

  } catch (err) {
    console.error("[relist] Handler error:", err);
    return res.status(500).json({ error: "Server error creating relist" });
  }
}
