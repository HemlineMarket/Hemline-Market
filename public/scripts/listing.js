// public/scripts/listing.js
// Shows a single listing by id, including SOLD listings (read-only).

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.error("[listing] Supabase client missing on window.HM.supabase");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const listingId = params.get("id");

  if (!listingId) {
    console.error("[listing] Missing ?id= in URL");
    return;
  }

  // --- DOM refs (all optional so we don't explode if an element is missing) ---
  const titleEl = document.getElementById("listingTitle");
  const priceEl = document.getElementById("listingPrice");
  const detailEl = document.getElementById("listingDetails");
  const statusEl = document.getElementById("listingStatus");
  const imageEl = document.getElementById("listingImage");
  const buyButton = document.getElementById("purchaseButton") ||
                    document.getElementById("purchaseThisFabricButton");

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function markSoldUI(listing) {
    // Show status badge / text
    if (statusEl) {
      statusEl.textContent = "Sold";
      statusEl.classList.add("sold");
    }

    // Disable purchase button so you can’t buy again
    if (buyButton) {
      buyButton.disabled = true;
      buyButton.textContent = "Sold";
      buyButton.classList.add("btn-disabled");
    }

    // Optional extra detail
    if (detailEl) {
      const note = document.createElement("div");
      note.style.marginTop = "6px";
      note.style.fontSize = "13px";
      note.style.color = "#6b7280";
      note.textContent = "This listing has been sold. You’re viewing it from your Purchases.";
      detailEl.appendChild(note);
    }
  }

  async function loadListing() {
    try {
      // IMPORTANT: do NOT filter by status = ACTIVE
      const { data, error } = await supabase
        .from("listings")
        .select("*")
        .eq("id", listingId)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        console.error("[listing] load error:", error);
      }

      if (!data) {
        setText(titleEl, "Listing not found");
        if (detailEl) {
          setText(detailEl, "This listing is no longer available.");
        }
        if (buyButton) {
          buyButton.disabled = true;
          buyButton.textContent = "Unavailable";
        }
        return;
      }

      const listing = data;

      // Basic content
      setText(titleEl, listing.title || listing.name || "Fabric listing");

      if (priceEl) {
        const cents = Number(listing.price_cents || 0);
        const price = (cents / 100).toLocaleString(undefined, {
          style: "currency",
          currency: listing.currency || "USD",
        });
        priceEl.textContent = price;
      }

      if (detailEl && !detailEl.hasChildNodes()) {
        const pieces = [];

        if (listing.yardage) pieces.push(`${listing.yardage} yards`);
        if (listing.width) pieces.push(`${listing.width}" wide`);
        if (listing.fiber_content) pieces.push(listing.fiber_content);

        if (pieces.length) {
          detailEl.textContent = pieces.join(" • ");
        }
      }

      if (imageEl && listing.cover_image_url) {
        imageEl.src = listing.cover_image_url;
        imageEl.alt = listing.title || "Fabric listing";
      }

      // Handle SOLD vs ACTIVE
      const status = String(listing.status || "").toUpperCase();

      if (status === "SOLD") {
        markSoldUI(listing);
      } else {
        // Active listing: keep purchase button enabled
        if (statusEl) statusEl.textContent = "Available";
      }
    } catch (err) {
      console.error("[listing] unexpected error:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", loadListing);
})();
