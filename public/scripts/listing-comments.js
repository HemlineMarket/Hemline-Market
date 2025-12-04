// File: public/scripts/listing-comments.js
// Creates a notification for the seller when someone comments on their listing.

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

  function attachCommentHandler() {
    const form = document.getElementById("listingCommentForm");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSendComment(form);
    });
  }

  async function handleSendComment(form) {
    const textEl = document.getElementById("commentText");
    const btn = document.getElementById("commentSubmitBtn");
    if (!textEl || !btn) return;

    const body = (textEl.value || "").trim();
    if (!body) return;

    const user = await ensureUser();
    if (!user) return;

    const listingId = form.dataset.listingId;
    const sellerId  = form.dataset.sellerId;

    if (!listingId || !sellerId) return;

    btn.disabled = true;

    try {
      await supabase.from("listing_comments").insert({
        listing_id: listingId,
        author_id: user.id,
        body
      });
    } catch (err) {
      btn.disabled = false;
      return;
    }

    if (user.id !== sellerId) {
      try {
        await supabase.from("notifications").insert({
          user_id: sellerId,
          actor_id: user.id,
          type: "listing_comment",
          title: "New comment on your listing",
          body,
          listing_id: listingId,
          href: `listing.html?id=${listingId}`,
          link: `listing.html?id=${listingId}`,
          read_at: null,
          metadata: { listing_id: listingId }
        });
      } catch (err) {}
    }

    textEl.value = "";
    btn.disabled = false;
  }

  document.addEventListener("DOMContentLoaded", attachCommentHandler);
})();
