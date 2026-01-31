// File: public/scripts/favorite-listing.js
// Creates a notification when someone favorites a listing.

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

    if (user.id === sellerId) return;

    try {
      await supabase.from("notifications").insert({
        user_id: sellerId,
        actor_id: user.id,
        type: "favorite",
        title: "Your listing was favorited",
        body: "Someone favorited your listing.",
        listing_id: listingId,
        href: `fabric/${listingId}`,
        link: `fabric/${listingId}`,
        is_read: false,
        read_at: null,
        metadata: { listing_id: listingId }
      });
    } catch (err) {}
  }

  document.addEventListener("DOMContentLoaded", attachFavoriteHandlers);
})();
