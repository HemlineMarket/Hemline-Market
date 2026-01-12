/**
 * HEMLINE MARKET - Browse Page JavaScript (OPTIMIZED)
 * public/scripts/browse.js
 * 
 * PERFORMANCE OPTIMIZATIONS:
 * 1. Server-side filtering instead of client-side
 * 2. Only select needed columns
 * 3. Pagination support
 * 4. Profile caching
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

  // Pagination
  const PAGE_SIZE = 30;
  let currentPage = 0;
  let totalCount = 0;

  // Profile cache to avoid repeated lookups
  const profileCache = new Map();

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
    // Optimize Supabase storage images
    if (url.includes('supabase.co/storage')) {
      const separator = url.includes('?') ? '&' : '?';
      return `${url}${separator}width=${width}&quality=75`;
    }
    return url;
  }

  function numeric(val) {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }

  /* ===== PROFILE FETCHING (with cache) ===== */
  async function fetchProfilesForListings(listings) {
    const map = {};
    const ids = Array.from(new Set(
      (listings || [])
        .map(l => l.seller_id)
        .filter(Boolean)
    ));
    if (!ids.length) return map;

    // Check cache first
    const uncachedIds = ids.filter(id => !profileCache.has(id));
    
    // Return cached results for already-fetched profiles
    ids.forEach(id => {
      if (profileCache.has(id)) {
        map[id] = profileCache.get(id);
      }
    });

    if (!uncachedIds.length) return map;

    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, display_name, store_name, first_name, last_name")
        .in("id", uncachedIds);

      if (error) {
        console.error("Profile fetch error", error);
        return map;
      }
      (data || []).forEach(p => {
        map[p.id] = p;
        profileCache.set(p.id, p); // Cache for future use
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
          currentPage = 0; // Reset to first page on filter change
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
          currentPage = 0;
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
          currentPage = 0;
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
      // Server-side search using ilike
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id, display_name, store_name, first_name, last_name, bio, avatar_url")
        .or(`store_name.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`)
        .order("store_name", { ascending: true })
        .limit(50);

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

    const total = profiles.length;
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

    profiles.forEach(p => {
      const card = document.createElement("article");
      card.className = "listing-card seller-card";

      const storeName = p.store_name || p.display_name || "Seller";
      const ownerName = ((p.first_name || "") + " " + (p.last_name || "")).trim();
      const href = "atelier.html?u=" + encodeURIComponent(p.id);
      const avatarUrl = p.avatar_url || "";

      card.innerHTML = `
        ${avatarUrl ? `
        <a class="listing-thumb-link" href="${href}">
          <div class="seller-avatar" style="aspect-ratio:1/1;overflow:hidden;background:#fff;display:flex;align-items:center;justify-content:center;">
            <img src="${avatarUrl}" alt="${storeName}" loading="lazy" style="max-width:100%;max-height:100%;object-fit:contain;">
          </div>
        </a>
        ` : ``}
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

  /* ===== LISTING SEARCH (OPTIMIZED) ===== */
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

    // Get filter values
    const searchTerm = (qInput?.value || "").trim();
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
    const designerVal = (designerEl?.value || "").trim();
    const feelsVal = (feelsEl?.value || "").trim();
    const burnTestVal = (burnTestEl?.value || "").trim();
    const isCosplayFilterOn = document.getElementById("cosplayFilter")?.checked;

    const now = new Date().toISOString();

    let listings = [];
    try {
      // ============================================================
      // BUILD SERVER-SIDE QUERY (much faster than client-side filtering)
      // ============================================================
      let query = supabaseClient
        .from("listings")
        .select("id, title, description, price_cents, orig_price_cents, yards_available, content, image_url_1, seller_id, status, published_at, color_family, fabric_type, feels_like, width_in, weight_gsm, dept, fiber_type, pattern, country_of_origin, origin, designer, burn_test, is_published", { count: 'exact' })
        .eq("is_published", true)
        .eq("status", "active")
        .gt("yards_available", 0)
        .lte("published_at", now);

      // Apply text search
      if (searchTerm) {
        query = query.or(`title.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
      }

      // Apply price filters
      if (minPrice != null) {
        query = query.gte("price_cents", Math.round(minPrice * 100));
      }
      if (maxPrice != null) {
        query = query.lte("price_cents", Math.round(maxPrice * 100));
      }

      // Apply yards filter
      if (minYards != null) {
        query = query.gte("yards_available", minYards);
      }

      // Apply width filters
      if (minWidth != null) {
        query = query.gte("width_in", minWidth);
      }
      if (maxWidth != null) {
        query = query.lte("width_in", maxWidth);
      }

      // Apply GSM filters
      if (minGsm != null) {
        query = query.gte("weight_gsm", minGsm);
      }
      if (maxGsm != null) {
        query = query.lte("weight_gsm", maxGsm);
      }

      // Apply dropdown filters
      if (deptVal) {
        query = query.eq("dept", deptVal);
      }
      if (fiberVal) {
        query = query.eq("fiber_type", fiberVal);
      }
      if (patternVal) {
        query = query.eq("pattern", patternVal);
      }
      if (originVal) {
        query = query.or(`country_of_origin.eq.${originVal},origin.eq.${originVal}`);
      }
      if (designerVal) {
        query = query.ilike("designer", `%${designerVal}%`);
      }
      if (burnTestVal) {
        query = query.ilike("burn_test", burnTestVal);
      }

      // Apply color filter (if single color selected)
      if (selectedColors.size === 1) {
        const color = Array.from(selectedColors)[0];
        query = query.eq("color_family", color);
      }

      // Get sort order
      const sortBy = document.getElementById("sortBy")?.value || "newest";
      switch (sortBy) {
        case "price-low":
          query = query.order("price_cents", { ascending: true });
          break;
        case "price-high":
          query = query.order("price_cents", { ascending: false });
          break;
        case "yards-high":
          query = query.order("yards_available", { ascending: false });
          break;
        case "newest":
        default:
          query = query.order("published_at", { ascending: false, nullsFirst: false });
      }

      // Pagination
      const from = currentPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) {
        console.error("Listings fetch error", error);
        if (grid && typeof window.generateErrorState === 'function') {
          grid.innerHTML = window.generateErrorState('Unable to load listings. Please check your connection and try again.');
        }
        if (countEl) countEl.textContent = "";
        return;
      }
      listings = data || [];
      totalCount = count || 0;
    } catch (e) {
      console.error("Listings fetch exception", e);
      if (grid && typeof window.generateErrorState === 'function') {
        grid.innerHTML = window.generateErrorState('Something went wrong. Please try again.');
      }
      if (countEl) countEl.textContent = "";
      return;
    }

    // ============================================================
    // CLIENT-SIDE FILTERING (only for complex filters not supported server-side)
    // These are filters that need array/contains logic
    // ============================================================
    let filtered = listings;

    // Content filter (multi-select with partial match)
    if (selectedContents.size > 0 && !selectedContents.has("Any")) {
      filtered = filtered.filter(l => {
        const lc = (l.content || "").toLowerCase();
        for (const v of selectedContents) {
          if (lc.includes(v.toLowerCase())) return true;
        }
        return false;
      });
    }

    // Fabric type filter (multi-select)
    if (selectedFabricTypes.size > 0) {
      filtered = filtered.filter(l => {
        const listingFabricTypes = (l.fabric_type || "").split(",").map(s => s.trim().toLowerCase());
        for (const selected of selectedFabricTypes) {
          if (listingFabricTypes.some(ft => ft === selected.toLowerCase())) return true;
        }
        return false;
      });
    }

    // Color filter (multi-select - if more than one color)
    if (selectedColors.size > 1) {
      filtered = filtered.filter(l => {
        return l.color_family && selectedColors.has(l.color_family);
      });
    }

    // Feels like filter
    if (feelsVal) {
      filtered = filtered.filter(l => {
        const src = l.feels_like;
        let arr = [];
        if (Array.isArray(src)) {
          arr = src;
        } else if (typeof src === "string" && src.trim().length) {
          arr = src.split(",").map(s => s.trim());
        }
        const lowerSet = new Set(arr.map(v => v.toLowerCase()));
        return lowerSet.has(feelsVal.toLowerCase());
      });
    }

    // Cosplay filter
    if (isCosplayFilterOn) {
      filtered = filtered.filter(l => {
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

        return matchesFabricType || matchesFeelsLike || matchesContent;
      });
    }

    const displayTotal = filtered.length;
    const hasFilters = searchTerm || minPrice || maxPrice || minYards || minWidth || maxWidth || minGsm || maxGsm || deptVal || fiberVal || patternVal || originVal || designerVal || feelsVal || burnTestVal || selectedColors.size > 0 || selectedContents.size > 0 || selectedFabricTypes.size > 0 || isCosplayFilterOn;

    if (countEl) {
      if (totalCount > PAGE_SIZE) {
        countEl.textContent = `${displayTotal} of ${totalCount} listings`;
      } else {
        countEl.textContent = displayTotal === 1 ? "1 listing" : displayTotal + " listings";
      }
    }

    if (!displayTotal) {
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

      // Add pagination controls if needed
      if (totalCount > PAGE_SIZE) {
        renderPagination(grid, totalCount);
      }
    }
  }

  /* ===== PAGINATION UI ===== */
  function renderPagination(grid, total) {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    if (totalPages <= 1) return;

    const paginationDiv = document.createElement("div");
    paginationDiv.className = "pagination";
    paginationDiv.style.cssText = "grid-column: 1 / -1; display: flex; justify-content: center; gap: 8px; padding: 24px 0;";

    // Previous button
    if (currentPage > 0) {
      const prevBtn = document.createElement("button");
      prevBtn.textContent = "← Previous";
      prevBtn.className = "pagination-btn";
      prevBtn.style.cssText = "padding: 8px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; cursor: pointer;";
      prevBtn.addEventListener("click", () => {
        currentPage--;
        runSearch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      paginationDiv.appendChild(prevBtn);
    }

    // Page info
    const pageInfo = document.createElement("span");
    pageInfo.textContent = `Page ${currentPage + 1} of ${totalPages}`;
    pageInfo.style.cssText = "padding: 8px 16px; display: flex; align-items: center;";
    paginationDiv.appendChild(pageInfo);

    // Next button
    if (currentPage < totalPages - 1) {
      const nextBtn = document.createElement("button");
      nextBtn.textContent = "Next →";
      nextBtn.className = "pagination-btn";
      nextBtn.style.cssText = "padding: 8px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: white; cursor: pointer;";
      nextBtn.addEventListener("click", () => {
        currentPage++;
        runSearch();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      paginationDiv.appendChild(nextBtn);
    }

    grid.appendChild(paginationDiv);
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

    currentPage = 0;
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
        currentPage = 0;
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
        currentPage = 0;
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
          currentPage = 0;
          runSearch();
        }
      });
    }

    runSearch();

    // Sort dropdown
    document.getElementById("sortBy")?.addEventListener("change", () => {
      currentPage = 0;
      runSearch();
    });

    // Filter dropdowns
    ["dept", "fiberType", "pattern", "origin", "feelsLike", "burnTest"].forEach(id => {
      document.getElementById(id)?.addEventListener("change", () => {
        currentPage = 0;
        runSearch();
      });
    });

    // Numeric inputs with debounce
    let debounceTimer;
    const debounceSearch = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentPage = 0;
        runSearch();
      }, 400);
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
      currentPage = 0;
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
