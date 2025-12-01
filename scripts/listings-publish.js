// scripts/listings-publish.js
// Hemline Market — Draft + Publish flow for listings

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.warn(
      "[Listings Publish] Supabase client not found on window.HM.supabase; listing form disabled."
    );
    return;
  }

  // ---------- DOM ELEMENTS ----------
  const form = document.getElementById("listingForm");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  const publishNowBtn = document.getElementById("publishNowBtn");

  if (!form) {
    console.warn("[Listings Publish] No form with id='listingForm' found.");
    return;
  }

  // Basic toast helper (you can restyle this or hook into your existing toast)
  function showToast(message, type = "info") {
    // type: "info" | "success" | "error"
    alert(message); // Replace with your fancy toast UI later
  }

  // Disable / enable buttons during async work
  function setSubmitting(isSubmitting) {
    if (saveDraftBtn) {
      saveDraftBtn.disabled = isSubmitting;
    }
    if (publishNowBtn) {
      publishNowBtn.disabled = isSubmitting;
    }
  }

  // Read current user session (so we can attach user_id)
  async function getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("[Listings Publish] Error getting user:", error);
      return null;
    }
    return data.user || null;
  }

  // Gather form data into a payload for the listings table
  async function buildListingPayload(isPublished) {
    const user = await getCurrentUser();
    if (!user) {
      throw new Error("You must be signed in to create a listing.");
    }

    // Adjust these IDs if your actual form is different
    const titleEl = document.getElementById("listing_title");
    const descEl = document.getElementById("listing_description");
    const priceEl = document.getElementById("listing_price");
    const categoryEl = document.getElementById("listing_category");
    const conditionEl = document.getElementById("listing_condition");
    const mediaUrlEl = document.getElementById("listing_media_url");

    const title = titleEl ? titleEl.value.trim() : "";
    const description = descEl ? descEl.value.trim() : "";
    const priceInput = priceEl ? priceEl.value.trim() : "";
    const category = categoryEl ? categoryEl.value.trim() : "";
    const condition = conditionEl ? conditionEl.value.trim() : "";
    const media_url = mediaUrlEl ? mediaUrlEl.value.trim() : null;

    if (!title) {
      throw new Error("Please add a title for your listing.");
    }

    if (!priceInput) {
      throw new Error("Please add a price.");
    }

    // Very simple parsing: assume user enters dollars
    const priceNumber = Number(priceInput.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      throw new Error("Please enter a valid price greater than zero.");
    }

    const price_cents = Math.round(priceNumber * 100);

    const now = new Date().toISOString();

    const payload = {
      user_id: user.id,
      title,
      description,
      price_cents,
      category: category || null,
      condition: condition || null,
      media_url,
      is_published: isPublished,
      // Only set published_at if we're publishing now
      published_at: isPublished ? now : null,
    };

    return payload;
  }

  // Insert a new listing (either draft or live)
  async function createListing(isPublished) {
    setSubmitting(true);

    try {
      const payload = await buildListingPayload(isPublished);

      const { data, error } = await supabase
        .from("listings")
        .insert(payload)
        .select()
        .single();

      if (error) {
        console.error("[Listings Publish] Insert error:", error);
        throw new Error(error.message || "Unable to save your listing.");
      }

      // Success
      if (isPublished) {
        showToast("Your listing is now live!", "success");
      } else {
        showToast("Draft saved — you can publish it later from your account.", "success");
      }

      // Optionally reset form after any successful create
      form.reset();

      // Optionally redirect to account/store page
      // window.location.href = "/account.html"; // uncomment if you want this

      return data;
    } catch (err) {
      console.error("[Listings Publish] Error:", err);
      showToast(err.message || "Something went wrong while saving your listing.", "error");
      return null;
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- EVENT HANDLERS ----------

  // Prevent the form's default submit behavior
  form.addEventListener("submit", function (evt) {
    evt.preventDefault();
  });

  if (saveDraftBtn) {
    saveDraftBtn.addEventListener("click", function (evt) {
      evt.preventDefault();
      createListing(false); // Draft
    });
  }

  if (publishNowBtn) {
    publishNowBtn.addEventListener("click", function (evt) {
      evt.preventDefault();
      createListing(true); // Live immediately
    });
  }

  console.log("[Listings Publish] Draft/Publish handlers attached.");
})();
