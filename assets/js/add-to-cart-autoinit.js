// assets/js/add-to-cart-autoinit.js
(function(){
  // Ensure the toast system exists
  function ensureToastUI(){
    let box = document.getElementById('hm-toast');
    if (!box){
      box = document.createElement('div');
      box.id = 'hm-toast';
      box.style.cssText = `
        position:fixed;left:50%;bottom:24px;
        transform:translateX(-50%);
        padding:12px 16px;
        border:1px solid #e5e7eb;
        border-radius:12px;
        background:#111827;color:#fff;
        font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        box-shadow:0 2px 8px rgba(0,0,0,0.2);
        display:none;z-index:9999;
      `;
      document.body.appendChild(box);
    }
    return box;
  }

  // Show toast message
  function showToast(msg){
    const box = ensureToastUI();
    box.textContent = msg;
    box.style.display = 'block';
    setTimeout(()=>{ box.style.display = 'none'; }, 2500);
  }

  // Attach to add-to-cart buttons
  function attachAddToCart(){
    document.querySelectorAll('[data-addtocart]').forEach(btn=>{
      if (!btn._hmBound){
        btn._hmBound = true;
        btn.addEventListener('click', e=>{
          e.preventDefault();
          showToast("Added to cart 🧵");
        });
      }
    });
  }

  // Observe DOM changes to rebind dynamically
  const obs = new MutationObserver(attachAddToCart);
  obs.observe(document.body, {childList:true,subtree:true});

  // Initial attach
  attachAddToCart();
})();
