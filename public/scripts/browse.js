/**
 * HEMLINE MARKET - Browse Page JavaScript
 * public/scripts/browse.js
 * 
 * Handles browse page listings, filters, ateliers search.
 * Requires: supabase-config.js (must be loaded first), hm-shell.js, browse-enhancements.js
 * 
 * FIX: Now uses centralized Supabase config instead of hardcoded credentials
 */

(function() {
  'use strict';

  /* ===== SUPABASE CLIENT ===== */
  // FIX: Use centralized config instead of hardcoding credentials
  // This relies on supabase-config.js being loaded first
  let supabaseClient = null;
  
  function getClient() {
    if (supabaseClient) return supabaseClient;
    
    // Try centralized config first
    if (typeof window.getSupabaseClient === 'function') {
      supabaseClient = window.getSupabaseClient();
      if (supabaseClient) return supabaseClient;
    }
    
    // Fallback: use global config variables
    if (window.HM_SUPABASE_URL && window.HM_SUPABASE_ANON_KEY && window.supabase?.createClient) {
      supabaseClient = window.supabase.createClient(
        window.HM_SUPABASE_URL,
        window.HM_SUPABASE_ANON_KEY
      );
      return supabaseClient;
    }
    
    console.error('[browse.js] Supabase client not available. Ensure supabase-config.js is loaded first.');
    return null;
  }

  // "listings" (default) vs "ateliers"
  let currentMode = "listings";

  /* ===== FILTER CONSTANTS ===== */
  const CONTENTS = [
    "Acetate", "Acrylic", "Alpaca", "Angora", "Bamboo", "Camel", "Cashmere", "Cotton",
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
    "Denim", "Double Knit", "Embroidered", "Eyelet", "Faux Fur", "Faux Leather", 
    "Flannel", "Fleece", "Gabardine", "Georgette", "Interlock", "Jacquard", "Jersey",
    "Lace", "Lawn", "Lining", "Mesh", "Metallic / Lame", "Minky", "Organza", "Ponte",
    "Rib Knit", "Sateen", "Satin", "Scuba", "Shirting", "Suiting", "Tulle", "Tweed",
    "Twill", "Velvet", "Vinyl", "Voile"
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

    const client = getClient();
    if (!client) return map;

    try {
      const { data, error } = await client
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
    } catch (err) {
      console.error("Profile fetch exception", err);
    }

    return map;
  }

  /* ===== LISTINGS FETCH ===== */
  async function fetchListings(options = {}) {
    const client = getClient();
    if (!client) {
      console.error('[browse.js] Cannot fetch listings: Supabase client not available');
      return { data: [], error: new Error('Supabase client not available') };
    }

    const {
      search = "",
      content = [],
      color = [],
      fabricType = [],
      minPrice = null,
      maxPrice = null,
      minYards = null,
      maxYards = null,
      sortBy = "newest",
      limit = 50,
      offset = 0,
      sellerId = null,
      cosplayMode = false,
    } = options;

    let query = client
      .from("listings")
      .select("*", { count: "exact" })
      .eq("status", "ACTIVE");

    // Search
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Content filter
    if (content.length > 0) {
      const contentFilters = content.map(c => `content.ilike.%${c}%`).join(",");
      query = query.or(contentFilters);
    }

    // Color filter
    if (color.length > 0) {
      const colorFilters = color.map(c => `color.ilike.%${c}%`).join(",");
      query = query.or(colorFilters);
    }

    // Fabric type filter
    if (fabricType.length > 0) {
      const typeFilters = fabricType.map(t => `fabric_type.ilike.%${t}%,feels_like.ilike.%${t}%`).join(",");
      query = query.or(typeFilters);
    }

    // Price filters (price is in dollars in DB)
    if (minPrice !== null) {
      query = query.gte("price", minPrice);
    }
    if (maxPrice !== null) {
      query = query.lte("price", maxPrice);
    }

    // Yards filters
    if (minYards !== null) {
      query = query.gte("yards_available", minYards);
    }
    if (maxYards !== null) {
      query = query.lte("yards_available", maxYards);
    }

    // Seller filter
    if (sellerId) {
      query = query.eq("seller_id", sellerId);
    }

    // Cosplay mode - filter for cosplay-friendly fabrics
    if (cosplayMode) {
      const cosplayFilters = [
        ...COSPLAY_FABRIC_TYPES.map(t => `fabric_type.ilike.%${t}%`),
        ...COSPLAY_FEELS_LIKE.map(f => `feels_like.ilike.%${f}%`),
        ...COSPLAY_CONTENTS.map(c => `content.ilike.%${c}%`),
      ].join(",");
      query = query.or(cosplayFilters);
    }

    // Sorting
    switch (sortBy) {
      case "price_low":
        query = query.order("price", { ascending: true });
        break;
      case "price_high":
        query = query.order("price", { ascending: false });
        break;
      case "oldest":
        query = query.order("created_at", { ascending: true });
        break;
      case "newest":
      default:
        query = query.order("created_at", { ascending: false });
        break;
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    return { data: data || [], error, count };
  }

  /* ===== ATELIERS FETCH ===== */
  async function fetchAteliers(searchTerm = "") {
    const client = getClient();
    if (!client) {
      console.error('[browse.js] Cannot fetch ateliers: Supabase client not available');
      return { data: [], error: new Error('Supabase client not available') };
    }

    let query = client
      .from("profiles")
      .select("id, display_name, store_name, first_name, last_name, bio, avatar_url, created_at")
      .eq("is_seller", true);

    if (searchTerm) {
      query = query.or(`store_name.ilike.%${searchTerm}%,display_name.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%`);
    }

    query = query.order("created_at", { ascending: false }).limit(50);

    const { data, error } = await query;
    return { data: data || [], error };
  }

  /* ===== RENDER FUNCTIONS ===== */
  function renderListingCard(listing, sellerProfile = null) {
    const price = listing.price != null ? `$${Number(listing.price).toFixed(2)}` : "";
    const yards = listing.yards_available != null ? `${listing.yards_available} yd` : "";
    const badge = getListingBadgeLabel(listing);
    const sellerName = sellerProfile?.store_name || sellerProfile?.display_name || 
                       [sellerProfile?.first_name, sellerProfile?.last_name].filter(Boolean).join(" ") || "";

    const imageUrl = listing.image_urls?.[0] || listing.image_url || "/images/empty-state.svg";

    return `
      <a href="/listing.html?id=${listing.id}" class="listing-card" data-id="${listing.id}">
        <div class="listing-thumb">
          <img src="${thumbUrl(imageUrl)}" alt="${escapeHtml(listing.title)}" loading="lazy" />
          ${badge ? `<span class="listing-badge">${escapeHtml(badge)}</span>` : ""}
        </div>
        <div class="listing-info">
          <div class="listing-title">${escapeHtml(listing.title)}</div>
          <div class="listing-meta">
            ${price ? `<span class="listing-price">${price}/yd</span>` : ""}
            ${yards ? `<span class="listing-yards">${yards}</span>` : ""}
          </div>
          ${sellerName ? `<div class="listing-seller">${escapeHtml(sellerName)}</div>` : ""}
        </div>
      </a>
    `;
  }

  function renderAtelierCard(profile) {
    const name = profile.store_name || profile.display_name || 
                 [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Unnamed Seller";
    const avatarUrl = profile.avatar_url || "/images/empty-state.svg";
    const bio = profile.bio ? profile.bio.slice(0, 100) + (profile.bio.length > 100 ? "..." : "") : "";

    return `
      <a href="/seller/index.html?id=${profile.id}" class="atelier-card">
        <img src="${avatarUrl}" alt="${escapeHtml(name)}" class="atelier-avatar" loading="lazy" />
        <div class="atelier-info">
          <div class="atelier-name">${escapeHtml(name)}</div>
          ${bio ? `<div class="atelier-bio">${escapeHtml(bio)}</div>` : ""}
        </div>
      </a>
    `;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* ===== MAIN RENDER ===== */
  async function renderBrowsePage() {
    const grid = document.getElementById("listingsGrid");
    const countEl = document.getElementById("listingsCount");
    const loadingEl = document.getElementById("loadingIndicator");
    const emptyEl = document.getElementById("emptyState");

    if (!grid) return;

    // Show loading
    if (loadingEl) loadingEl.classList.remove("is-hidden");
    if (emptyEl) emptyEl.classList.add("is-hidden");
    grid.innerHTML = "";

    // Get filter values from URL or state
    const params = new URLSearchParams(window.location.search);
    const search = params.get("q") || "";
    const cosplayMode = params.get("cosplay") === "1";
    const sortBy = params.get("sort") || "newest";
    const minPrice = numeric(params.get("minPrice"));
    const maxPrice = numeric(params.get("maxPrice"));
    const minYards = numeric(params.get("minYards"));
    const maxYards = numeric(params.get("maxYards"));

    // Determine mode
    currentMode = params.get("mode") === "ateliers" ? "ateliers" : "listings";

    try {
      if (currentMode === "ateliers") {
        const { data, error } = await fetchAteliers(search);
        if (loadingEl) loadingEl.classList.add("is-hidden");

        if (error) {
          console.error("Atelier fetch error", error);
          grid.innerHTML = `<p class="error">Error loading ateliers</p>`;
          return;
        }

        if (!data.length) {
          if (emptyEl) emptyEl.classList.remove("is-hidden");
          if (countEl) countEl.textContent = "0 ateliers";
          return;
        }

        if (countEl) countEl.textContent = `${data.length} atelier${data.length !== 1 ? "s" : ""}`;
        grid.innerHTML = data.map(p => renderAtelierCard(p)).join("");
      } else {
        const { data, error, count } = await fetchListings({
          search,
          content: Array.from(selectedContents),
          color: Array.from(selectedColors),
          fabricType: Array.from(selectedFabricTypes),
          minPrice,
          maxPrice,
          minYards,
          maxYards,
          sortBy,
          cosplayMode,
        });

        if (loadingEl) loadingEl.classList.add("is-hidden");

        if (error) {
          console.error("Listings fetch error", error);
          grid.innerHTML = `<p class="error">Error loading listings</p>`;
          return;
        }

        if (!data.length) {
          if (emptyEl) emptyEl.classList.remove("is-hidden");
          if (countEl) countEl.textContent = "0 fabrics";
          return;
        }

        // Fetch seller profiles
        const profiles = await fetchProfilesForListings(data);

        if (countEl) countEl.textContent = `${count || data.length} fabric${(count || data.length) !== 1 ? "s" : ""}`;
        grid.innerHTML = data.map(l => renderListingCard(l, profiles[l.seller_id])).join("");
      }
    } catch (err) {
      console.error("Browse render error", err);
      if (loadingEl) loadingEl.classList.add("is-hidden");
      grid.innerHTML = `<p class="error">Error loading content</p>`;
    }
  }

  /* ===== INITIALIZATION ===== */
  function init() {
    // Wait for Supabase to be available
    if (!getClient()) {
      console.warn('[browse.js] Waiting for Supabase client...');
      setTimeout(init, 100);
      return;
    }

    renderBrowsePage();

    // Listen for filter changes
    window.addEventListener("filtersChanged", renderBrowsePage);
    window.addEventListener("popstate", renderBrowsePage);
  }

  // Export for external use
  window.HM = window.HM || {};
  window.HM.browse = {
    fetchListings,
    fetchAteliers,
    renderBrowsePage,
    CONTENTS,
    COLORS,
    FABRIC_TYPES,
  };

  // Initialize when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
