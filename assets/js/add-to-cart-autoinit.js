/* Hemline Market — Add-to-cart AUTO-INIT (Part 13, Step 2)
   File: assets/js/add-to-cart-autoinit.js
   Purpose:
     1) Ensure add-to-cart toast loader is present on any page.
     2) Inject an "Add to cart" button into each .card if missing.
     3) Buttons use [data-add-to-cart] so add-to-cart-toast.js binds automatically.

   Safe to include multiple times. No external deps.
*/

(function () {
  if (window.__HM_ADD_TO_CART_AUTOINIT__) return;
  window.__HM_ADD_TO_CART_AUTOINIT__ = true;

  // ---------- tiny utils ----------
  var d = document;
  var $ = function (s, ctx) { return (ctx || d).querySelector(s); };
  var $$ = function (s, ctx) { return Array.from((ctx || d).querySelectorAll(s)); };

  function injectCSS() {
    if ($('#hm-autoinit-style')) return;
    var css = `
      .hm-add-btn{
        display:inline-flex;align-items:center;gap:8px;padding:8px 12px;
        background:#111;color:#fff;border:1px solid #111;border-radius:12px;
        cursor:pointer;font:14px/1.2 system-ui,-apple-system,Segoe UI,Inter,sans-serif;
        transition:transform .12s ease, box-shadow .2s ease, background .2s ease;
      }
      .hm-add-btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.12);background:#0f1111}
      .hm-card-actions{margin-top:10px;display:flex;gap:10px;flex-wrap:wrap}
    `;
    var style = d.createElement('style');
    style.id = 'hm-autoinit-style';
    style.textContent = css;
    d.head.appendChild(style);
  }

  function loadToast(cb) {
    if (window.__HM_ADD_TO_CART_TOAST__) { cb && cb(); return; }
    var existing = $('#hm-toast-script');
    if (existing) { existing.addEventListener('load', cb); return; }
    var s = d.createElement('script');
    s.id = 'hm-toast-script';
    s.src = '/assets/js/add-to-cart-toast.js';
    s.defer = true;
    s.onload = function(){ cb && cb(); };
    d.head.appendChild(s);
  }

  function getItemName(card) {
    var t = $('.title', card) || $('h3', card) || $('h2', card) || $('.name', card);
    if (t && t.textContent) return t.textContent.trim();
    // Fallback to any first strong or the first line of text
    var s = $('strong', card);
    if (s && s.textContent) return s.textContent.trim();
    var raw = (card.textContent || '').trim().split('\n')[0];
    return raw || 'Item';
  }

  function ensureButtonForCard(card) {
    if (card.querySelector('[data-add-to-cart]')) return;               // already has one
    if (card.__hm_add_btn_injected) return;                             // avoid duplicate
    card.__hm_add_btn_injected = true;

    var name = getItemName(card);
    var actions = $('.hm-card-actions', card);
    if (!actions) {
      actions = d.createElement('div');
      actions.className = 'hm-card-actions';
      // place after price if possible, else at end
      var price = $('.price', card);
      if (price && price.parentNode) price.parentNode.insertBefore(actions, price.nextSibling);
      else card.appendChild(actions);
    }

    var btn = d.createElement('button');
    btn.className = 'hm-add-btn';
    btn.type = 'button';
    btn.setAttribute('data-add-to-cart', '');
    btn.setAttribute('data-item', name);
    btn.textContent = 'Add to cart';

    actions.appendChild(btn);
  }

  function scanAndInject() {
    injectCSS();
    $$('.card').forEach(ensureButtonForCard);
  }

  // Observe DOM for dynamically loaded cards
  var mo = new MutationObserver(function () { scanAndInject(); });
  mo.observe(d.documentElement, { childList: true, subtree: true });

  // Kickoff: load toast, then inject buttons
  if (d.readyState === 'loading') {
    d.addEventListener('DOMContentLoaded', function(){ loadToast(scanAndInject); });
  } else {
    loadToast(scanAndInject);
  }
})();
