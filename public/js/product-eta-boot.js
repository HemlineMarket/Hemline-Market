// public/js/product-eta-boot.js
// Purpose: On a product page, fetch the listing by ID with anon Supabase,
// read seller_id + shipping fields, then mount the reusable ETA widget.
// Usage later on listing pages (separate step):
//   <div id="etaMount"></div>
//   <script src="/js/eta-widget.js"></script>
//   <script src="/js/product-eta-boot.js"></script>
//   <script>ProductEtaBoot.init({ mountId: 'etaMount' });</script>

(function () {
  const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

  function qs(name) {
    const m = new URLSearchParams(location.search).get(name);
    return m ? String(m) : null;
  }

  function mountError(mount, msg) {
    if (!mount) return;
    mount.textContent = msg;
    mount.style.color = "#b91c1c";
    mount.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
  }

  async function fetchListing(listingId) {
    const url = `${SUPABASE_URL.replace(/\/+$/,"")}/rest/v1/listings?id=eq.${encodeURIComponent(listingId)}&select=*`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error((data && data.message) || resp.statusText);
    if (!Array.isArray(data) || !data.length) return null;
    return data[0];
  }

  const ProductEtaBoot = {
    /**
     * init({ mountId, listingId? })
     * - mountId: element to mount into (e.g., 'etaMount')
     * - listingId: optional; if omitted, reads from URL ?id=...
     */
    async init({ mountId, listingId }) {
      const mount = document.getElementById(mountId);
      if (!mount) return;

      const id = listingId || qs("id");
      if (!id) return mountError(mount, "— (no listing id)");

      // Show a lightweight placeholder
      mount.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
      mount.style.fontSize = "14px";
      mount.style.padding = "8px";
      mount.style.border = "1px dashed #d1d5db";
      mount.style.borderRadius = "8px";
      mount.style.background = "#f9fafb";
      mount.textContent = "Calculating delivery window…";

      try {
        const row = await fetchListing(id);
        if (!row) return mountError(mount, "— (listing not found)");

        const required = ["seller_id", "weight_oz", "handling_days_min", "handling_days_max"];
        for (const k of required) {
          if (row[k] == null || row[k] === "") {
            return mountError(mount, `— (missing ${k} on listing)`);
          }
        }

        // Prepare mount attrs for widget
        mount.setAttribute("data-seller-id", row.seller_id);
        mount.setAttribute("data-weight-oz", String(row.weight_oz));
        mount.setAttribute("data-handling-min", String(row.handling_days_min));
        mount.setAttribute("data-handling-max", String(row.handling_days_max));
        if (row.length_in != null) mount.setAttribute("data-length-in", String(row.length_in));
        if (row.width_in  != null) mount.setAttribute("data-width-in",  String(row.width_in));
        if (row.height_in != null) mount.setAttribute("data-height-in", String(row.height_in));

        // Ensure widget is present
        if (!window.EtaWidget || typeof window.EtaWidget.init !== "function") {
          return mountError(mount, "— (eta-widget.js not loaded)");
        }

        // Mount the widget
        window.EtaWidget.init({ mountId });
      } catch (err) {
        return mountError(mount, "— (ETA error)");
      }
    }
  };

  window.ProductEtaBoot = ProductEtaBoot;
})();
