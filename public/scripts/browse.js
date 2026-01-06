/**
 * HEMLINE MARKET - Browse Page JavaScript
 * public/scripts/browse.js
 * 
 * Handles browse page listings, filters, ateliers search.
 * Requires: hm-shell.js, browse-enhancements.js
 */

(function() {
  'use strict';

  /* ===== SUPABASE CLIENT ===== */
  const supabaseClient = window.supabase.createClient(
    "https://clkizksbvxjkoatdajgd.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI"
  );

  // "listings" (default) vs "ateliers"
  let currentMode = "listings";

  /* ===== FILTER CONSTANTS ===== */
  const CONTENTS = [
    "Acetate", "Acrylic", "Alpaca", "Bamboo", "Camel", "Cashmere", "Cotton",
    "Cupro", "Hemp", "Jute", "Leather", "Linen", "Lurex", "Lyocell", "Merino",
    "Modal", "Mohair", "Nylon", "Polyester", "Ramie", "Rayon", "Silk",
    "Spandex / Elastane", "Tencel", "Triacetate", "Viscose", "Wool", "Yak", "Other"
  ];

  const COLORS = [
    "Black", "Grey", "White", "Cream", "Brown",
    "Pink", "Red", "Orange", "Yellow", "Green",
    "Blue", "Purple", "Gold", "Silver"
  ];

  const FABRIC_TYPES = [
    "Brocade", "Canvas", "Charmeuse", "Chiffon", "Corduroy", "Crepe",
    "Denim", "Double Knit", "Faux Fur", "Faux Leather", "Flannel", "Fleece",
    "Gabardine", "Jersey", "Knit", "Lace", "Lining", "Mesh", "Metallic / Lame",
    "Minky", "Organza", "Ponte", "Satin", "Scuba", "Shirting", "Spandex / Lycra",
    "Suiting", "Tulle", "Tweed", "Twill", "Velvet", "Vinyl", "Voile", "Woven"
  ];

  // Cosplay-friendly fabric definitions
  const COSPLAY_FABRIC_TYPES = [
    "Brocade", "Charmeuse", "Chiffon", "Faux Fur", "Faux Leather",
    "Fleece", "Jersey", "Lace", "Mesh", "Metallic / Lame", "Minky",
    "Organza", "Ponte", "Satin", "Scuba", "Spandex / Lycra", "Tulle",
    "Velvet", "Vinyl"
  ];

  const COSPLAY_FEELS_LIKE = [
    "brocade", "charmeuse", "chiffon", "faux fur", "faux leather",
    "fleece", "jersey knit", "lace", "mesh", "metallic / lame", "minky",
    "organza", "ponte", "satin", "scuba", "spandex / lycra", "tulle",
    "velvet / velour", "vinyl"
  ];

  const COSPLAY_CONTENTS = ["lurex"];

  /* ===== FILTER STATE ===== */
  const selectedContents = new Set();
  const selectedColors = new Set();
  const selectedFabricTypes = new Set();

  // Expose filter Sets globally so filter chips can modify them
  window.selectedContents = selectedContents;
  window.selectedColors = selectedColors;
  window.selectedFabricTypes = selectedFabricTypes;

  /* ===== HELPER FUNCTIONS ===== */
  function moneyFromCents(c) {
    if (c == null) return null;
    const v = c / 100;
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

  function numeric(val) {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }

  /* ===== PROFILE FETCHING ===== */
  async function fetchProfilesForListings(listings) {
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

  /* ===== BUILD FILTERS UI ===== */
  function buildFiltersUI() {
    const contentBox = document.getElementById("contentBox");
    const colorBox = document.getElementById("colorBox");
    const fabricTypeBox = document.getElementById("fabricTypeBox");

    if (contentBox) {
      contentBox.innerHTML = "";
      CONTENTS.forEach(label => {
        const row = document.createElement("div");
        row.className = "row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "content";
        cb.value = label;
        const lb = document.createElement("label");
        lb.textContent = label;
        row.appendChild(cb);
        row.appendChild(lb);
        cb.addEventListener("change", () => {
          if (cb.checked) selectedContents.add(label);
          else selectedContents.delete(label);
          runSearch();
        });
        contentBox.appendChild(row);
      });
    }

    if (fabricTypeBox) {
      fabricTypeBox.innerHTML = "";
      FABRIC_TYPES.forEach(label => {
        const row = document.createElement("div");
        row.className = "row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = "fabricType";
        cb.value = label;
        const lb = document.createElement("label");
        lb.textContent = label;
        row.appendChild(cb);
        row.appendChild(lb);
        cb.addEventListener("change", () => {
          if (cb.checked) selectedFabricTypes.add(label);
          else selectedFabricTypes.delete(label);
          runSearch();
        });
        fabricTypeBox.appendChild(row);
      });
    }

    if (colorBox) {
      colorBox.innerHTML = "";
      COLORS.forEach(name => {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "sw";
        sw.dataset.name = name;
        sw.setAttribute("aria-label", name);
        const tip = document.createElement("span");
        tip.className = "tip";
        tip.textContent = name;
        sw.appendChild(tip);
        if (name !== "Gold" && name !== "Silver") {
          sw.style.backgroundColor = name.toLowerCase();
        }
        sw.addEventListener("click", () => {
          if (selectedColors.has(name)) {
            selectedColors.delete(name);
            sw.dataset.selected = "false";
          } else {
            selectedColors.add(name);
            sw.dataset.selected = "true";
          }
          runSearch();
        });
        colorBox.appendChild(sw);
      });
    }
  }

  /* ===== TOGGLE FILTERS PANEL ===== */
  function setupFilterToggle() {
    const layout = document.getElementById('layout');
    const toggle = document.getElementById('toggleFilters');
    if (!layout || !toggle) return;

    toggle.addEventListener('click', () => {
      const hidden = layout.classList.toggle('filters-hidden');
      toggle.textContent = hidden ? 'Show filters' : 'Hide filters';
      toggle.setAttribute('aria-pressed', hidden ? 'false' : 'true');
    });
  }

  /* ===== ATELIER SEARCH ===== */
  async function runAtelierSearch() {
    const grid = document.getElementById("grid");
    const emptyEl = document.getElementById("empty");
    const countEl = document.getElementById("resultCount");
    const qInput = document.getElementById("q");

    const searchTerm = (qInput?.value || "").trim().toLowerCase();

    // Don't show anything until user searches
    if (!searchTerm) {
      if (grid) grid.innerHTML = "";
      if (emptyEl) {
        emptyEl.textContent = "Search for sellers by name above.";
        emptyEl.style.display = "block";
      }
      if (countEl) countEl.textContent = "";
      return;
    }

    if (grid) {
      if (typeof window.generateSkeletonCards === 'function') {
        grid.innerHTML = window.generateSkeletonCards(6);
      } else {
        grid.innerHTML = '';
      }
    }
    if (emptyEl) emptyEl.style.display = "none";
    if (countEl) countEl.textContent = "";

    let profiles = [];
    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, display_name, store_name, first_name, last_name, bio, avatar_url")
        .order("store_name", { ascending: true });

      if (error) {
        console.error("Atelier fetch error", error);
        if (countEl) countEl.textContent = "Error loading sellers";
        return;
      }
      profiles = data || [];
    } catch (e) {
      console.error("Atelier fetch exception", e);
      if (countEl) countEl.textContent = "Error loading sellers";
      return;
    }

    // Filter by search term
    const filtered = profiles.filter(p => {
      const store = (p.store_name || "").toLowerCase();
      const disp = (p.display_name || "").toLowerCase();
      const full = ((p.first_name || "") + " " + (p.last_name || "")).trim().toLowerCase();
      return store.includes(searchTerm) || disp.includes(searchTerm) || full.includes(searchTerm);
    });

    const total = filtered.length;
    if (countEl) {
      countEl.textContent = total === 1 ? "1 seller" : total + " sellers";
    }

    if (!total) {
      if (emptyEl) {
        emptyEl.textContent = "No sellers match that search.";
        emptyEl.style.display = "block";
      }
      return;
    }

    if (grid) grid.innerHTML = "";

    filtered.forEach(p => {
      const card = document.createElement("article");
      card.className = "listing-card";

      const storeName = p.store_name || p.display_name || "Seller";
      const ownerName = ((p.first_name || "") + " " + (p.last_name || "")).trim();
      const href = "atelier.html?u=" + encodeURIComponent(p.id);
      const avatarUrl = p.avatar_url || "";

      card.innerHTML = `
        <a class="listing-thumb-link" href="${href}">
          <div class="listing-thumb" aria-hidden="true" style="background:#fff;">
            ${avatarUrl 
              ? `<img src="${avatarUrl}" alt="${storeName}" loading="lazy" style="width:100%!important;height:100%!important;object-fit:contain!important;">` 
              : ``
            }
          </div>
        </a>
        <div class="listing-body">
          <div class="listing-title-row">
            <a class="listing-title" href="${href}">${storeName}</a>
          </div>
          ${ownerName ? `<div class="listing-yards">${ownerName}</div>` : ""}
          ${p.bio ? `<div class="listing-price-row"><span class="listing-price-main">${p.bio}</span></div>` : ""}
          <div class="listing-cta-row">
            <a href="${href}" class="listing-add-btn">View atelier</a>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  /* ===== LISTING SEARCH ===== */
  async function runListingSearch() {
    const grid = document.getElementById("grid");
    const emptyEl = document.getElementById("empty");
    const emptyFilteredEl = document.getElementById("emptyFiltered");
    const countEl = document.getElementById("resultCount");
    const qInput = document.getElementById("q");
    const minPriceEl = document.getElementById("minPrice");
    const maxPriceEl = document.getElementById("maxPrice");
    const minYardsEl = document.getElementById("minYards");
    const minWidthEl = document.getElementById("minWidth");
    const maxWidthEl = document.getElementById("maxWidth");
    const minGsmEl = document.getElementById("minGsm");
    const maxGsmEl = document.getElementById("maxGsm");
    const deptEl = document.getElementById("dept");
    const fiberEl = document.getElementById("fiberType");
    const patternEl = document.getElementById("pattern");
    const originEl = document.getElementById("origin");
    const designerEl = document.getElementById("designer");
    const feelsEl = document.getElementById("feelsLike");
    const burnTestEl = document.getElementById("burnTest");

    if (grid) {
      if (typeof window.generateSkeletonCards === 'function') {
        grid.innerHTML = window.generateSkeletonCards(6);
      } else {
        grid.innerHTML = '';
      }
    }
    if (emptyEl) emptyEl.style.display = "none";
    if (emptyFilteredEl) emptyFilteredEl.style.display = "none";
    if (countEl) countEl.textContent = "";

    let listings = [];
    try {
      const { data, error } = await supabaseClient
        .from("listings")
        .select("*")
        .order("published_at", { ascending: false, nullsFirst: false });

      if (error) {
        console.error("Listings fetch error", error);
        if (grid && typeof window.generateErrorState === 'function') {
          grid.innerHTML = window.generateErrorState('Unable to load listings. Please check your connection and try again.');
        }
        if (countEl) countEl.textContent = "";
        return;
      }
      listings = data || [];
    } catch (e) {
      console.error("Listings fetch exception", e);
      if (grid && typeof window.generateErrorState === 'function') {
        grid.innerHTML = window.generateErrorState('Something went wrong. Please try again.');
      }
      if (countEl) countEl.textContent = "";
      return;
    }

    /* Client-side filtering */
    const searchTerm = (qInput?.value || "").trim().toLowerCase();
    const minPrice = numeric(minPriceEl?.value);
    const maxPrice = numeric(maxPriceEl?.value);
    const minYards = numeric(minYardsEl?.value);
    const minWidth = numeric(minWidthEl?.value);
    const maxWidth = numeric(maxWidthEl?.value);
    const minGsm = numeric(minGsmEl?.value);
    const maxGsm = numeric(maxGsmEl?.value);

    const deptVal = (deptEl?.value || "").trim();
    const fiberVal = (fiberEl?.value || "").trim();
    const patternVal = (patternEl?.value || "").trim();
    const originVal = (originEl?.value || "").trim();
    const designerVal = (designerEl?.value || "").trim().toLowerCase();
    const feelsVal = (feelsEl?.value || "").trim().toLowerCase();
    const burnTestVal = (burnTestEl?.value || "").trim().toLowerCase();

    const now = new Date();

    let filtered = listings.filter(l => {
      if (l.is_published !== true) return false;

      const status = (l.status || "active").toLowerCase();
      if (status === "sold") return false;
      if (status !== "active") return false;

      if (l.yards_available != null && Number(l.yards_available) <= 0) return false;
      if (l.published_at && new Date(l.published_at) > now) return false;

      if (searchTerm) {
        const hay = ((l.title || "") + " " + (l.description || "")).toLowerCase();
        if (!hay.includes(searchTerm)) return false;
      }

      if (minPrice != null && l.price_cents != null) {
        if (l.price_cents < Math.round(minPrice * 100)) return false;
      }
      if (maxPrice != null && l.price_cents != null) {
        if (l.price_cents > Math.round(maxPrice * 100)) return false;
      }

      if (minYards != null && l.yards_available != null) {
        if (Number(l.yards_available) < minYards) return false;
      }

      if (minWidth != null && l.width_in != null) {
        if (Number(l.width_in) < minWidth) return false;
      }
      if (maxWidth != null && l.width_in != null) {
        if (Number(l.width_in) > maxWidth) return false;
      }

      if (minGsm != null && l.weight_gsm != null) {
        if (Number(l.weight_gsm) < minGsm) return false;
      }
      if (maxGsm != null && l.weight_gsm != null) {
        if (Number(l.weight_gsm) > maxGsm) return false;
      }

      if (deptVal && l.dept !== deptVal) return false;

      if (selectedFabricTypes.size > 0) {
        const listingFabricTypes = (l.fabric_type || "").split(",").map(s => s.trim().toLowerCase());
        let fabricMatch = false;
        for (const selected of selectedFabricTypes) {
          if (listingFabricTypes.some(ft => ft === selected.toLowerCase())) {
            fabricMatch = true;
            break;
          }
        }
        if (!fabricMatch) return false;
      }

      if (fiberVal && l.fiber_type !== fiberVal) return false;
      if (patternVal && l.pattern !== patternVal) return false;
      if (originVal) {
        const listingOrigin = l.country_of_origin || l.origin;
        if (listingOrigin !== originVal) return false;
      }

      if (designerVal) {
        const dName = (l.designer || "").toLowerCase();
        if (!dName.includes(designerVal)) return false;
      }

      if (selectedContents.size) {
        if (!selectedContents.has("Any")) {
          const lc = (l.content || "").toLowerCase();
          let hit = false;
          for (const v of selectedContents) {
            if (lc.includes(v.toLowerCase())) {
              hit = true;
              break;
            }
          }
          if (!hit) return false;
        }
      }

      if (feelsVal) {
        const src = l.feels_like;
        let arr = [];
        if (Array.isArray(src)) {
          arr = src;
        } else if (typeof src === "string" && src.trim().length) {
          arr = src.split(",").map(s => s.trim());
        }
        const lowerSet = new Set(arr.map(v => v.toLowerCase()));
        if (!lowerSet.has(feelsVal)) return false;
      }

      if (burnTestVal) {
        const bt = (l.burn_test || "").toLowerCase();
        if (bt !== burnTestVal) return false;
      }

      if (selectedColors.size > 0) {
        if (!l.color_family || !selectedColors.has(l.color_family)) return false;
      }

      const cosplayFilterEl = document.getElementById("cosplayFilter");
      const isCosplayFilterOn = cosplayFilterEl?.checked;

      if (isCosplayFilterOn) {
        const fabricTypeSrc = l.fabric_type || "";
        const content = (l.content || "").toLowerCase();

        let fabricTypeArr = [];
        if (typeof fabricTypeSrc === "string" && fabricTypeSrc.trim()) {
          fabricTypeArr = fabricTypeSrc.split(",").map(s => s.trim().toLowerCase());
        }
        const matchesFabricType = fabricTypeArr.some(ft =>
          COSPLAY_FABRIC_TYPES.some(t => ft === t.toLowerCase())
        );

        const feelsLikeSrc = l.feels_like;
        let feelsLikeArr = [];
        if (Array.isArray(feelsLikeSrc)) {
          feelsLikeArr = feelsLikeSrc.map(s => s.toLowerCase());
        } else if (typeof feelsLikeSrc === "string" && feelsLikeSrc.trim()) {
          feelsLikeArr = feelsLikeSrc.split(",").map(s => s.trim().toLowerCase());
        }
        const matchesFeelsLike = feelsLikeArr.some(f =>
          COSPLAY_FEELS_LIKE.includes(f)
        );

        const matchesContent = COSPLAY_CONTENTS.some(c =>
          content.includes(c)
        );

        if (!matchesFabricType && !matchesFeelsLike && !matchesContent) {
          return false;
        }
      }

      return true;
    });

    const total = filtered.length;

    const isCosplayOn = document.getElementById("cosplayFilter")?.checked;
    const hasFilters = searchTerm || minPrice || maxPrice || minYards || minWidth || maxWidth || minGsm || maxGsm || deptVal || fiberVal || patternVal || originVal || designerVal || feelsVal || burnTestVal || selectedColors.size > 0 || selectedContents.size > 0 || selectedFabricTypes.size > 0 || isCosplayOn;

    if (!total) {
      if (grid) grid.innerHTML = "";
      if (hasFilters) {
        if (emptyEl) emptyEl.style.display = "none";
        if (emptyFilteredEl) emptyFilteredEl.style.display = "flex";
      } else {
        if (emptyEl) emptyEl.style.display = "flex";
        if (emptyFilteredEl) emptyFilteredEl.style.display = "none";
      }
      return;
    } else {
      if (emptyEl) emptyEl.style.display = "none";
      if (emptyFilteredEl) emptyFilteredEl.style.display = "none";
    }

    // Sort results
    const sortBy = document.getElementById("sortBy")?.value || "newest";
    filtered.sort((a, b) => {
      switch (sortBy) {
        case "price-low":
          return (a.price_cents || 0) - (b.price_cents || 0);
        case "price-high":
          return (b.price_cents || 0) - (a.price_cents || 0);
        case "yards-high":
          return (b.yards_available || 0) - (a.yards_available || 0);
        case "newest":
        default:
          return new Date(b.published_at || 0) - new Date(a.published_at || 0);
      }
    });

    const profileMap = await fetchProfilesForListings(filtered);
    const holdMap = await fetchCartHolds(filtered.map(l => l.id));

    const myCart = JSON.parse(localStorage.getItem('hm_cart') || '[]');
    const myCartIds = new Set(myCart.map(it => it.id || it.listing_id));

    if (grid) grid.innerHTML = "";

    if (grid) {
      filtered.forEach(l => {
        const yardsAvail = l.yards_available != null ? Number(l.yards_available) : null;
        const priceCents = l.price_cents != null ? Number(l.price_cents) : null;
        const origPriceCents = l.orig_price_cents != null ? Number(l.orig_price_cents) : null;

        const status = (l.status || "active").toLowerCase();
        const isSold = status === "sold" || (yardsAvail != null && yardsAvail <= 0) || l.yards_available === 0;
        const canBuy = !isSold && priceCents != null && yardsAvail != null && yardsAvail > 0;

        const hold = holdMap[l.id];
        const inMyCart = myCartIds.has(l.id);
        const inSomeoneElsesCart = hold?.held && !inMyCart;

        let cartBadgeHtml = '';
        if (inMyCart) {
          cartBadgeHtml = '<span class="cart-badge yours">✓ In your cart</span>';
        } else if (inSomeoneElsesCart) {
          cartBadgeHtml = '<span class="cart-badge others">🔥 In someone\'s cart</span>';
        }

        let totalCents = null;
        if (priceCents != null && yardsAvail != null) {
          totalCents = Math.round(priceCents * yardsAvail);
        }

        const prof = profileMap[l.seller_id] || {};
        const displayName = (prof.first_name && prof.last_name)
          ? (prof.first_name + " " + prof.last_name)
          : (prof.display_name || "");
        const storeName = prof.store_name || displayName || "Hemline Market seller";

        const href = "listing.html?id=" + encodeURIComponent(l.id);
        const safeTitle = l.title || "Untitled listing";
        const safeAlt = safeTitle.replace(/"/g, "&quot;");

        const card = document.createElement("article");
        card.className = "listing-card";

        card.innerHTML = `
          <a class="listing-thumb-link" href="${href}">
            <div class="listing-thumb" aria-hidden="true">
              ${l.image_url_1 ? `<img src="${thumbUrl(l.image_url_1, 400)}" alt="${safeAlt}" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML+='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:12px;\\'>Image unavailable</div>';">` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font-size:12px;">No image</div>'}
              ${cartBadgeHtml}
            </div>
          </a>
          <div class="listing-body">
            <div class="listing-title-row">
              <a class="listing-title" href="${href}">${safeTitle}</a>
              ${l.content ? `<span class="listing-dept">${l.content}</span>` : ""}
            </div>
            ${yardsAvail != null ? `<div class="listing-yards">${yardsAvail} yards</div>` : ""}
            <div class="listing-cta-row">
              <button type="button" class="listing-add-btn add-to-cart">
                ${
                  canBuy && totalCents != null && yardsAvail != null
                    ? `Add to Cart — ${moneyFromCents(totalCents)} for ${yardsAvail} yards`
                    : (isSold ? "Sold out" : "Add to Cart")
                }
              </button>
            </div>
            <div class="listing-price-row">
              ${
                priceCents != null
                  ? `<span class="listing-price-main">${moneyFromCents(priceCents)}/yard</span>`
                  : `<span class="listing-price-main">Price coming soon</span>`
              }
              ${
                origPriceCents != null
                  ? `<span class="listing-price-orig">${moneyFromCents(origPriceCents)}/yard</span>`
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
          const perYdDollars = priceCents != null ? (priceCents / 100) : 0;
          const firstImg = l.image_url_1 || "";

          btn.dataset.id = l.id;
          btn.dataset.name = safeTitle;
          btn.dataset.amount = totalCents != null ? String(totalCents) : "0";
          btn.dataset.price = perYdDollars ? perYdDollars.toFixed(2) : "0";
          btn.dataset.yards = yardsAvail != null ? String(yardsAvail) : "0";
          btn.dataset.sellerId = l.seller_id || "";
          btn.dataset.sellerName = storeName || "";
          btn.dataset.photo = firstImg;

          if (!canBuy) {
            btn.disabled = true;
            btn.textContent = isSold ? "Sold out" : "Unavailable";
          }
        }

        grid.appendChild(card);
      });
    }
  }

  /* ===== MAIN SEARCH FUNCTION ===== */
  async function runSearch() {
    if (currentMode === "ateliers") {
      await runAtelierSearch();
    } else {
      await runListingSearch();
    }
    // Update applied filters chip bar
    if (typeof window.renderAppliedFilters === 'function') {
      window.renderAppliedFilters(runSearch);
    }
  }

  // Expose runSearch globally so filter chips can trigger it
  window.runSearch = runSearch;

  /* ===== CLEAR ALL FILTERS ===== */
  function clearAllFilters() {
    const fields = ["q", "minPrice", "maxPrice", "minYards", "minWidth", "maxWidth", "minGsm", "maxGsm", "dept", "fiberType", "pattern", "origin", "designer", "feelsLike", "burnTest"];
    fields.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    document.querySelectorAll("#colorBox .sw").forEach(sw => sw.dataset.selected = "false");
    selectedColors.clear();

    document.querySelectorAll("input[name='content']").forEach(cb => cb.checked = false);
    selectedContents.clear();

    document.querySelectorAll("input[name='fabricType']").forEach(cb => cb.checked = false);
    selectedFabricTypes.clear();

    const cosplayEl = document.getElementById("cosplayFilter");
    if (cosplayEl) cosplayEl.checked = false;
    const cosplayHint = document.getElementById("cosplayHint");
    if (cosplayHint) cosplayHint.style.display = "none";
    const cosplayLabel = document.getElementById("cosplayLabel");
    if (cosplayLabel) {
      cosplayLabel.style.borderColor = "var(--border)";
      cosplayLabel.style.background = "#fff";
    }

    window.history.replaceState({}, "", window.location.pathname);

    if (typeof runSearch === "function") runSearch();
  }

  // Expose clearAllFilters globally
  window.clearAllFilters = clearAllFilters;

  /* ===== INITIALIZATION ===== */
  function init() {
    setupFilterToggle();
    buildFiltersUI();

    const searchBtn = document.getElementById("doSearch");
    const qInput = document.getElementById("q");
    const layout = document.getElementById("layout");
    const toggle = document.getElementById("toggleFilters");
    const heading = document.getElementById("resultsHeading");
    const searchModeSelect = document.getElementById("searchMode");

    // Read URL params from homepage search
    const params = new URLSearchParams(window.location.search);
    const initialQ = params.get("q") || "";
    const urlMode = params.get("mode") === "ateliers" ? "ateliers" : "listings";
    currentMode = urlMode;

    if (qInput) qInput.value = initialQ;
    if (searchModeSelect) searchModeSelect.value = currentMode === "ateliers" ? "sellers" : "fabrics";

    function updateModeUI() {
      const sortByContainer = document.getElementById("sortBy")?.parentElement;
      if (currentMode === "ateliers") {
        if (heading) heading.textContent = "Sellers";
        if (qInput) qInput.placeholder = "Search sellers…";
        if (layout) layout.classList.add("filters-hidden");
        if (toggle) {
          toggle.textContent = "Show filters";
          toggle.setAttribute("aria-pressed", "false");
          toggle.style.display = "none";
        }
        if (sortByContainer) sortByContainer.style.display = "none";
      } else {
        if (heading) heading.textContent = "Browse";
        if (qInput) qInput.placeholder = "Search fabrics…";
        if (toggle) toggle.style.display = "";
        if (sortByContainer) sortByContainer.style.display = "";
      }
    }
    updateModeUI();

    if (searchModeSelect) {
      searchModeSelect.addEventListener("change", () => {
        currentMode = searchModeSelect.value === "sellers" ? "ateliers" : "listings";
        updateModeUI();
        runSearch();
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        if (window.innerWidth < 900 && layout && !layout.classList.contains("filters-hidden")) {
          layout.classList.add("filters-hidden");
          if (toggle) {
            toggle.textContent = "Show filters";
            toggle.setAttribute("aria-pressed", "false");
          }
        }
        runSearch();
      });
    }

    if (qInput) {
      qInput.addEventListener("keydown", e => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (window.innerWidth < 900 && layout && !layout.classList.contains("filters-hidden")) {
            layout.classList.add("filters-hidden");
            if (toggle) {
              toggle.textContent = "Show filters";
              toggle.setAttribute("aria-pressed", "false");
            }
          }
          runSearch();
        }
      });
    }

    runSearch();

    // Sort dropdown
    document.getElementById("sortBy")?.addEventListener("change", runSearch);

    // Filter dropdowns
    ["dept", "fiberType", "pattern", "origin", "feelsLike", "burnTest"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", runSearch);
    });

    // Numeric inputs with debounce
    let debounceTimer;
    const debounceSearch = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runSearch, 400);
    };

    ["minPrice", "maxPrice", "minYards", "minWidth", "maxWidth", "minGsm", "maxGsm", "designer"].forEach(id => {
      document.getElementById(id)?.addEventListener("input", debounceSearch);
    });

    // Cosplay filter
    document.getElementById("cosplayFilter")?.addEventListener("change", (e) => {
      const hint = document.getElementById("cosplayHint");
      const label = document.getElementById("cosplayLabel");
      if (hint) hint.style.display = e.target.checked ? "block" : "none";
      if (label) {
        label.style.borderColor = e.target.checked ? "var(--accent)" : "var(--border)";
        label.style.background = e.target.checked ? "#fef2f2" : "#fff";
      }
      runSearch();
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
