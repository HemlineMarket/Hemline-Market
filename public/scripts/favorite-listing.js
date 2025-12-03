// File: public/scripts/favorite-listing.js
// Creates a notification when someone favorites a listing.
// Requires your favorite button to have:
//   data-listing-id="..." 
//   data-seller-id="..."

// Example button:
// <button class="fav-btn" data-listing-id="abc" data-seller-id="xyz">❤️</button>

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;
  if (!supabase) return;

  async function ensureUser(maxMs = 3000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const { data } = await supabase.auth.getSession();
      if (data?.session?.user) return data.session.user;
      await new Promise(r => setTimeout(r, 120));
    }
    return null;
  }

  function attachFavoriteHandlers() {
    const buttons = document.querySelectorAll(".fav-btn");
    if (!buttons.length) return;

    buttons.forEach(btn => {
      btn.addEventListener("click", () => handleFavorite(btn));
    });
  }

  async function handleFavorite(btn) {
    const listingId = btn.dataset.listingId;
    const sellerId  = btn.dataset.sellerId;
    if (!listingId || !sellerId) return;

    const user = await ensureUser();
    if (!user) return;

    // Cannot notify yourself
    if (user.id === sellerId) return;

    // Insert notification
    try {
      await supabase.from("notifications").insert({
        user_id: sellerId,
        actor_id: user.id,
        type: "favorite",
        kind: "favorite",
        title: "Your listing was favorited",
        body: "Someone favorited your listing.",
        href: `listing.html?id=${listingId}`,
        link: `listing.html?id=${listingId}`,
        listing_id: listingId,
        metadata: { listing_id: listingId }
      });
    } catch (err) {
      console.warn("[favorite-listing] Notification insert failed:", err);
    }
  }

  document.addEventListener("DOMContentLoaded", attachFavoriteHandlers);
})();
