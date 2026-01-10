// Hemline Market — Universal Header + Footer + Menu + Session + Cart + Notifications
// FIXED VERSION - Fixes profile photo persisting across accounts
window.HM = window.HM || {};

(function () {
  // Inject hm-mobile.css if not already present
  if (!document.querySelector('link[href*="hm-mobile.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'styles/hm-mobile.css';
    document.head.appendChild(link);
  }

  const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

  let shellSupabase = null;

  function headerHTML() {
    return `
<header class="hm-header" role="banner">
  <div class="wrap">
    <a class="hm-brand" href="index.html">
      <img src="/images/logo.png" alt="" class="hm-brand-logo">
      <span class="hm-brand-text"><span>Hemline</span><span>Market</span></span>
    </a>

    <form class="hm-header-search" action="browse.html" method="get" role="search">
      <select name="type" class="hm-header-search-type" id="headerSearchType">
        <option value="fabrics">Fabrics</option>
        <option value="sellers">Sellers</option>
      </select>
      <div class="hm-header-search-input-wrap">
        <svg class="hm-header-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="M21 21l-4.3-4.3"></path>
        </svg>
        <input 
          type="search" 
          name="q" 
          class="hm-header-search-input" 
          id="headerSearchInput"
          placeholder="Search fabrics..."
        />
      </div>
      <button type="submit" class="hm-header-search-btn" aria-label="Search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="M21 21l-4.3-4.3"></path>
        </svg>
      </button>
    </form>

    <div class="right">
      <a class="hm-header-link" href="ThreadTalk.html" title="Community Forum">
        <svg class="hm-header-link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          <path d="M8 9h8M8 13h6"></path>
        </svg>
        <span class="hm-header-link-text">Forum</span>
      </a>

      <a class="hm-icon hm-search-link" href="browse.html" aria-label="Search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="M21 21l-4.3-4.3"></path>
        </svg>
      </a>

      <a class="hm-icon" href="cart.html" aria-label="Cart" data-hm-cart-link>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="18" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h7.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
      </a>

      <a class="hm-icon hm-account is-logged-out"
        id="headerAccountLink"
        href="auth.html?view=login"
        aria-label="Sign in or manage your account">
        <span class="hm-account-badge" id="headerAccountBadge"></span>
        <span class="hm-avatar" id="headerAvatar"></span>
        <svg class="hm-account-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="8" r="3.2"></circle>
          <path d="M5 19c1.4-3 4.99-4.5 7-4.5s5.6 1.5 7 4.5"></path>
        </svg>
      </a>

      <span class="hm-menu-icon" id="openMenu" role="button" tabindex="0"
        aria-label="Open menu" aria-controls="menuSheet" aria-expanded="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
          <line x1="4" y1="6"  x2="20" y2="6"></line>
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="18" x2="20" y2="18"></line>
        </svg>
      </span>

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
  <nav class="menu-nav-with-descriptions">
    <a href="browse.html">
      <span class="menu-item-title">Browse</span>
      <span class="menu-item-desc">Search fabrics and sellers</span>
    </a>
    <a href="account.html">
      <span class="menu-item-title">Account</span>
      <span class="menu-item-desc">Your profile, settings, and order history</span>
    </a>
    <a href="atelier.html">
      <span class="menu-item-title">My Atelier</span>
      <span class="menu-item-desc">Your store and all your listings</span>
    </a>
    <a href="favorites.html">
      <span class="menu-item-title">Favorites</span>
      <span class="menu-item-desc">Fabrics you've saved for later</span>
    </a>
    <a href="messages.html">
      <span class="menu-item-title">Messages</span>
      <span class="menu-item-desc">Chat with buyers and sellers</span>
    </a>
    <a href="notifications.html">
      <span class="menu-item-title">Notifications</span>
      <span class="menu-item-desc">Order updates, messages, and alerts</span>
    </a>
    <a href="how.html">
      <span class="menu-item-title">How It Works</span>
      <span class="menu-item-desc">Learn about buying and selling</span>
    </a>
    <a href="sell.html">
      <span class="menu-item-title">Sell Fabric</span>
      <span class="menu-item-desc">List your fabric for sale</span>
    </a>
    <a href="ThreadTalk.html">
      <span class="menu-item-title">ThreadTalk</span>
      <span class="menu-item-desc">Community forum for sewists</span>
    </a>
  </nav>
  <div class="menu-divider"></div>
  <nav class="menu-nav-simple">
    <a href="about.html">About</a>
    <a href="faq.html">FAQ</a>
    <a href="contact.html">Contact</a>
    <a href="terms.html">Terms</a>
    <a href="privacy.html">Privacy</a>
  </nav>
  <div class="menu-footer">© 2025 Hemline Market</div>
</aside>
`;
  }

  function footerHTML(currentPage) {
    // Hide footer on infinite-scroll pages - links are in hamburger menu
    const noFooterPages = ["home", "index", "browse", "threadtalk", "showcase", "cosplay", "stitch-school", "fabric-sos", "before-after", "pattern-hacks", "tailoring", "loose-threads"];
    if (noFooterPages.includes(currentPage?.toLowerCase())) {
      return "";
    }

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
    
    // Dynamic search placeholder based on type selection
    const searchType = document.getElementById("headerSearchType");
    const searchInput = document.getElementById("headerSearchInput");
    if (searchType && searchInput) {
      searchType.addEventListener("change", function() {
        searchInput.placeholder = searchType.value === "sellers"
          ? "Search by store or seller name"
          : "Search fabrics...";
      });
    }
  }

  function getNotificationsElements() {
    const link =
      document.querySelector(".hm-notifications-icon") ||
      document.querySelector('a[aria-label="Notifications"]');
    if (!link) return { link: null, dot: null };

    let dot = link.querySelector(".hm-notifications-dot");
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "hm-notifications-dot";
      link.appendChild(dot);
    }

    if (!dot.style.width) {
      dot.style.position = "absolute";
      dot.style.top = "4px";
      dot.style.right = "4px";
      dot.style.width = "8px";
      dot.style.height = "8px";
      dot.style.borderRadius = "999px";
      dot.style.background = "#b91c1c";
      dot.style.boxShadow = "0 0 0 2px #fef2f2";
      dot.style.display = "none";
    }

    const computed = window.getComputedStyle(link);
    if (computed.position === "static") {
      link.style.position = "relative";
    }

    return { link, dot };
  }

  async function refreshNotificationsBell(session) {
    const { link, dot } = getNotificationsElements();
    if (!link || !dot) return;

    if (!session || !session.user || !shellSupabase) {
      dot.style.display = "none";
      link.setAttribute("aria-label", "Notifications");
      return;
    }

    try {
      const uid = session.user.id;

      const { data, error } = await shellSupabase
        .from("notifications")
        .select("id")
        .eq("user_id", uid)
        .is("read_at", null)
        .limit(1);

      if (error) {
        dot.style.display = "none";
        link.setAttribute("aria-label", "Notifications");
        return;
      }

      const hasUnread = Array.isArray(data) && data.length > 0;

      if (hasUnread) {
        dot.style.display = "block";
        link.setAttribute("aria-label", "Notifications (new)");
      } else {
        dot.style.display = "none";
        link.setAttribute("aria-label", "Notifications");
      }
    } catch (_) {}
  }

  function wireSupabaseSession() {
    // Use a single shared client across all pages to avoid session conflicts
    if (window.supabase_client) {
      shellSupabase = window.supabase_client;
    } else if (window.HM && window.HM.supabase) {
      shellSupabase = window.HM.supabase;
    } else if (window.supabase) {
      shellSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    } else {
      return;
    }
    
    // Store globally so all pages share the same client
    window.supabase_client = shellSupabase;
    window.HM.supabase = shellSupabase;

    const accountLink = document.getElementById("headerAccountLink");
    const accountBadge = document.getElementById("headerAccountBadge");
    const headerAvatar = document.getElementById("headerAvatar");

    async function applyAccount(session) {
      if (session && session.user) {
        accountLink.href = "account.html";
        accountLink.classList.add("is-logged-in");
        accountLink.classList.remove("is-logged-out");

        // Show a small dot when logged in
        if (accountBadge) {
          accountBadge.style.display = "inline-block";
          accountBadge.style.width = "8px";
          accountBadge.style.height = "8px";
          accountBadge.style.borderRadius = "999px";
          accountBadge.style.backgroundColor = "#15803d";
        }

        // Load avatar from localStorage - FIX: Only use user-specific key
        if (headerAvatar) {
          // FIX: Only check user-specific key, not the global 'avatarUrl' key
          const avatarUrl = localStorage.getItem(`hm-avatar-${session.user.id}`);
          
          if (avatarUrl) {
            headerAvatar.style.backgroundImage = `url(${avatarUrl})`;
            headerAvatar.textContent = "";
            accountLink.classList.add("has-avatar");
          } else {
            // Clear any existing avatar (in case of account switch)
            headerAvatar.style.backgroundImage = "";
            headerAvatar.textContent = "";
            accountLink.classList.remove("has-avatar");
            
            // Try to get profile for initials
            try {
              const { data: profile } = await shellSupabase
                .from("profiles")
                .select("display_name, avatar_url")
                .eq("id", session.user.id)
                .single();
              
              // Check if profile has avatar_url from database
              if (profile && profile.avatar_url) {
                headerAvatar.style.backgroundImage = `url(${profile.avatar_url})`;
                headerAvatar.textContent = "";
                accountLink.classList.add("has-avatar");
                // Cache it for next time
                localStorage.setItem(`hm-avatar-${session.user.id}`, profile.avatar_url);
              } else if (profile && profile.display_name) {
                const initials = profile.display_name
                  .split(" ")
                  .map(n => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);
                headerAvatar.textContent = initials;
                accountLink.classList.add("has-avatar");
              }
            } catch (_) {}
          }
        }
      } else {
        accountLink.href = "auth.html?view=login";
        accountLink.classList.remove("is-logged-in");
        accountLink.classList.remove("has-avatar");
        accountLink.classList.add("is-logged-out");
        if (accountBadge) {
          accountBadge.style.display = "none";
        }
        if (headerAvatar) {
          headerAvatar.style.backgroundImage = "";
          headerAvatar.textContent = "";
        }
      }
    }

    function handleSession(session) {
      applyAccount(session);
      refreshNotificationsBell(session);
    }

    shellSupabase.auth.getSession().then(({ data }) => {
      handleSession(data.session);
    });

    shellSupabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });
  }

  // ------------------------------------------------------------
  // CART STATE
  // ------------------------------------------------------------
  function updateCartState(cart) {
    try {
      const list = Array.isArray(cart) ? cart : [];
      const hasItems = list.length > 0;

      if (document.body) {
        document.body.setAttribute(
          "data-cart",
          hasItems ? "has-items" : "empty"
        );
      }

      const cartLink =
        document.querySelector("[data-hm-cart-link]") ||
        document.querySelector('a[href$="cart.html"]');
      if (!cartLink) return;

      const oldBadge = cartLink.querySelector(".hm-cart-badge");
      if (oldBadge && oldBadge.parentNode) {
        oldBadge.parentNode.removeChild(oldBadge);
      }

      let dot = cartLink.querySelector(".hm-cart-dot");
      if (!dot) {
        dot = document.createElement("span");
        dot.className = "hm-cart-dot";
        dot.style.cssText = [
          "position:absolute",
          "top:6px",
          "right:6px",
          "width:8px",
          "height:8px",
          "border-radius:999px",
          "background:#b91c1c",
          "box-shadow:0 0 0 2px #fef2f2",
          "display:none"
        ].join(";");
        const style = window.getComputedStyle(cartLink);
        if (style.position === "static") {
          cartLink.style.position = "relative";
        }
        cartLink.appendChild(dot);
      }

      if (hasItems) {
        dot.style.display = "block";
        cartLink.classList.add("has-items");
        cartLink.setAttribute("aria-label", "Cart (has items)");
      } else {
        dot.style.display = "none";
        cartLink.classList.remove("has-items");
        cartLink.setAttribute("aria-label", "Cart (empty)");
      }
    } catch (_) {}
  }

  window.HM_CART_BADGE_UPDATE = function (cart) {
    updateCartState(cart || []);
  };

  function syncCartStateFromStorage() {
    try {
      const raw = localStorage.getItem("hm_cart");
      const arr = raw ? JSON.parse(raw) : [];
      if (window.HM_CART_BADGE_UPDATE) {
        window.HM_CART_BADGE_UPDATE(arr);
      }
    } catch (_) {}
  }

  // Listen for cart updates from other scripts
  window.addEventListener("hm:cart-updated", syncCartStateFromStorage);
  
  // Listen for storage changes (from other tabs)
  window.addEventListener("storage", (e) => {
    if (e.key === "hm_cart") {
      syncCartStateFromStorage();
    }
  });

  // ------------------------------------------------------------
  // PUBLIC API
  // ------------------------------------------------------------
  window.HM.renderShell = function renderShell(opts) {
    const current = opts?.currentPage || "";

    const headerTarget = document.getElementById("hm-shell-header");
    const footerTarget = document.getElementById("hm-shell-footer");

    if (headerTarget) headerTarget.innerHTML = headerHTML();
    if (footerTarget) footerTarget.innerHTML = footerHTML(current);

    wireMenu();
    wireSupabaseSession();
    syncCartStateFromStorage();
  };
  
  // FIX: Add function to refresh notifications bell on demand
  window.HM.refreshNotificationsBell = function() {
    if (shellSupabase) {
      shellSupabase.auth.getSession().then(({ data }) => {
        refreshNotificationsBell(data.session);
      });
    }
  };
})();
