<!-- FILE: assets/js/add-to-cart-toast.js -->
<script>
// Hemline Market — Part 13.1 Add-to-Cart Toast (self-contained, no edits needed)
(function () {
  if (window.HM_ADD_TO_CART_TOAST) return; // prevent double-load
  window.HM_ADD_TO_CART_TOAST = true;

  function ensureStyles() {
    if (document.getElementById('hm-toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'hm-toast-styles';
    style.textContent = `
:root{--hm-bg:#111827;--hm-fg:#fff;--hm-border:#e5e7eb;}
.hm-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
  background:var(--hm-bg);color:var(--hm-fg);border:1px solid var(--hm-border);
  padding:12px 16px;border-radius:14px;box-shadow:0 10px 24px rgba(0,0,0,.2);
  display:flex;align-items:center;gap:10px;font:14px/1.35 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;
  z-index:2147483647;opacity:0;transform-origin:50% 100%;}
.hm-toast-enter{animation:hm-in .22s ease-out forwards}
.hm-toast-leave{animation:hm-out .20s ease-in forwards}
.hm-check{width:18px;height:18px;flex:0 0 18px}
@keyframes hm-in{from{opacity:0;transform:translateX(-50%) translateY(6px) scale(.98)}
to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
@keyframes hm-out{from{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}
to{opacity:0;transform:translateX(-50%) translateY(6px) scale(.98)}}
@media (prefers-reduced-motion: reduce){.hm-toast-enter,.hm-toast-leave{animation:none}}
`;
    document.head.appendChild(style);
  }

  function showToast(text) {
    ensureStyles();
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = 'hm-toast hm-toast-enter';
    el.innerHTML =
      '<svg class="hm-check" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2Zm-1.2 13.6-3.5-3.5 1.4-1.4 2.1 2.1 4.7-4.7 1.4 1.4-6.1 6.1z"/></svg>' +
      '<span>'+ (text || 'Added to cart') +'</span>';
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.remove('hm-toast-enter');
      el.classList.add('hm-toast-leave');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, 1600);
  }

  function labelFrom(el){
    return el?.getAttribute?.('data-item-name')
        || el?.getAttribute?.('aria-label')
        || el?.getAttribute?.('data-name')
        || (el?.textContent||'').trim();
  }

  // Non-invasive: just listens and shows toast when an Add-to-Cart UI is clicked
  document.addEventListener('click', function(e){
    const btn = e.target.closest('button, a, input[type=button], input[type=submit]');
    if (!btn) return;
    const matches = btn.matches('[data-add-to-cart], .add-to-cart, .hm-add-to-cart, [name="add-to-cart"], [aria-label*="add to cart" i]');
    const looksLike = /add\s*(to)?\s*cart/i.test(btn.textContent||'');
    if (matches || looksLike){
      const name = labelFrom(btn);
      showToast(name ? ('Added to cart — ' + name) : 'Added to cart');
    }
  }, true);

  // Built-in test helper: visit any page with ?hmtest=1 and tap the floating button
  try {
    if (location.search.includes('hmtest=1')) {
      const t = document.createElement('button');
      t.textContent = 'Test Add';
      t.style.cssText = 'position:fixed;right:16px;bottom:16px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;color:#111827;z-index:2147483646';
      t.addEventListener('click', () => showToast('Added to cart — Test Fabric'));
      document.body.appendChild(t);
    }
  } catch (_) {}
})();
</script>
