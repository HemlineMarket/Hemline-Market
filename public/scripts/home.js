/**
 * HEMLINE MARKET - Homepage JavaScript
 * public/scripts/home.js
 * 
 * Handles homepage listings, search form, and share button.
 * Requires: hm-shell.js to be loaded first
 * UPDATED: Move content badge to yards line
 */

(function() {
  'use strict';

  /* ===== HELPER FUNCTIONS ===== */
  function moneyFromCents(c) {
    if (c == null) return "";
    const v = Number(c) / 100;
    return v.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function thumbUrl(url, width = 400) {
    if (!url) return "";
    return url;
  }

  function computeYards(row) {
    const y1 = row.yards_available;
    const y2 = row.yardage;
    const raw = (y1 != null ? Number(y1) : (y2 != null ? Number(y2) : null));
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  }

  /**
   * Format content string for display on listing cards
   * Shortens "Spandex / Elastane" to "Elastane" to save space
   */
  function formatContentForDisplay(content) {
    if (!content) return "";
    return content
      .split(",")
      .map(s => s.trim())
      .map(s => s === "Spandex / Elastane" ? "Elastane" : s)
      .join(", ");
  }

  /**
   * Get the best label to display on listing cards
   * Cascade: content → fabric_type → feels_like
   * Skip "Not sure" and "Other" as they're not useful labels
   */
  function getListingBadgeLabel(listing) {
    // Try content first (skip "Not sure" and "Other")
    if (listing.content && listing.content !== "Not sure" && listing.content !== "Other") {
      return formatContentForDisplay(listing.content);
    }
    // Fall back to fabric type
    if (listing.fabric_type) {
      return listing.fabric_type;
    }
    // Fall back to feels like
    if (listing.feels_like) {
      // Capitalize first letter for display
      const feels = listing.feels_like.split(",")[0].trim();
      return feels.charAt(0).toUpperCase() + feels.slice(1);
    }
    return "";
  }

  /* ===== PROFILE FETCHING ===== */
  async function fetchProfilesForListings(listings, supabaseClient) {
    const map = {};
    const ids = Array.from(new Set(
      (listings || [])
        .map(l => l.seller_id)
        .filter(Boolean)
    ));
    if (!ids.length) return map;

    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, display_name, store_name, first_name, last_name")
        .in("id", ids);

      if (error) {
        console.error("Profile fetch error", error);
        return map;
      }
      (data || []).forEach(p => {
        map[p.id] = p;
      });
    } catch (e) {
      console.error("Profile fetch exception", e);
    }
    return map;
  }

  /* ===== CART HOLDS ===== */
  async function fetchCartHolds(listingIds) {
    const map = {};
    if (!listingIds || !listingIds.length) return map;

    try {
      const res = await fetch(`/api/cart/hold?listings=${listingIds.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        return data.holds || {};
      }
    } catch (e) {
      console.error("Cart holds fetch error", e);
    }
    return map;
  }

  /* ===== LOAD HOME LISTINGS ===== */
  async function loadHomeListings() {
    const grid = document.getElementById("homeListingsGrid");
    const empty = document.getElementById("homeListingsEmpty");
    const count = document.getElementById("homeListingsCount");
    const skeleton = document.getElementById("homeListingsSkeleton");

    if (grid) grid.innerHTML = "";
    if (empty) empty.style.display = "none";
    if (skeleton) skeleton.style.display = "grid";
    if (count) count.textContent = "";

    const HM = window.HM || {};
    const supabaseClient = HM.supabase;

    if (!supabaseClient) {
      console.warn("[Home] Supabase client not found on window.HM.supabase; listings disabled for now.");
      if (count) count.textContent = "Listings coming soon";
      if (skeleton) skeleton.style.display = "none";
      return;
    }

    let listings = [];
    try {
      const { data, error } = await supabaseClient
        .from("listings")
        .select("*")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(50);

      if (error) {
        console.error("Home listings error", error);
        if (skeleton) skeleton.style.display = "none";
        if (empty) {
          const titleEl = empty.querySelector('.empty-title');
          const textEl = empty.querySelector('.empty-text');
          if (titleEl) titleEl.textContent = 'Unable to load listings';
          if (textEl) textEl.textContent = 'Please check your connection and refresh the page.';
          empty.style.display = "flex";
        }
        if (count) count.textContent = "";
        return;
      }

      const now = new Date();
      listings = (data || []).filter(l => {
        if (l.is_published !== true) return false;
        const status = (l.status || "active").toLowerCase();
        if (status === "sold") return false;
        if (status !== "active") return false;
        if (l.yards_available != null && l.yards_available <= 0) return false;
        // 8pm release time filter
        if (l.published_at && new Date(l.published_at) > now) return false;
        return true;
      }).slice(0, 6);

    } catch (e) {
      console.error("Home listings exception", e);
      if (skeleton) skeleton.style.display = "none";
      if (empty) {
        const titleEl = empty.querySelector('.empty-title');
        const textEl = empty.querySelector('.empty-text');
        if (titleEl) titleEl.textContent = 'Something went wrong';
        if (textEl) textEl.textContent = 'Please refresh the page to try again.';
        empty.style.display = "flex";
      }
      if (count) count.textContent = "";
      return;
    }

    const total = listings.length;

    if (skeleton) skeleton.style.display = "none";

    if (count) {
      count.textContent = total === 1 ? "1 listing" : total + " listings";
    }

    if (!total) {
      if (empty) empty.style.display = "flex";
      return;
    }

    const profileMap = await fetchProfilesForListings(listings, supabaseClient);
    const holdMap = await fetchCartHolds(listings.map(l => l.id));

    const myCart = JSON.parse(localStorage.getItem('hm_cart') || '[]');
    const myCartIds = new Set(myCart.map(it => it.id || it.listing_id));

    listings.forEach(item => {
      const yards = computeYards(item);
      const priceCents = item.price_cents != null ? Number(item.price_cents) : null;
      const origPriceCents = item.orig_price_cents != null ? Number(item.orig_price_cents) : null;

      const perYdMoney = priceCents != null ? moneyFromCents(priceCents) : "";
      const origPerMoney = origPriceCents != null ? moneyFromCents(origPriceCents) : "";

      const totalCents = (priceCents != null && yards != null) ? priceCents * yards : null;
      const totalMoney = totalCents != null ? moneyFromCents(totalCents) : "";

      const status = (item.status || "active").toLowerCase();
      const isSold = status === "sold" || (yards != null && yards <= 0) || item.yards_available === 0;
      const canBuy = !isSold && priceCents != null && yards != null && yards > 0;

      const hold = holdMap[item.id];
      const inMyCart = myCartIds.has(item.id);
      const inSomeoneElsesCart = hold?.held && !inMyCart;

      let cartBadgeHtml = '';
      if (inMyCart) {
        cartBadgeHtml = '<span class="cart-badge yours">✓ In your cart</span>';
      } else if (inSomeoneElsesCart) {
        cartBadgeHtml = '<span class="cart-badge others">🔥 In someone\'s cart</span>';
      }

      const card = document.createElement("article");
      card.className = "listing-card";

      const href = "listing.html?id=" + encodeURIComponent(item.id);
      const safeTitle = item.title || "Untitled listing";
      const safeAlt = safeTitle.replace(/"/g, "&quot;");

      const prof = profileMap[item.seller_id] || {};
      const displayName = (prof.first_name && prof.last_name)
        ? (prof.first_name + " " + prof.last_name)
        : (prof.display_name || "");
      const storeName = prof.storeName || prof.store_name || displayName || "Hemline Market seller";

      const badgeLabel = getListingBadgeLabel(item);

      // UPDATED: Move badge to yards line instead of title row
      card.innerHTML = `
        <a class="listing-thumb-link" href="${href}">
          <div class="listing-thumb" aria-hidden="true">
            ${item.image_url_1 ? `<img src="${thumbUrl(item.image_url_1, 400)}" alt="${safeAlt}" loading="lazy">` : ""}
            ${cartBadgeHtml}
          </div>
        </a>
        <div class="listing-body">
          <div class="listing-title-row">
            <a class="listing-title" href="${href}">${safeTitle}</a>
          </div>
          ${yards != null ? `<div class="listing-yards">${yards} yards${badgeLabel ? ` <span class="listing-dept">${badgeLabel}</span>` : ""}</div>` : ""}
          <div class="listing-cta-row">
            <button
              type="button"
              class="listing-add-btn add-to-cart"
              data-add-to-cart="1"
              data-listing-id="${String(item.id)}"
              data-name="${String(safeTitle).replace(/"/g, '&quot;')}"
              data-photo="${String(item.image_url_1 || "")}"
              data-yards="${yards != null ? String(yards) : "0"}"
              data-price="${priceCents != null ? (priceCents / 100).toFixed(2) : "0"}"
              data-amount="${priceCents != null ? String(priceCents) : "0"}"
              data-seller-id="${String(item.seller_id || "")}"
              data-seller-name="${String(storeName).replace(/"/g, '&quot;')}"
            >
              ${
                canBuy && totalMoney && yards
                  ? `Add to Cart — ${totalMoney} for ${yards} yards`
                  : (isSold ? "Sold out" : "Add to Cart")
              }
            </button>
          </div>
          <div class="listing-price-row">
            ${
              perYdMoney
                ? `<span class="listing-price-main">${perYdMoney}/yard</span>`
                : `<span class="listing-price-main">Price coming soon</span>`
            }
            ${
              origPerMoney
                ? `<span class="listing-price-orig">${origPerMoney}/yard</span>`
                : ""
            }
          </div>
          <div class="listing-seller-row">
            <span class="listing-seller-name">${storeName}</span>
          </div>
        </div>
      `;

      const btn = card.querySelector(".listing-add-btn");
      if (btn) {
        if (!canBuy) {
          btn.disabled = true;
          btn.textContent = isSold ? "Sold out" : "Unavailable";
        }
      }

      grid.appendChild(card);
    });

    // Show "See More" button if we have listings
    const seeMoreWrap = document.getElementById('seeMoreWrap');
    if (seeMoreWrap && total > 0) {
      seeMoreWrap.style.display = 'block';
    }
  }

  /* ===== SEARCH FORM ===== */
  function setupSearchForm() {
    const form = document.getElementById("homeSearchForm");
    const input = document.getElementById("homeSearchInput");
    const searchType = document.getElementById("searchType");

    function getPlaceholder(type) {
      const isMobile = window.innerWidth < 500;
      if (type === "sellers") {
        return isMobile ? "Search sellers..." : "Search by store or seller name";
      } else {
        return isMobile ? "Search fabrics..." : "Search by color, type, weight, price, and more";
      }
    }

    if (input) {
      input.placeholder = getPlaceholder(searchType?.value || "fabrics");
    }

    window.addEventListener("resize", () => {
      if (input && searchType) {
        input.placeholder = getPlaceholder(searchType.value);
      }
    });

    if (searchType && input) {
      searchType.addEventListener("change", () => {
        input.placeholder = getPlaceholder(searchType.value);
      });
    }

    if (form && input) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = input.value.trim();
        const type = searchType?.value || "fabrics";

        const params = new URLSearchParams();
        if (q) params.set("q", q);

        if (type === "sellers") {
          params.set("mode", "ateliers");
        }

        const qs = params.toString();
        const url = "browse.html" + (qs ? "?" + qs : "");
        window.location.href = url;
      });
    }
  }

  /* ===== SHARE BUTTON ===== */
  function setupShareButton() {
    const shareFab = document.getElementById('shareFab');
    if (!shareFab) return;

    shareFab.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText('https://hemlinemarket.com');

        const originalHTML = shareFab.innerHTML;
        shareFab.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        shareFab.style.background = '#16a34a';

        setTimeout(() => {
          shareFab.innerHTML = originalHTML;
          shareFab.style.background = '';
        }, 1500);
      } catch (err) {
        console.log('Copy failed:', err);
      }
    });
  }

  /* ===== HIDE CREATE ACCOUNT IF LOGGED IN ===== */
  async function hideCreateAccountIfLoggedIn() {
    try {
      const supabase = window.HM?.supabase;
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        if (data?.session?.user) {
          // Hide About card button (hero button is now handled by invite script in index.html)
          const btn = document.getElementById('createAccountBtn');
          if (btn) btn.style.display = 'none';
        }
      }
    } catch (_) {}
  }

  /* ===== INITIALIZATION ===== */
  function init() {
    setupSearchForm();
    setupShareButton();
    hideCreateAccountIfLoggedIn();
    loadHomeListings();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for external use
  window.HMHome = {
    loadHomeListings,
    setupSearchForm,
    setupShareButton
  };

})();
