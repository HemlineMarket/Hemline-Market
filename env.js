// env.js — also injects Filters Bar on /listings.html so we can see it working.

(function () {
  // --- your existing env vars (keep/edit these if you already had values here) ---
  window.SUPABASE_URL = window.SUPABASE_URL || "";   // <-- keep as-is if already set elsewhere
  window.SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || ""; // <-- keep as-is if already set elsewhere

  // --- only run UI injection on the listings page ---
  var path = (location.pathname || "").toLowerCase();
  if (!(path.endsWith("/listings.html") || path === "/listings.html")) return;

  // --- big visible banner so we know THIS FILE is live ---
  var banner = document.createElement("div");
  banner.textContent = "TEST BANNER — injected from env.js";
  banner.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;background:#1d4ed8;color:#fff;padding:10px 14px;font:14px system-ui;text-align:center";
  document.addEventListener("DOMContentLoaded", function(){ document.body.appendChild(banner); });

  // --- filters bar styles ---
  var css =
`.filters-wrap{position:sticky;top:56px;z-index:15;background:#fff;border-bottom:1px solid #e5e7eb}
.filters{max-width:1100px;margin:0 auto;padding:10px 16px;display:grid;gap:8px;grid-template-columns:repeat(6,minmax(0,1fr))}
.filters select,.filters input,.filters button{width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;background:#fff}
.filters .search{grid-column:span 2}
@media (max-width:900px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}.filters .search{grid-column:span 2}}`;
  var s = document.createElement("style");
  s.appendChild(document.createTextNode(css));
  (document.head || document.documentElement).appendChild(s);

  // --- insert filters bar right after the header ---
  function addFilters() {
    if (document.getElementById("hm-filters-bar")) return;
    var wrap = document.createElement("div");
    wrap.className = "filters-wrap";
    wrap.id = "hm-filters-bar";
    wrap.innerHTML = `
      <div class="filters" id="filters">
        <select id="f-fabric"><option value="">Fabric</option><option>Cotton</option><option>Wool</option><option>Linen</option><option>Silk</option><option>Knit</option><option>Terry/Fleece</option></select>
        <select id="f-weight"><option value="">Weight</option><option>Light</option><option>Mid</option><option>Heavy</option></select>
        <select id="f-color"><option value="">Color</option><option>Black</option><option>White</option><option>Brown</option><option>Blue</option><option>Green</option><option>Red</option><option>Yellow</option><option>Pink</option><option>Purple</option></select>
        <select id="f-seller"><option value="">Seller</option></select>
        <select id="f-sort"><option value="">Sort</option><option value="newest">Newest</option><option value="priceLow">Price: Low → High</option><option value="priceHigh">Price: High → Low</option></select>
        <input id="f-search" class="search" type="search" placeholder="Search fabrics…">
        <button id="f-reset" type="button">Reset</button>
      </div>`;
    var header = document.querySelector("header");
    if (header && header.parentNode) header.parentNode.insertBefore(wrap, header.nextSibling);
    else document.body.insertBefore(wrap, document.body.firstChild);

    // wire up events (broadcast to the app)
    var $ = function(id){ return document.getElementById(id); };
    var inputs = ["f-fabric","f-weight","f-color","f-seller","f-sort","f-search"].map($);
    function emit(){
      var detail = {
        fabric: $("f-fabric").value || null,
        weight: $("f-weight").value || null,
        color: $("f-color").value || null,
        seller: $("f-seller").value || null,
        sort: $("f-sort").value || null,
        q: $("f-search").value.trim() || null
      };
      document.dispatchEvent(new CustomEvent("hemline:filters",{ detail: detail }));
    }
    inputs.forEach(function(el){ el.addEventListener("input", emit); });
    $("f-reset").addEventListener("click", function(){
      inputs.forEach(function(el){ if (el.tagName === "INPUT") el.value = ""; else el.selectedIndex = 0; });
      emit();
    });
    emit();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addFilters);
  } else {
    addFilters();
  }
})();
