/* Hemline Market — Add-to-cart toast (simple)
   File: assets/js/add-to-cart-toast.js
   Shows a small confirmation toast on any [data-add-to-cart] click.
   No Undo. No badge updates. No cart mutations. Purely visual.
*/

(function () {
  if (window.__HM_SIMPLE_TOAST__) return;
  window.__HM_SIMPLE_TOAST__ = true;

  // ---------- CSS ----------
  var CSS = `
  .hm-toast-host{position:fixed;left:0;right:0;bottom:24px;display:flex;justify-content:center;pointer-events:none;z-index:9999}
  .hm-toast{
    display:flex;align-items:center;gap:10px;pointer-events:auto;
    background:#111;color:#fff;border:1px solid rgba(255,255,255,.06);
    padding:12px 14px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.18);
    font:14px/1.2 system-ui,-apple-system,Segoe UI,Inter,sans-serif;
    transform:translateY(20px) scale(.97);opacity:0;
    transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .28s;
  }
  .hm-toast.show{transform:translateY(0) scale(1);opacity:1}
  .hm-toast .icon{
    width:22px;height:22px;border-radius:999px;display:grid;place-items:center;background:#16a34a
  }
  .hm-toast .icon svg{width:14px;height:14px;fill:#fff}
  `;
  var style = document.createElement('style');
  style.id = 'hm-simple-toast-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  // ---------- host ----------
  var host = document.createElement('div');
  host.className = 'hm-toast-host';
  document.body.appendChild(host);

  // ---------- utils ----------
  function qs(sel, ctx){ return (ctx||document).querySelector(sel); }
  function nameFrom(btn){
    var explicit = btn.getAttribute('data-item');
    if (explicit) return explicit.trim();
    var card = btn.closest('.card') || btn.closest('[data-card]');
    var title = card && (qs('.title',card)||qs('h3',card)||qs('h2',card));
    return (title && title.textContent.trim()) || (btn.textContent||'Item').trim();
  }

  function showToast(msg){
    var box = document.createElement('div');
    box.className = 'hm-toast';
    box.setAttribute('role','status');
    box.setAttribute('aria-live','polite');
    box.innerHTML = `
      <div class="icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
      </div>
      <div class="msg">${String(msg||'Added to cart').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
    `;
    host.appendChild(box);
    requestAnimationFrame(function(){ box.classList.add('show'); });
    setTimeout(function(){
      box.classList.remove('show');
      setTimeout(function(){ box.remove(); }, 220);
    }, 2000);
  }

  // Expose minimal API for other scripts (optional)
  window.HMToast = { show: showToast };

  // ---------- bind to buttons (visual only) ----------
  function bind(){
    var triggers = Array.from(document.querySelectorAll('[data-add-to-cart]'));
    triggers.forEach(function(btn){
      if (btn.__hm_toast_bound) return;
      btn.__hm_toast_bound = true;
      btn.addEventListener('click', function(){
        var n = nameFrom(btn);
        showToast(n + ' added to cart');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once:true });
  } else {
    bind();
  }
  var mo = new MutationObserver(bind);
  mo.observe(document.documentElement, { childList:true, subtree:true });
})();
