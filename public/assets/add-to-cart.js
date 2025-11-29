/* public/assets/add-to-cart.js
   One script for Browse + Listing.
   It saves the right fields so shipping tiers work: amount (cents), perYd (dollars), yards, qty.
   It looks for data-* attributes on the clicked button first, and has gentle fallbacks.
*/

(function(){
  const KEY = 'hm_cart';

  // --- MAGICAL HAPPY POPUP -------------------------------------------------------

  function createPopup(){
    let overlay = document.getElementById('hm_cart_popup');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'hm_cart_popup';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(15,23,42,0.55)',
      'z-index:9999',
      'opacity:0',
      'pointer-events:none',
      'transition:opacity .18s ease-out'
    ].join(';');

    const card = document.createElement('div');
    card.style.cssText = [
      'background:#ffffff',
      'border-radius:20px',
      'padding:18px 20px 16px',
      'max-width:340px',
      'width:90%',
      'box-shadow:0 22px 60px rgba(0,0,0,.38)',
      'font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif',
      'color:#111827'
    ].join(';');

    card.innerHTML = [
      '<div style="display:flex;align-items:flex-start;gap:12px;">',
        '<div style="width:28px;height:28px;border-radius:999px;background:#ecfdf5;display:flex;align-items:center;justify-content:center;border:1px solid #6ee7b7;">',
          '<span style="font-size:16px;">✓</span>',
        '</div>',
        '<div style="flex:1;">',
          '<div data-role="title" style="font-weight:700;font-size:15px;margin-bottom:2px;">Added to your cart</div>',
          '<div data-role="message" style="font-size:13px;color:#4b5563;"></div>',
        '</div>',
      '</div>',
      '<div style="display:flex;gap:8px;margin-top:14px;">',
        '<button type="button" data-role="view-cart" style="flex:1;border-radius:999px;border:0;background:#111827;color:#fff;font-size:13px;font-weight:600;padding:8px 10px;cursor:pointer;">View cart</button>',
        '<button type="button" data-role="keep-shopping" style="flex:1;border-radius:999px;border:1px solid #d1d5db;background:#fff;color:#374151;font-size:13px;font-weight:500;padding:8px 10px;cursor:pointer;">Keep browsing</button>',
      '</div>'
    ].join('');

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const titleEl = card.querySelector('[data-role="title"]');
    const msgEl   = card.querySelector('[data-role="message"]');
    const viewBtn = card.querySelector('[data-role="view-cart"]');
    const keepBtn = card.querySelector('[data-role="keep-shopping"]');

    function hide(){
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
    }

    viewBtn.addEventListener('click', ()=>{
      hide();
      window.location.href = 'cart.html';
    });
    keepBtn.addEventListener('click', hide);
    overlay.addEventListener('click', e=>{
      if (e.target === overlay) hide();
    });

    overlay._titleEl = titleEl;
    overlay._msgEl   = msgEl;
    overlay._hide    = hide;

    return overlay;
  }

  // This replaces the old tiny bottom toast.
  function toast(message){
    try{
      const overlay = createPopup();
      overlay._titleEl.textContent = 'Added to your cart';
      overlay._msgEl.textContent   = message;
      overlay.style.opacity = '1';
      overlay.style.pointerEvents = 'auto';

      clearTimeout(overlay._timer);
      overlay._timer = setTimeout(()=>{
        overlay._hide();
      }, 2600);
    }catch(_){}
  }

  // --- CART STORAGE HELPERS ------------------------------------------------------

  function readCart(){
    try{
      return JSON.parse(localStorage.getItem(KEY) || '[]');
    }catch(_){
      return [];
    }
  }

  function writeCart(arr){
    const list = arr || [];
    localStorage.setItem(KEY, JSON.stringify(list));
    // Let the universal header decide how to show the cart state
    if (window.HM_CART_BADGE_UPDATE){
      try{ window.HM_CART_BADGE_UPDATE(list); }catch(_){}
    }
  }

  // Helpers
  const num   = v => parseFloat(String(v ?? '').replace(/[^\d.]/g,'')) || 0;
  const cents = d => Math.round(Number(d || 0) * 100);

  // Try to infer missing values from nearby DOM if not provided via data-attrs
  function inferFromDom(btn){
    const root = btn.closest('[data-item]') || btn.closest('article') || document;

    // yards: look for <input name="yards"> or data-field="yards"
    let yards = 0;
    const yardsInput =
      root.querySelector('input[name="yards"], [data-field="yards"]') ||
      document.querySelector('input[name="yards"], [data-field="yards"]');
    if (yardsInput){
      yards = num(yardsInput.value || yardsInput.getAttribute('value'));
    }

    // price per yard: look for [data-price] or text like $18.50/yd near the button
    let perYd = 0;
    const priceEl =
      root.querySelector('[data-price], .price, [data-per-yd]') ||
      document.querySelector('[data-per-yd], [data-price], .price');
    if (priceEl){
      perYd = num(
        priceEl.getAttribute('data-per-yd') ||
        priceEl.getAttribute('data-price') ||
        priceEl.textContent
      );
    }

    return { yards, perYd };
  }

  // Infer options (size/color/etc.) from data-attrs and nearby selects/inputs
  function inferOptions(btn){
    const root = btn.closest('[data-item]') || btn.closest('article') || document;

    let color = btn.dataset.color || '';
    let size  = btn.dataset.size  || '';
    let optionLabel = btn.dataset.optionLabel || btn.dataset.optionlabel || '';

    if (!color){
      const colorEl =
        root.querySelector('[data-field="color"], select[name="color"], [name="color"]') ||
        document.querySelector('[data-field="color"], select[name="color"], [name="color"]');
      if (colorEl){
        color = colorEl.value || colorEl.textContent || colorEl.getAttribute('data-value') || '';
      }
    }

    if (!size){
      const sizeEl =
        root.querySelector('[data-field="size"], select[name="size"], [name="size"]') ||
        document.querySelector('[data-field="size"], select[name="size"], [name="size"]');
      if (sizeEl){
        size = sizeEl.value || sizeEl.textContent || sizeEl.getAttribute('data-value') || '';
      }
    }

    if (!optionLabel){
      const optEl =
        root.querySelector('[data-field="option"], [data-option-label], select[name="option"], [name="option"]') ||
        document.querySelector('[data-field="option"], [data-option-label], select[name="option"], [name="option"]');
      if (optEl){
        optionLabel =
          optEl.getAttribute('data-option-label') ||
          optEl.getAttribute('data-label') ||
          optEl.value ||
          optEl.textContent ||
          '';
      }
    }

    const options = [];
    if (color) options.push(color);
    if (size)  options.push('Size ' + size);
    if (optionLabel) options.push(optionLabel);

    return { color, size, optionLabel, options };
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

    // Options: color/size/etc. for cart display
    const opts = inferOptions(btn);

    return {
      id,
      name,
      photo,
      qty,                 // line item quantity (usually 1)
      yards,               // yards per line (drives shipping tiers)
      perYd,               // dollars per yard (display/backup calc)
      amount,              // cents per unit (cart uses amount * qty)
      ...(sellerId ? { sellerId } : {}),
      ...(sellerName ? { sellerName } : {}),
      ...(opts.color ? { color: opts.color } : {}),
      ...(opts.size ? { size: opts.size } : {}),
      ...(opts.optionLabel ? { optionLabel: opts.optionLabel } : {}),
      ...(opts.options && opts.options.length ? { options: opts.options } : {})
    };
  }

  // --- CLICK HANDLER -------------------------------------------------------------

  function onClick(e){
    const btn = e.target.closest('[data-action="add-to-cart"], .add-to-cart');
    if(!btn) return;

    // Prevent navigation (e.g., cards wrapped in <a>)
    e.preventDefault();
    e.stopPropagation();

    const cart = readCart();
    const item = buildItemFromButton(btn);

    // Merge behavior: if same id + same seller, bump qty; else push new line
    const key = (it) => `${it.id}::${it.sellerId || ''}`;
    const idx = cart.findIndex(it => key(it) === key(item));
    if (idx >= 0){
      cart[idx].qty = Number(cart[idx].qty || 1) + Number(item.qty || 1);
      if (item.yards) cart[idx].yards = num(cart[idx].yards) + num(item.yards);
    } else {
      cart.push(item);
    }

    writeCart(cart);

    const totalItems = cart.reduce((sum, it) => sum + (Number(it.qty) || 1), 0);
    const baseName   = item.name || 'item';
    const msg = totalItems === 1
      ? `“${baseName}” is in your cart.`
      : `“${baseName}” is in your cart — ${totalItems} items total.`;

    toast(msg);
  }

  // Attach one delegated listener for whole document
  document.addEventListener('click', onClick, true);

  // Ensure header reflects cart state on initial load
  try{
    const initialCart = readCart();
    writeCart(initialCart);
  }catch(_){}
})();
