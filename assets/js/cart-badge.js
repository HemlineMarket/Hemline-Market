/* Hemline Market — Header cart badge
   File: assets/js/cart-badge.js
   Purpose: ensure a visible #cart-count badge exists in the header on any page.
            Safe to include multiple times. No deps.
*/
(function () {
  if (window.__HM_CART_BADGE__) return;
  window.__HM_CART_BADGE__ = true;

  var d = document;
  function $(s, c){ return (c||d).querySelector(s); }

  // Inject minimal CSS once
  if (!$('#hm-cart-badge-style')) {
    var css = `
      .hm-cart-link{position:relative;display:inline-flex;align-items:center;gap:6px}
      #cart-count{
        min-width:18px;height:18px; padding:0 5px;
        display:inline-grid;place-items:center;
        background:#111;color:#fff;border-radius:9px;
        font:12px/1 system-ui,-apple-system,Segoe UI,Inter,sans-serif;
        transform:translateY(0); transition:transform .2s ease;
      }
      #cart-count.hm-bump{ transform:translateY(-2px); }
    `;
    var s = d.createElement('style');
    s.id = 'hm-cart-badge-style';
    s.textContent = css;
    d.head.appendChild(s);
  }

  // Ensure a container link exists (re-usable for navs that don’t have one)
  function ensureCartLink(){
    var nav = d.querySelector('nav') || d.querySelector('header') || d.body;
    var link = d.querySelector('.hm-cart-link');
    if (!link) {
      link = d.createElement('a');
      link.href = '/cart.html';
      link.className = 'hm-cart-link';
      link.innerHTML = `<span>Cart</span> <span id="cart-count">0</span>`;
      // Append near “Profile” or “List an item” if found, else to the end of nav
      var profile = Array.from(nav.querySelectorAll('a,button')).find(el => /profile/i.test(el.textContent||''));
      if (profile && profile.parentNode) profile.parentNode.insertBefore(link, profile.nextSibling);
      else nav.appendChild(link);
    }
    return link;
  }

  function ensureBadge(){
    var link = ensureCartLink();
    var badge = $('#cart-count', link);
    if (!badge) {
      badge = d.createElement('span');
      badge.id = 'cart-count';
      badge.textContent = '0';
      link.appendChild(badge);
    }
    return badge;
  }

  // Expose helper so other scripts can bump reliably
  window.HMBadge = {
    get(){ return ensureBadge(); },
    set(n){
      var b = ensureBadge();
      b.textContent = String(Math.max(0, n|0));
      b.classList.add('hm-bump'); setTimeout(()=>b.classList.remove('hm-bump'), 300);
    },
    inc(delta){
      var b = ensureBadge();
      var v = parseInt(b.textContent||'0',10) || 0;
      this.set(v + (delta||1));
    }
  };

  // Initialize on load
  ensureBadge();
})();
