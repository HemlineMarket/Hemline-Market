// Hemline Market — Universal Header + Footer + Menu + Session Logic
window.HM = window.HM || {};

(function () {
  const SUPABASE_URL =
    "https://clkizksbvxjkoatdajgd.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

  /* --------------------------------------------------------------------------
     HEADER HTML
  -------------------------------------------------------------------------- */
  function headerHTML() {
    return `
<header class="hm-header" role="banner">
  <div class="wrap">
    <a class="hm-brand" href="index.html">Hemline Market</a>

    <div class="right">
      <a class="hm-icon" href="browse.html" aria-label="Browse &amp; search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="M21 21l-4.3-4.3"></path>
        </svg>
      </a>

      <a class="hm-icon" href="ThreadTalk.html" aria-label="ThreadTalk">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M4 6.5A4.5 4.5 0 0 1 8.5 2h7A4.5 4.5 0 0 1 20 6.5v5A4.5 4.5 0 0 1 15.5 16H12l-4 4v-4H8.5A4.5 4.5 0 0 1 4 11.5z"></path>
        </svg>
      </a>

      <a class="hm-icon" href="favorites.html" aria-label="Favorites">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"></path>
        </svg>
      </a>

      <a class="hm-icon" href="notifications.html" aria-label="Notifications">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
      </a>

      <a class="hm-icon" href="cart.html" aria-label="Cart">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="9"  cy="21" r="1"></circle>
          <circle cx="18" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h7.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
      </a>

      <a class="hm-icon hm-account is-logged-out"
        id="headerAccountLink"
        href="auth.html?view=login"
        aria-label="Sign in or manage your account">
        <span class="hm-account-badge" id="headerAccountBadge"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="8" r="3.2"></circle>
          <path d="M5 19c1.4-3 5-4.5 7-4.5s5.6 1.5 7 4.5"></path>
        </svg>
      </a>

      <button class="hamburger" id="openMenu" type="button"
        aria-label="Open menu" aria-controls="menuSheet" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="6"  x2="20" y2="6"></line>
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="18" x2="20" y2="18"></line>
        </svg>
      </button>

      <a class="hm-btn-primary" href="sell.html">Sell</a>
    </div>
  </div>
</header>

<div id="sheetOverlay" aria-hidden="true"></div>

<aside class="sheet" id="menuSheet" aria-hidden="true" role="dialog" aria-modal="true">
  <header>
    <strong>Menu</strong>
    <button class="close" id="closeMenu" aria-label="Close menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>
  </header>
  <nav>
    <a href="account.html">Account</a>
    <a href="atelier.html">My Atelier</a>
    <a href="how.html">How It Works</a>
    <a href="sell.html">Sell Fabric</a>
    <a href="ThreadTalk.html">ThreadTalk</a>
    <a href="contact.html">Contact</a>
  </nav>
</aside>
`;
  }

  /* --------------------------------------------------------------------------
     FOOTER HTML
  -------------------------------------------------------------------------- */
  function footerHTML(currentPage) {
    function active(p) {
      return currentPage === p ? ' aria-current="page"' : "";
    }

    return `
<footer class="hm-footer" role="contentinfo">
  <div class="footer-wrap">
    <div class="copy">© 2025 Hemline Market</div>
    <nav class="footer-links" aria-label="Footer">
      <a href="about.html"${active("about")}>About</a>
      <a href="faq.html"${active("faq")}>FAQ</a>
      <a href="contact.html"${active("contact")}>Contact</a>
      <a href="terms.html"${active("terms")}>Terms</a>
      <a href="privacy.html"${active("privacy")}>Privacy</a>
    </nav>
  </div>
</footer>`;
  }

  /* --------------------------------------------------------------------------
     MENU INTERACTION
  -------------------------------------------------------------------------- */
  function wireMenu() {
    const sheet = document.getElementById("menuSheet");
    const openBtn = document.getElementById("openMenu");
    const closeBtn = document.getElementById("closeMenu");
    const overlay = document.getElementById("sheetOverlay");

    if (!sheet || !openBtn || !closeBtn || !overlay) return;

    function lockScroll(lock) {
      document.body.style.overflow = lock ? "hidden" : "";
    }

    function openSheet() {
      sheet.classList.add("open");
      overlay.classList.add("show");
      sheet.setAttribute("aria-hidden", "false");
      overlay.setAttribute("aria-hidden", "false");
      openBtn.setAttribute("aria-expanded", "true");
      lockScroll(true);
    }

    function closeSheet() {
      sheet.classList.remove("open");
      overlay.classList.remove("show");
      sheet.setAttribute("aria-hidden", "true");
      overlay.setAttribute("aria-hidden", "true");
      openBtn.setAttribute("aria-expanded", "false");
      lockScroll(false);
    }

    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openSheet();
    });
    closeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeSheet();
    });
    overlay.addEventListener("click", closeSheet);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSheet();
    });
  }

  /* --------------------------------------------------------------------------
     SUPABASE SESSION
  -------------------------------------------------------------------------- */
  function wireSupabaseSession() {
    if (!window.supabase) return;

    const client = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );

    // expose client so account page and others can reuse it
    window.HM.supabase = client;

    const accountLink = document.getElementById("headerAccountLink");
    if (!accountLink) return;

    function apply(session) {
      if (session && session.user) {
        accountLink.href = "account.html";
        accountLink.classList.add("is-logged-in");
        accountLink.classList.remove("is-logged-out");
      } else {
        accountLink.href = "auth.html?view=login";
        accountLink.classList.remove("is-logged-in");
        accountLink.classList.add("is-logged-out");
      }
    }

    client.auth.getSession().then(({ data }) => {
      apply(data.session);
    });

    client.auth.onAuthStateChange((_event, session) => {
      apply(session);
    });
  }

  /* --------------------------------------------------------------------------
     PUBLIC API
  -------------------------------------------------------------------------- */
  window.HM.renderShell = function renderShell(opts) {
    const current = opts?.currentPage || "";

    const headerTarget = document.getElementById("hm-shell-header");
    const footerTarget = document.getElementById("hm-shell-footer");

    if (headerTarget) headerTarget.innerHTML = headerHTML();
    if (footerTarget) footerTarget.innerHTML = footerHTML(current);

    wireMenu();
    wireSupabaseSession();
  };
})();
