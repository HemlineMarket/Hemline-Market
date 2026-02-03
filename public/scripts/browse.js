/**
 * HEMLINE MARKET - Browse Page JavaScript
 * public/scripts/browse.js
 * 
 * Handles browse page listings, filters, ateliers search.
 * FIXED: Correct price handling, 8pm release time, badge on yards line
 */

(function() {
  'use strict';

  /* ===== SUPABASE CLIENT ===== */
  let supabaseClient = null;
  
  function getClient() {
    if (supabaseClient) return supabaseClient;
    
    if (typeof window.getSupabaseClient === 'function') {
      supabaseClient = window.getSupabaseClient();
      if (supabaseClient) return supabaseClient;
    }
    
    if (window.HM && window.HM.supabase) {
      supabaseClient = window.HM.supabase;
      return supabaseClient;
    }
    
    if (window.HM_SUPABASE_URL && window.HM_SUPABASE_ANON_KEY && window.supabase?.createClient) {
      supabaseClient = window.supabase.createClient(window.HM_SUPABASE_URL, window.HM_SUPABASE_ANON_KEY);
      return supabaseClient;
    }
    
    if (window.supabase?.createClient) {
      supabaseClient = window.supabase.createClient(
        "https://clkizksbvxjkoatdajgd.supabase.co",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI"
      );
      return supabaseClient;
    }
    
    console.error('[browse.js] Supabase client not available.');
    return null;
  }

  let currentMode = "listings";
  const PAGE_SIZE = 12;

  /* ===== FILTER CONSTANTS ===== */
  const CONTENTS = [
    "Acetate", "Acrylic", "Alpaca", "Angora", "Bamboo", "Camel", "Cashmere", "Cotton",
    "Cupro", "Hemp", "Jute", "Leather", "Linen", "Lurex", "Lyocell", "Merino",
    "Modal", "Mohair", "Nylon", "Polyester", "Ramie", "Rayon", "Silk",
    "Spandex / Elastane", "Tencel", "Triacetate", "Viscose", "Wool", "Yak", "Other"
  ];

  const COLORS = [
    { name: "Black", hex: "#000000" },
    { name: "Grey", hex: "#9ca3af" },
    { name: "White", hex: "#ffffff" },
    { name: "Cream", hex: "#fffdd0" },
    { name: "Brown", hex: "#8B4513" },
    { name: "Pink", hex: "#ec4899" },
    { name: "Red", hex: "#ef4444" },
    { name: "Orange", hex: "#f97316" },
    { name: "Yellow", hex: "#eab308" },
    { name: "Green", hex: "#22c55e" },
    { name: "Blue", hex: "#3b82f6" },
    { name: "Purple", hex: "#a855f7" },
    { name: "Gold", hex: "#ffd700" },
    { name: "Silver", hex: "#c0c0c0" }
  ];

  const FABRIC_TYPES = [
    "Broadcloth", "Brocade", "Canvas", "Challis", "Chambray", "Charmeuse", "Chiffon", 
    "Corduroy", "Crepe", "Crepe de Chine", "Denim", "Double Cloth", "Double Knit", 
    "Duchesse", "Dupioni", "Embroidered", "Eyelet", "Faux Fur", "Faux Leather", 
    "Flannel", "Fleece", "Gabardine", "Gauze", "Gazar", "Georgette", "Habotai",
    "Interlock", "Jacquard", "Jersey", "Knit", "Lace", "Lamé", "Lawn", "Lining", 
    "Mesh", "Metallic", "Mikado", "Minky", "Muslin", "Organza", "Ottoman", "Oxford",
    "Peau de Soie", "Ponte", "Poplin", "Rib Knit", "Sateen", "Satin", "Scuba", 
    "Shirting", "Suiting", "Taffeta", "Terry / French Terry", "Tropical", "Tulle", 
    "Tweed", "Twill", "Velvet", "Vinyl", "Voile", "Woven"
  ];

  const COSPLAY_FABRIC_TYPES = [
    // Core cosplay fabrics
    "Brocade", "Charmeuse", "Chiffon", "Faux Fur", "Faux Leather", "Fleece", "Jersey", 
    "Lace", "Mesh", "Metallic", "Lamé", "Minky", "Organza", "Ponte", "Satin", "Scuba", 
    "Spandex / Lycra", "Tulle", "Velvet", "Vinyl",
    // Velvet variants
    "Stretch Velvet", "Crushed Velvet", "Panne Velvet", "Velour",
    // Shiny/specialty fabrics
    "Sequin", "Holographic", "Iridescent", "PVC", "Pleather", "Neoprene",
    // Satin variants
    "Stretch Satin", "Duchesse", "Duchess Satin", "Crepe Back Satin", "Bridal Satin",
    // Stretch fabrics
    "Spandex", "Lycra", "4-Way Stretch", "Milliskin", "Power Mesh", "Stretch Lace",
    // Dance/performance
    "Dance", "Costume", "Swimwear", "Athletic"
  ];

  const COSPLAY_FEELS_LIKE = [
    // Core feels
    "brocade", "charmeuse", "chiffon", "faux fur", "faux leather", "fleece", "jersey knit", 
    "lace", "mesh", "metallic", "lame", "minky", "organza", "ponte", "satin", "scuba", 
    "spandex / lycra", "tulle", "velvet / velour", "vinyl",
    // Additional feels
    "stretch velvet", "crushed velvet", "panne", "velour", "sequin", "holographic", 
    "iridescent", "pvc", "pleather", "neoprene", "stretch satin", "duchess", "bridal satin",
    "spandex", "lycra", "4-way stretch", "milliskin", "power mesh", "stretch lace",
    "dance", "costume", "swimwear", "athletic", "performance"
  ];

  const COSPLAY_CONTENTS = [
    "lurex", "spandex", "elastane", "lycra", "nylon", "polyester"
  ];

  /* ===== FILTER STATE ===== */
  const selectedContents = new Set();
  const selectedColors = new Set();
  const selectedFabricTypes = new Set();
  window.selectedContents = selectedContents;
  window.selectedColors = selectedColors;
  window.selectedFabricTypes = selectedFabricTypes;

  /* ===== HELPER FUNCTIONS ===== */
  function moneyFromCents(c) {
    if (c == null) return null;
    return (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  }

  function thumbUrl(url) { return url || ""; }

  function numeric(val) {
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : null;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  /**
   * Sort fiber content to display premium/natural fibers first
   * Priority: Wool, Silk, Cotton, Linen before synthetics like Spandex
   */
  const FIBER_PRIORITY = {
    'cashmere': 1, 'vicuna': 2, 'qiviut': 3,
    'silk': 5, 'mulberry silk': 5,
    'wool': 10, 'merino': 11, 'alpaca': 12, 'mohair': 13, 'angora': 14, 'camel': 15, 'yak': 16,
    'linen': 20, 'flax': 20,
    'cotton': 25, 'pima cotton': 24, 'egyptian cotton': 23, 'supima': 24,
    'hemp': 30, 'ramie': 31, 'jute': 32, 'bamboo': 35,
    'leather': 40,
    'viscose': 50, 'rayon': 51, 'modal': 52, 'lyocell': 53, 'tencel': 53, 'cupro': 54, 'acetate': 55, 'triacetate': 56,
    'polyester': 70, 'nylon': 71, 'acrylic': 72,
    'spandex': 80, 'elastane': 80, 'lycra': 80, 'spandex / elastane': 80,
    'lurex': 85, 'metallic': 86,
    'other': 99
  };

  function formatContentForDisplay(content) {
    if (!content) return "";
    const fibers = content.split(",").map(s => s.trim()).filter(Boolean);
    // Sort by priority (natural fibers first)
    fibers.sort((a, b) => {
      const aPriority = FIBER_PRIORITY[a.toLowerCase()] ?? 60;
      const bPriority = FIBER_PRIORITY[b.toLowerCase()] ?? 60;
      return aPriority - bPriority;
    });
    // Shorten "Spandex / Elastane" to "Elastane" for display
    return fibers.map(s => s === "Spandex / Elastane" ? "Elastane" : s).join(", ");
  }

  function getListingBadgeLabel(listing) {
    const parts = [];
    
    // Add fiber content (e.g., "Wool, Silk")
    if (listing.content && listing.content !== "Not sure" && listing.content !== "Other") {
      parts.push(formatContentForDisplay(listing.content));
    }
    
    // Add fabric type (e.g., "Jersey", "Suiting") - check for non-empty string
    const fabricType = listing.fabric_type?.trim();
    const feelsLike = listing.feels_like?.trim();
    
    if (fabricType) {
      parts.push(fabricType);
    } else if (feelsLike) {
      const feels = feelsLike.split(",")[0].trim();
      parts.push(feels.charAt(0).toUpperCase() + feels.slice(1));
    }
    
    return parts.join(" · ");
  }

  /* ===== FILTER UI INITIALIZATION ===== */
  function initFilters() {
    initContentCheckboxes();
    initFabricTypeCheckboxes();
    initColorSwatches();
    initFilterToggle();
    initCosplayFilter();
    initSearchAndSort();
  }

  function initContentCheckboxes() {
    const container = document.getElementById('contentBox');
    if (!container) return;
    container.innerHTML = CONTENTS.map(content => 
      '<div class="row"><input type="checkbox" id="content-' + content.replace(/[\s\/]+/g, '-') + '" name="content" value="' + content + '"><label for="content-' + content.replace(/[\s\/]+/g, '-') + '">' + content + '</label></div>'
    ).join('');
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', function() {
        this.checked ? selectedContents.add(this.value) : selectedContents.delete(this.value);
        runSearch();
      });
    });
  }

  function initFabricTypeCheckboxes() {
    const container = document.getElementById('fabricTypeBox');
    if (!container) return;
    container.innerHTML = FABRIC_TYPES.map(type => 
      '<div class="row"><input type="checkbox" id="fabricType-' + type.replace(/[\s\/]+/g, '-') + '" name="fabricType" value="' + type + '"><label for="fabricType-' + type.replace(/[\s\/]+/g, '-') + '">' + type + '</label></div>'
    ).join('');
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', function() {
        this.checked ? selectedFabricTypes.add(this.value) : selectedFabricTypes.delete(this.value);
        runSearch();
      });
    });
  }

  function initColorSwatches() {
    const container = document.getElementById('colorBox');
    if (!container) return;
    container.innerHTML = COLORS.map(color => 
      '<div class="sw" data-name="' + color.name + '" data-selected="false" style="background:' + color.hex + ';" title="' + color.name + '"><span class="tip">' + color.name + '</span></div>'
    ).join('');
    container.querySelectorAll('.sw').forEach(sw => {
      sw.addEventListener('click', function() {
        const colorName = this.dataset.name;
        const isSelected = this.dataset.selected === 'true';
        isSelected ? selectedColors.delete(colorName) : selectedColors.add(colorName);
        this.dataset.selected = isSelected ? 'false' : 'true';
        runSearch();
      });
    });
  }

  function initFilterToggle() {
    const toggleBtn = document.getElementById('toggleFilters');
    const layout = document.getElementById('layout');
    if (!toggleBtn || !layout) return;

    function checkMobileFilters() {
      if (window.innerWidth <= 900) {
        layout.classList.add('filters-hidden');
        toggleBtn.textContent = 'Show filters';
        toggleBtn.setAttribute('aria-pressed', 'false');
      }
    }
    checkMobileFilters();

    toggleBtn.addEventListener('click', function() {
      const isHidden = layout.classList.toggle('filters-hidden');
      this.textContent = isHidden ? 'Show filters' : 'Hide filters';
      this.setAttribute('aria-pressed', !isHidden);
    });

    window.addEventListener('resize', checkMobileFilters);
  }

  function initCosplayFilter() {
    const checkbox = document.getElementById('cosplayFilter');
    const hint = document.getElementById('cosplayHint');
    const label = document.getElementById('cosplayLabel');
    if (!checkbox) return;
    checkbox.addEventListener('change', function() {
      if (hint) hint.style.display = this.checked ? 'block' : 'none';
      if (label) {
        label.style.borderColor = this.checked ? 'var(--accent)' : 'var(--border)';
        label.style.background = this.checked ? '#fef2f2' : '#fff';
      }
      runSearch();
    });
  }

  function initSearchAndSort() {
    const searchBtn = document.getElementById('doSearch');
    const searchInput = document.getElementById('q');
    const sortSelect = document.getElementById('sortBy');
    const modeSelect = document.getElementById('searchMode');

    if (searchBtn) searchBtn.addEventListener('click', runSearch);
    if (searchInput) searchInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
    if (sortSelect) sortSelect.addEventListener('change', runSearch);
    if (modeSelect) modeSelect.addEventListener('change', function() {
      currentMode = this.value === 'sellers' ? 'ateliers' : 'listings';
      if (searchInput) searchInput.placeholder = currentMode === 'ateliers' ? 'Search sellers...' : 'Search fabrics...';
      runSearch();
    });

    ['minPrice', 'maxPrice', 'minYards', 'minWidth', 'maxWidth', 'minGsm', 'maxGsm'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', runSearch);
    });

    ['dept', 'fiberType', 'origin', 'designer', 'feelsLike', 'burnTest', 'pattern'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', runSearch);
    });
  }

  /* ===== DATA FETCHING ===== */
  async function fetchProfilesForListings(listings) {
    const map = {};
    const ids = Array.from(new Set((listings || []).map(l => l.seller_id).filter(Boolean)));
    if (!ids.length) return map;
    const client = getClient();
    if (!client) return map;
    try {
      const { data } = await client.from("profiles").select("id, display_name, store_name, first_name, last_name").in("id", ids);
      (data || []).forEach(p => { map[p.id] = p; });
    } catch (err) { console.error("Profile fetch error", err); }
    return map;
  }

  async function fetchCartHolds(listingIds) {
    const map = {};
    if (!listingIds || !listingIds.length) return map;
    try {
      const res = await fetch('/api/cart/hold?listings=' + listingIds.join(','));
      if (res.ok) {
        const data = await res.json();
        (data.holds || []).forEach(h => { map[h.listing_id] = h; });
      }
    } catch (e) { console.error('Cart hold fetch error', e); }
    return map;
  }

  async function fetchListings(options) {
    const client = getClient();
    if (!client) return { data: [], error: new Error('Supabase client not available') };

    const { search = "", content = [], color = [], fabricType = [], minPrice = null, maxPrice = null, minYards = null, sortBy = "newest", limit = PAGE_SIZE, offset = 0, cosplayMode = false, dept = null, fiberType = null, origin = null, designer = null, feelsLike = null, burnTest = null, pattern = null, minWidth = null, maxWidth = null, minGsm = null, maxGsm = null } = options || {};

    let query = client.from("listings").select("*", { count: "exact" }).eq("status", "ACTIVE").eq("is_published", true).gt("yards_available", 0);

    // 8pm release time filter
    const now = new Date();
    query = query.or('published_at.is.null,published_at.lte.' + now.toISOString());

    if (search) query = query.or('title.ilike.%' + search + '%,description.ilike.%' + search + '%');
    if (content.length > 0) query = query.or(content.map(c => 'content.ilike.%' + c + '%').join(","));
    if (color.length > 0) query = query.or(color.map(c => 'color.ilike.%' + c + '%').join(","));
    if (fabricType.length > 0) query = query.or(fabricType.map(t => 'fabric_type.ilike.%' + t + '%,feels_like.ilike.%' + t + '%').join(","));
    if (minPrice !== null) query = query.gte("price", minPrice);
    if (maxPrice !== null) query = query.lte("price", maxPrice);
    if (minYards !== null) query = query.gte("yards_available", minYards);
    if (minWidth !== null) query = query.gte("width_inches", minWidth);
    if (maxWidth !== null) query = query.lte("width_inches", maxWidth);
    if (minGsm !== null) query = query.gte("gsm", minGsm);
    if (maxGsm !== null) query = query.lte("gsm", maxGsm);
    if (dept) query = query.eq("department", dept);
    if (fiberType) query = query.eq("fiber_type", fiberType);
    if (origin) query = query.eq("origin_country", origin);
    if (designer) query = query.ilike("designer_mill", '%' + designer + '%');
    if (feelsLike) query = query.ilike("feels_like", '%' + feelsLike + '%');
    if (burnTest) query = query.eq("burn_test", burnTest);
    if (pattern) query = query.eq("pattern", pattern);

    if (cosplayMode) {
      const cosplayFilters = [...COSPLAY_FABRIC_TYPES.map(t => 'fabric_type.ilike.%' + t + '%'), ...COSPLAY_FEELS_LIKE.map(f => 'feels_like.ilike.%' + f + '%'), ...COSPLAY_CONTENTS.map(c => 'content.ilike.%' + c + '%')].join(",");
      query = query.or(cosplayFilters);
    }

    switch (sortBy) {
      case "price-low": query = query.order("price_cents", { ascending: true, nullsFirst: false }); break;
      case "price-high": query = query.order("price_cents", { ascending: false, nullsFirst: false }); break;
      case "yards-high": query = query.order("yards_available", { ascending: false, nullsFirst: false }); break;
      default: query = query.order("created_at", { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);
    const { data, error, count } = await query;
    return { data: data || [], error, count };
  }

  async function fetchAteliers(searchTerm) {
    const client = getClient();
    if (!client) return { data: [], error: new Error('Supabase client not available') };

    let query = client.from("profiles").select("id, display_name, store_name, first_name, last_name, bio, avatar_url, created_at").eq("is_seller", true);
    if (searchTerm) query = query.or('store_name.ilike.%' + searchTerm + '%,display_name.ilike.%' + searchTerm + '%,first_name.ilike.%' + searchTerm + '%');
    query = query.order("created_at", { ascending: false }).limit(50);

    const { data, error } = await query;
    return { data: data || [], error };
  }

  /* ===== RENDER FUNCTIONS ===== */
  function renderListingCard(listing, sellerProfile, holdMap, myCartIds) {
    // FIXED: Get price from price_cents first, fall back to price field
    const priceCents = listing.price_cents != null ? Number(listing.price_cents) : null;
    const priceFromField = listing.price != null ? Number(listing.price) : null;
    const price = priceCents != null ? (priceCents / 100).toFixed(2) : (priceFromField != null ? priceFromField.toFixed(2) : null);
    const cents = priceCents != null ? priceCents : (priceFromField != null ? Math.round(priceFromField * 100) : null);
    
    // Original price for showing discount
    const origPriceCents = listing.orig_price_cents != null ? Number(listing.orig_price_cents) : null;
    const origPrice = origPriceCents != null ? (origPriceCents / 100).toFixed(2) : null;
    const hasDiscount = origPriceCents != null && cents != null && origPriceCents > cents;
    
    const yards = listing.yards_available;
    const badge = getListingBadgeLabel(listing);
    const sellerName = sellerProfile?.store_name || sellerProfile?.display_name || [sellerProfile?.first_name, sellerProfile?.last_name].filter(Boolean).join(" ") || "";
    const imageUrl = listing.image_url_1 || listing.image_urls?.[0] || listing.image_url || "/images/empty-state.svg";
    
    const totalCents = (cents != null && yards != null) ? cents * yards : null;
    const totalMoney = totalCents != null ? moneyFromCents(totalCents) : "";
    const status = (listing.status || "active").toLowerCase();
    const isSold = status === "sold" || (yards != null && yards <= 0);
    // FIXED: Use cents instead of price for canBuy check
    const canBuy = !isSold && cents != null && yards != null && yards > 0;
    
    const hold = holdMap[listing.id];
    const inMyCart = myCartIds.has(listing.id);
    const inSomeoneElsesCart = hold?.held && !inMyCart;
    let cartBadgeHtml = '';
    if (inMyCart) cartBadgeHtml = '<span class="cart-badge yours">✓ In your cart</span>';
    else if (inSomeoneElsesCart) cartBadgeHtml = '<span class="cart-badge others">🔥 In someone\'s cart</span>';
    const href = "listing.html?id=" + encodeURIComponent(listing.id);

    // Build price row with optional strikethrough original
    let priceRowHtml = '<div class="listing-price-row">';
    if (price) {
      priceRowHtml += '<span class="listing-price-main">$' + price + '/yd</span>';
      if (hasDiscount) {
        priceRowHtml += '<span class="listing-price-orig">$' + origPrice + '/yd</span>';
      }
    }
    priceRowHtml += '</div>';

    return '<article class="listing-card"><a class="listing-thumb-link" href="' + href + '"><div class="listing-thumb"><img src="' + thumbUrl(imageUrl) + '" alt="' + escapeHtml(listing.title) + '" loading="lazy" />' + cartBadgeHtml + '</div></a><div class="listing-body"><div class="listing-title-row"><a class="listing-title" href="' + href + '">' + escapeHtml(listing.title) + '</a></div>' + (yards != null ? '<div class="listing-yards">' + yards + ' yards' + (badge ? ' <span class="listing-dept">' + escapeHtml(badge) + '</span>' : '') + '</div>' : '') + '<div class="listing-cta-row"><button type="button" class="listing-add-btn add-to-cart" data-add-to-cart="1" data-listing-id="' + String(listing.id) + '" data-name="' + escapeHtml(listing.title) + '" data-photo="' + escapeHtml(imageUrl) + '" data-yards="' + (yards != null ? String(yards) : "0") + '" data-price="' + (price != null ? price : "0") + '" data-amount="' + (cents != null ? String(cents) : "0") + '" data-seller-id="' + String(listing.seller_id || "") + '" data-seller-name="' + escapeHtml(sellerName) + '"' + (!canBuy ? ' disabled' : '') + '>' + (canBuy && totalMoney && yards ? 'Add to Cart — ' + totalMoney + ' for ' + yards + ' yd' : (isSold ? "Sold out" : "Add to Cart")) + '</button></div>' + priceRowHtml + (sellerName ? '<div class="listing-seller-row"><span class="listing-seller-name">' + escapeHtml(sellerName) + '</span></div>' : "") + '</div></article>';
  }

  function renderAtelierCard(profile) {
    const name = profile.store_name || profile.display_name || [profile.first_name, profile.last_name].filter(Boolean).join(" ") || "Unnamed Seller";
    const avatarUrl = profile.avatar_url || "/images/empty-state.svg";
    const bio = profile.bio ? profile.bio.slice(0, 100) + (profile.bio.length > 100 ? "..." : "") : "";
    return '<a href="/seller/index.html?id=' + profile.id + '" class="atelier-card listing-card"><div class="listing-thumb"><img src="' + avatarUrl + '" alt="' + escapeHtml(name) + '" loading="lazy" /></div><div class="listing-body"><div class="listing-title">' + escapeHtml(name) + '</div>' + (bio ? '<div class="listing-yards">' + escapeHtml(bio) + '</div>' : "") + '</div></a>';
  }

  /* ===== MAIN SEARCH FUNCTION ===== */
  function gatherFilterValues() {
    return {
      search: document.getElementById('q')?.value?.trim() || "",
      sortBy: document.getElementById('sortBy')?.value || "newest",
      content: Array.from(selectedContents),
      color: Array.from(selectedColors),
      fabricType: Array.from(selectedFabricTypes),
      cosplayMode: document.getElementById('cosplayFilter')?.checked || false,
      minPrice: numeric(document.getElementById('minPrice')?.value),
      maxPrice: numeric(document.getElementById('maxPrice')?.value),
      minYards: numeric(document.getElementById('minYards')?.value),
      minWidth: numeric(document.getElementById('minWidth')?.value),
      maxWidth: numeric(document.getElementById('maxWidth')?.value),
      minGsm: numeric(document.getElementById('minGsm')?.value),
      maxGsm: numeric(document.getElementById('maxGsm')?.value),
      dept: document.getElementById('dept')?.value || null,
      fiberType: document.getElementById('fiberType')?.value || null,
      origin: document.getElementById('origin')?.value || null,
      designer: document.getElementById('designer')?.value?.trim() || null,
      feelsLike: document.getElementById('feelsLike')?.value || null,
      burnTest: document.getElementById('burnTest')?.value || null,
      pattern: document.getElementById('pattern')?.value || null,
    };
  }

  function hasAnyFilters(filters) {
    return filters.search || filters.content.length > 0 || filters.color.length > 0 || filters.fabricType.length > 0 || filters.cosplayMode || filters.minPrice !== null || filters.maxPrice !== null || filters.minYards !== null || filters.minWidth !== null || filters.maxWidth !== null || filters.minGsm !== null || filters.maxGsm !== null || filters.dept || filters.fiberType || filters.origin || filters.designer || filters.feelsLike || filters.burnTest || filters.pattern;
  }

  function getCurrentPage() {
    const params = new URLSearchParams(window.location.search);
    const page = parseInt(params.get('page'), 10);
    return (page && page > 0) ? page : 1;
  }

  function buildPageUrl(page) {
    const params = new URLSearchParams(window.location.search);
    if (page > 1) {
      params.set('page', page);
    } else {
      params.delete('page');
    }
    return window.location.pathname + '?' + params.toString();
  }

  function renderPagination(totalCount) {
    const existingNav = document.getElementById('paginationNav');
    if (existingNav) existingNav.remove();
    
    const currentPage = getCurrentPage();
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    
    if (totalPages <= 1) return;
    
    const nav = document.createElement('nav');
    nav.id = 'paginationNav';
    nav.className = 'pagination-nav';
    
    const prevDisabled = currentPage <= 1;
    const nextDisabled = currentPage >= totalPages;
    
    nav.innerHTML = 
      (currentPage > 2 ? '<a href="' + buildPageUrl(1) + '" class="page-btn">« First</a>' : '') +
      (prevDisabled ? '' : '<a href="' + buildPageUrl(currentPage - 1) + '" class="page-btn">← Prev</a>') +
      '<span class="page-num active">' + currentPage + '</span>' +
      (nextDisabled ? '' : '<a href="' + buildPageUrl(currentPage + 1) + '" class="page-btn">Next →</a>');
    
    const grid = document.getElementById('grid');
    if (grid) grid.parentNode.insertBefore(nav, grid.nextSibling);
  }

  async function runSearch(e) {
    // Reset to page 1 when filters/sort change
    // Only keep page if this is initial load or popstate
    if (e !== 'keepPage') {
      const params = new URLSearchParams(window.location.search);
      if (params.has('page')) {
        params.delete('page');
        history.replaceState(null, '', window.location.pathname + '?' + params.toString());
      }
    }

    // Sync sortBy into URL so pagination links preserve it
    const sortVal = document.getElementById('sortBy')?.value || 'newest';
    const urlParams = new URLSearchParams(window.location.search);
    if (sortVal && sortVal !== 'newest') {
      urlParams.set('sort', sortVal);
    } else {
      urlParams.delete('sort');
    }
    const newUrl = urlParams.toString()
      ? window.location.pathname + '?' + urlParams.toString()
      : window.location.pathname;
    if (window.location.pathname + window.location.search !== newUrl) {
      history.replaceState(null, '', newUrl);
    }

    const grid = document.getElementById("grid");
    const countEl = document.getElementById("resultCount");
    const emptyEl = document.getElementById("empty");
    const emptyFilteredEl = document.getElementById("emptyFiltered");
    const headingEl = document.getElementById("resultsHeading");

    if (!grid) { console.error('[browse.js] Grid element not found'); return; }

    const existingNav = document.getElementById('paginationNav');
    if (existingNav) existingNav.remove();

    if (typeof window.showSkeletonLoading === 'function') window.showSkeletonLoading(grid, 6);
    else grid.innerHTML = '<p style="text-align:center;padding:40px;color:#6b7280;">Loading...</p>';

    if (emptyEl) emptyEl.style.display = "none";
    if (emptyFilteredEl) emptyFilteredEl.style.display = "none";

    const filters = gatherFilterValues();
    const currentPage = getCurrentPage();
    filters.offset = (currentPage - 1) * PAGE_SIZE;
    filters.limit = PAGE_SIZE;
    const filtersActive = hasAnyFilters(filters);

    if (headingEl) {
      if (filters.search) headingEl.textContent = 'Results for "' + filters.search + '"';
      else if (filtersActive) headingEl.textContent = "Filtered Results";
      else headingEl.textContent = "New Arrivals";
    }

    try {
      if (currentMode === "ateliers") {
        const { data, error } = await fetchAteliers(filters.search);
        if (error) { grid.innerHTML = '<p style="text-align:center;padding:40px;">Error loading sellers.</p>'; return; }
        if (!data.length) {
          grid.innerHTML = "";
          if (filtersActive && emptyFilteredEl) emptyFilteredEl.style.display = "flex";
          else if (emptyEl) emptyEl.style.display = "flex";
          if (countEl) countEl.textContent = "";
          return;
        }
        if (countEl) countEl.textContent = data.length >= 1000 ? data.length + ' seller' + (data.length !== 1 ? "s" : "") : "";
        grid.innerHTML = data.map(p => renderAtelierCard(p)).join("");
      } else {
        const { data, error, count } = await fetchListings(filters);
        if (error) { grid.innerHTML = '<p style="text-align:center;padding:40px;">Error loading fabrics.</p>'; return; }
        if (!data.length) {
          grid.innerHTML = "";
          if (filtersActive && emptyFilteredEl) emptyFilteredEl.style.display = "flex";
          else if (emptyEl) emptyEl.style.display = "flex";
          if (countEl) countEl.textContent = "";
          return;
        }
        const profiles = await fetchProfilesForListings(data);
        const holdMap = await fetchCartHolds(data.map(l => l.id));
        const myCart = JSON.parse(localStorage.getItem('hm_cart') || '[]');
        const myCartIds = new Set(myCart.map(it => it.id || it.listing_id));
        const totalCount = count || data.length;
        if (countEl) countEl.textContent = totalCount >= 1000 ? totalCount + ' fabric' + (totalCount !== 1 ? "s" : "") : "";
        grid.innerHTML = data.map(l => renderListingCard(l, profiles[l.seller_id], holdMap, myCartIds)).join("");
        renderPagination(totalCount);
      }
      if (typeof window.renderAppliedFilters === 'function') window.renderAppliedFilters(runSearch);
    } catch (err) {
      console.error("Browse render error", err);
      grid.innerHTML = '<p style="text-align:center;padding:40px;">Something went wrong. Please refresh.</p>';
    }
  }

  /* ===== CLEAR ALL FILTERS ===== */
  window.clearAllFilters = function() {
    document.querySelectorAll('#contentBox input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#fabricTypeBox input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('#colorBox .sw').forEach(sw => sw.dataset.selected = 'false');
    selectedContents.clear();
    selectedColors.clear();
    selectedFabricTypes.clear();
    ['q', 'minPrice', 'maxPrice', 'minYards', 'minWidth', 'maxWidth', 'minGsm', 'maxGsm', 'designer'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    ['dept', 'fiberType', 'origin', 'feelsLike', 'burnTest', 'pattern', 'sortBy'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.selectedIndex = 0;
    });
    const cosplayFilter = document.getElementById('cosplayFilter');
    const cosplayHint = document.getElementById('cosplayHint');
    const cosplayLabel = document.getElementById('cosplayLabel');
    if (cosplayFilter) cosplayFilter.checked = false;
    if (cosplayHint) cosplayHint.style.display = 'none';
    if (cosplayLabel) { cosplayLabel.style.borderColor = 'var(--border)'; cosplayLabel.style.background = '#fff'; }
    runSearch();
  };

  window.runSearch = runSearch;

  /* ===== INITIALIZATION ===== */
  function init() {
    if (!getClient()) { console.warn('[browse.js] Waiting for Supabase...'); setTimeout(init, 100); return; }
    console.log('[browse.js] Initializing...');
    initFilters();
    runSearch('keepPage');
    window.addEventListener("filtersChanged", runSearch);
    window.addEventListener("popstate", function() { runSearch('keepPage'); });
  }

  window.HM = window.HM || {};
  window.HM.browse = { fetchListings, fetchAteliers, runSearch, CONTENTS, COLORS: COLORS.map(c => c.name), FABRIC_TYPES };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
