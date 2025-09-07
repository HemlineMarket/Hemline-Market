/* public/assets/add-to-cart.js
   One script for Browse + Listing.
   It saves the right fields so shipping tiers work: amount (cents), perYd (dollars), yards, qty.
   It looks for data-* attributes on the clicked button first, and has gentle fallbacks.
*/

(function(){
  const KEY = 'hm_cart';

  // Small toast so users see feedback
  function toast(msg){
    try{
      let t = document.getElementById('hm_toast');
      if(!t){
        t = document.createElement('div');
        t.id = 'hm_toast';
        t.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#111827;color:#fff;padding:10px 14px;border-radius:10px;z-index:9999;box-shadow:0 6px 16px rgba(0,0,0,.25);font:600 14px system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial';
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.style.opacity = '1';
      clearTimeout(t._hide);
      t._hide = setTimeout(()=>{ t.style.opacity = '0'; }, 1400);
    }catch(_){}
  }

  function readCart(){ try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch(_){return[]} }
  function writeCart(arr){ localStorage.setItem(KEY, JSON.stringify(arr)); if(window.HM_CART_BADGE_UPDATE) window.HM_CART_BADGE_UPDATE(arr); }

  // Helpers
  const num = v => parseFloat(String(v ?? '').replace(/[^\d.]/g,'')) || 0;
  const cents = d => Math.round(Number(d||0) * 100);

  // Try to infer missing values from nearby DOM if not provided via data-attrs
  function inferFromDom(btn){
    // yards: look for <input name="yards"> or data-field="yards"
    let yards = 0;
    const yardsInput = btn.closest('[data-item]')?.querySelector('input[name="yards"], [data-field="yards"]') ||
                       document.querySelector('input[name="yards"], [data-field="yards"]');
    if (yardsInput) yards = num(yardsInput.value || yardsInput.getAttribute('value'));

    // price per yard: look for [data-price] or text like $18.50/yd near the button
    let perYd = 0;
    const priceEl = btn.closest('[data-item]')?.querySelector('[data-price], .price, [data-per-yd]') ||
                    document.querySelector('[data-per-yd], [data-price], .price');
    if (priceEl){
      perYd = num(priceEl.getAttribute('data-per-yd') || priceEl.getAttribute('data-price') || priceEl.textContent);
    }
    return { yards, perYd };
  }

  function buildItemFromButton(btn){
    // Primary source: data-* attributes on the button
    const id    = btn.dataset.id    || ('sku-' + Date.now());
    const name  = btn.dataset.name  || btn.getAttribute('aria-label') || 'Fabric';
    const photo = btn.dataset.photo || '';
    const sellerId   = btn.dataset.sellerId   || btn.dataset.sellerid   || '';
    const sellerName = btn.dataset.sellerName || btn.dataset.sellername || '';

    // Pricing/qty/yards (prefer data-attrs; fall back to DOM inference)
    let perYd = num(btn.dataset.price || btn.dataset.perYd);
    let yards = num(btn.dataset.yards);

    if (!perYd || !yards){
      const inferred = inferFromDom(btn);
      perYd = perYd || inferred.perYd;
      yards = yards || inferred.yards;
    }

    // Defaults that make shipping sane: if we still don't know yards, assume 1; if no price, assume 1
    if (!yards) yards = 1;
    if (!perYd) perYd = 1;

    // qty: line-item quantity (not yards). Most product cards use qty=1 per click.
    const qty = num(btn.dataset.qty) || 1;

    // amount is "unit price" in cents (your cart multiplies amount * qty)
    const amount = cents(perYd);

    return {
      id, name, photo,
      qty,                 // line item quantity (usually 1)
      yards,               // yards per line (drives shipping tiers)
      perYd,               // dollars per yard (display/backup calc)
      amount,              // cents per unit (cart uses amount * qty)
      ...(sellerId ? {sellerId} : {}),
      ...(sellerName ? {sellerName} : {})
    };
  }

  function onClick(e){
    const btn = e.target.closest('[data-action="add-to-cart"], .add-to-cart');
    if(!btn) return;

    // Prevent navigation (e.g., cards wrapped in <a>)
    e.preventDefault();
    e.stopPropagation();

    const cart = readCart();
    const item = buildItemFromButton(btn);

    // Merge behavior: if same id + same seller, bump qty; else push new line
    const key = (it) => `${it.id}::${it.sellerId||''}`;
    const idx = cart.findIndex(it => key(it) === key(item));
    if (idx >= 0){
      cart[idx].qty = Number(cart[idx].qty||1) + Number(item.qty||1);
      // If seller adds more of same fabric, optionally add yards too if your UX expects that:
      if (item.yards) cart[idx].yards = num(cart[idx].yards) + num(item.yards);
    } else {
      cart.push(item);
    }

    writeCart(cart);
    toast('Added to cart');

    // Optional: stay on page. If you prefer to go to cart, uncomment:
    // window.location.href = 'cart.html';
  }

  // Attach one delegated listener for whole document
  document.addEventListener('click', onClick, true);
})();
