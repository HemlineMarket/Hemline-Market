// Hemline Market — shared hamburger behavior for all pages
(function () {
  function whenReady(fn){
    if(document.readyState!=='loading'){fn();}
    else{document.addEventListener('DOMContentLoaded',fn);}
  }

  whenReady(function(){
    const openBtn  = document.getElementById('openMenu') || document.querySelector('.hamburger');
    const sheet    = document.getElementById('menuSheet');
    const closeBtn = document.getElementById('closeMenu');
    let overlay    = document.getElementById('sheetOverlay');

    // stop if header elements don't exist on this page
    if (!openBtn || !sheet) return;

    // create overlay if missing
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sheetOverlay';
      overlay.setAttribute('aria-hidden','true');
      document.body.appendChild(overlay);
    }

    function lockScroll(lock){ document.body.style.overflow = lock ? 'hidden' : ''; }

    function openMenu(){
      sheet.classList.add('open');
      sheet.setAttribute('aria-hidden','false');
      overlay.classList.add('show');
      overlay.setAttribute('aria-hidden','false');
      openBtn.setAttribute('aria-expanded','true');
      lockScroll(true);
    }

    function closeMenu(){
      sheet.classList.remove('open');
      sheet.setAttribute('aria-hidden','true');
      overlay.classList.remove('show');
      overlay.setAttribute('aria-hidden','true');
      openBtn.setAttribute('aria-expanded','false');
      lockScroll(false);
    }

    openBtn.addEventListener('click', e => { e.preventDefault(); openMenu(); });
    if (closeBtn) closeBtn.addEventListener('click', e => { e.preventDefault(); closeMenu(); });
    overlay.addEventListener('click', closeMenu);
    document.addEventListener('keydown', e => { if(e.key === 'Escape') closeMenu(); });
  });
})();
