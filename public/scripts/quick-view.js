// File: /public/scripts/quick-view.js
// Quick View modal for listing cards on browse and home pages
// Shows fabric details in an overlay without leaving the page
(function() {
  'use strict';
  console.log('[quick-view] Script loaded');

  // Supabase client getter - matches browse.js / home.js pattern
  let supabaseClient = null;
  function getClient() {
    if (supabaseClient) return supabaseClient;
    if (typeof window.getSupabaseClient === 'function') {
      supabaseClient = window.getSupabaseClient();
      if (supabaseClient) return supabaseClient;
    }
    if (window.HM && window.HM.supabase) {
      supabaseClient = window.HM.supabase;
      return supabaseClient;
    }
    if (window.HM_SUPABASE_URL && window.HM_SUPABASE_ANON_KEY && window.supabase?.createClient) {
      supabaseClient = window.supabase.createClient(window.HM_SUPABASE_URL, window.HM_SUPABASE_ANON_KEY);
      return supabaseClient;
    }
    if (window.supabase?.createClient) {
      supabaseClient = window.supabase.createClient(
        "https://clkizksbvxjkoatdajgd.supabase.co",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI"
      );
      return supabaseClient;
    }
    return null;
  }

  // Inject styles once
  const style = document.createElement('style');
  style.textContent = `
    /* Quick View trigger button */
    .qv-trigger {
      position: absolute;
      bottom: 8px;
      right: 8px;
      z-index: 3;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(0,0,0,0.08);
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease;
      pointer-events: none;
    }
    .qv-trigger svg {
      width: 18px;
      height: 18px;
      color: #374151;
    }
    .listing-card:hover .qv-trigger,
    .listing-card:focus-within .qv-trigger {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }
    .qv-trigger:hover {
      background: #fff;
      box-shadow: 0 4px 12px rgba(0,0,0,0.18);
    }
    /* Mobile: always show */
    @media (max-width: 768px) {
      .qv-trigger {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
        width: 30px;
        height: 30px;
      }
      .qv-trigger svg {
        width: 16px;
        height: 16px;
      }
    }

    /* Overlay */
    .qv-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0,0,0,0.5);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    .qv-overlay.qv-active {
      opacity: 1;
    }

    /* Modal panel */
    .qv-modal {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.25);
      max-width: 780px;
      width: 100%;
      max-height: 90vh;
      overflow: hidden;
      display: flex;
      flex-direction: row;
      transform: scale(0.95) translateY(10px);
      transition: transform 0.2s ease;
    }
    .qv-overlay.qv-active .qv-modal {
      transform: scale(1) translateY(0);
    }
    @media (max-width: 640px) {
      .qv-modal {
        flex-direction: column;
        max-height: 92vh;
      }
    }

    /* Image side */
    .qv-image-col {
      flex: 0 0 45%;
      min-height: 280px;
      background: #f3f4f6;
      position: relative;
      overflow: hidden;
    }
    .qv-image-col img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .qv-image-nav {
      position: absolute;
      bottom: 10px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
    }
    .qv-image-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255,255,255,0.5);
      border: 1px solid rgba(0,0,0,0.15);
      cursor: pointer;
      transition: background 0.15s;
    }
    .qv-image-dot.active {
      background: #fff;
    }
    .qv-img-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: rgba(255,255,255,0.85);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: #374151;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
      z-index: 2;
    }
    .qv-img-arrow:hover { background: #fff; }
    .qv-img-arrow.qv-prev { left: 8px; }
    .qv-img-arrow.qv-next { right: 8px; }
    @media (max-width: 640px) {
      .qv-image-col {
        flex: 0 0 auto;
        min-height: 220px;
        max-height: 300px;
      }
    }

    /* Details side */
    .qv-details {
      flex: 1;
      padding: 20px 22px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .qv-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(0,0,0,0.06);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      color: #6b7280;
      z-index: 2;
      transition: background 0.15s;
    }
    .qv-close:hover { background: rgba(0,0,0,0.1); color: #111; }

    .qv-title {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      line-height: 1.3;
      padding-right: 36px;
    }
    .qv-price-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
    }
    .qv-price {
      font-size: 20px;
      font-weight: 700;
      color: #111827;
    }
    .qv-price-per {
      font-size: 14px;
      color: #6b7280;
    }
    .qv-price-orig {
      font-size: 14px;
      color: #9ca3af;
      text-decoration: line-through;
    }
    .qv-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .qv-tag {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #f3f4f6;
      color: #4b5563;
      font-weight: 500;
    }
    .qv-specs {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      font-size: 13px;
    }
    .qv-spec-label {
      color: #9ca3af;
      font-weight: 500;
    }
    .qv-spec-val {
      color: #374151;
    }
    .qv-desc {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 4;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .qv-actions {
      display: flex;
      gap: 8px;
      margin-top: auto;
      padding-top: 8px;
    }
    .qv-btn-primary {
      flex: 1;
      padding: 10px 16px;
      border-radius: 8px;
      background: #7f1d1d;
      color: #fff;
      font-weight: 600;
      font-size: 14px;
      border: none;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      display: block;
      transition: background 0.15s;
    }
    .qv-btn-primary:hover { background: #991b1b; }
    .qv-btn-secondary {
      padding: 10px 16px;
      border-radius: 8px;
      background: #f3f4f6;
      color: #374151;
      font-weight: 600;
      font-size: 14px;
      border: none;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      transition: background 0.15s;
    }
    .qv-btn-secondary:hover { background: #e5e7eb; }
    .qv-seller {
      font-size: 12px;
      color: #9ca3af;
    }
    .qv-seller a {
      color: #7f1d1d;
      text-decoration: none;
      font-weight: 600;
    }
    .qv-seller a:hover { text-decoration: underline; }
    .qv-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      color: #9ca3af;
      font-size: 14px;
    }
  `;
  document.head.appendChild(style);

  // Eye icon SVG
  const eyeSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

  // Attach quick view buttons to listing cards via event delegation
  function injectButtons() {
    const cards = document.querySelectorAll('.listing-card');
    console.log('[quick-view] injectButtons called, found', cards.length, 'cards');
    cards.forEach(function(card) {
      if (card.dataset.qvInjected) return;
      card.dataset.qvInjected = '1';

      // Find the listing link to get the ID
      const link = card.querySelector('a[href*="listing.html?id="]');
      if (!link) { console.log('[quick-view] No listing link found in card'); return; }
      const match = link.href.match(/[?&]id=([^&]+)/);
      if (!match) { console.log('[quick-view] No id in link:', link.href); return; }
      const listingId = decodeURIComponent(match[1]);

      // Find the thumbnail container
      const thumb = card.querySelector('.listing-thumb');
      if (!thumb) { console.log('[quick-view] No .listing-thumb in card'); return; }

      const btn = document.createElement('button');
      btn.className = 'qv-trigger';
      btn.setAttribute('aria-label', 'Quick view');
      btn.setAttribute('title', 'Quick view');
      btn.innerHTML = eyeSvg;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        openQuickView(listingId);
      });
      thumb.appendChild(btn);
      console.log('[quick-view] Injected button for listing:', listingId);
    });
  }

  // Observe the DOM for new cards (pagination, lazy load)
  const observer = new MutationObserver(function() {
    injectButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Also run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButtons);
  } else {
    setTimeout(injectButtons, 200);
  }

  // Image gallery state
  let currentImages = [];
  let currentImageIndex = 0;

  async function openQuickView(listingId) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'qv-overlay';
    overlay.innerHTML = '<div class="qv-modal" style="position:relative;"><div class="qv-loading">Loading...</div></div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Animate in
    requestAnimationFrame(function() {
      overlay.classList.add('qv-active');
    });

    // Close handlers
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeQuickView(overlay);
    });
    function onKey(e) {
      if (e.key === 'Escape') closeQuickView(overlay);
      if (e.key === 'ArrowLeft') navigateImage(-1);
      if (e.key === 'ArrowRight') navigateImage(1);
    }
    document.addEventListener('keydown', onKey);
    overlay._onKey = onKey;

    // Fetch listing data
    const client = getClient();
    if (!client) {
      overlay.querySelector('.qv-loading').textContent = 'Could not load listing.';
      return;
    }

    const { data, error } = await client.from('listings').select('*').eq('id', listingId).single();
    if (error || !data) {
      overlay.querySelector('.qv-loading').textContent = 'Could not load listing.';
      return;
    }

    // Fetch seller profile
    let seller = null;
    if (data.seller_id) {
      const res = await client.from('profiles').select('*').eq('id', data.seller_id).single();
      if (res.data) seller = res.data;
    }

    renderQuickView(overlay, data, seller);
  }

  function closeQuickView(overlay) {
    if (overlay._onKey) document.removeEventListener('keydown', overlay._onKey);
    overlay.classList.remove('qv-active');
    document.body.style.overflow = '';
    setTimeout(function() { overlay.remove(); }, 200);
  }

  function navigateImage(dir) {
    if (currentImages.length <= 1) return;
    currentImageIndex = (currentImageIndex + dir + currentImages.length) % currentImages.length;
    const img = document.querySelector('.qv-image-col img');
    if (img) img.src = currentImages[currentImageIndex];
    document.querySelectorAll('.qv-image-dot').forEach(function(dot, i) {
      dot.classList.toggle('active', i === currentImageIndex);
    });
  }

  function renderQuickView(overlay, listing, seller) {
    const modal = overlay.querySelector('.qv-modal');

    // Gather images
    currentImages = [
      listing.image_url_1, listing.image_url_2, listing.image_url_3,
      listing.image_url_4, listing.image_url_5
    ].filter(Boolean);
    if (listing.image_urls && Array.isArray(listing.image_urls)) {
      listing.image_urls.forEach(function(u) {
        if (u && !currentImages.includes(u)) currentImages.push(u);
      });
    }
    if (!currentImages.length) currentImages = ['/images/empty-state.svg'];
    currentImageIndex = 0;

    // Price
    const priceCents = listing.price_cents != null ? Number(listing.price_cents) : null;
    const priceFromField = listing.price != null ? Number(listing.price) : null;
    const cents = priceCents != null ? priceCents : (priceFromField != null ? Math.round(priceFromField * 100) : null);
    const pricePerYd = cents != null ? (cents / 100).toFixed(2) : null;
    const yards = listing.yards_available;
    const totalCents = (cents != null && yards) ? cents * yards : null;
    const total = totalCents != null ? (totalCents / 100).toFixed(2) : null;
    const origCents = listing.orig_price_cents != null ? Number(listing.orig_price_cents) : null;
    const origPerYd = origCents != null ? (origCents / 100).toFixed(2) : null;
    const hasDiscount = origCents != null && cents != null && origCents > cents;
    const isCutToOrder = listing.sell_by_yard === true;

    // Tags
    const tags = [];
    if (listing.color) listing.color.split(',').forEach(function(c) { if (c.trim()) tags.push(c.trim()); });
    if (listing.fabric_type) tags.push(listing.fabric_type);
    if (listing.pattern && listing.pattern !== 'Solid') tags.push(listing.pattern);
    if (listing.department) tags.push(listing.department);

    // Specs
    const specs = [];
    if (listing.content && listing.content !== 'Not sure') specs.push(['Fiber Content', listing.content]);
    if (listing.fabric_type) specs.push(['Fabric Type', listing.fabric_type]);
    if (listing.width_in) specs.push(['Width', listing.width_in + '"']);
    if (listing.weight_gsm) specs.push(['Weight', listing.weight_gsm + ' GSM']);
    if (listing.fiber_type) specs.push(['Fiber Category', listing.fiber_type]);
    if (listing.origin || listing.country_of_origin) specs.push(['Origin', listing.origin || listing.country_of_origin]);
    if (listing.designer) specs.push(['Designer / Mill', listing.designer]);

    // Seller info
    const sellerName = seller?.store_name || seller?.display_name || [seller?.first_name, seller?.last_name].filter(Boolean).join(' ') || 'Seller';
    const sellerHref = seller ? '/seller/index.html?id=' + seller.id : '#';

    const href = 'listing.html?id=' + encodeURIComponent(listing.id);

    // Image nav dots
    const dotsHtml = currentImages.length > 1
      ? '<div class="qv-image-nav">' + currentImages.map(function(_, i) {
          return '<span class="qv-image-dot' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '"></span>';
        }).join('') + '</div>'
      : '';

    const arrowsHtml = currentImages.length > 1
      ? '<button class="qv-img-arrow qv-prev" aria-label="Previous image">&#8249;</button><button class="qv-img-arrow qv-next" aria-label="Next image">&#8250;</button>'
      : '';

    // Price row
    let priceHtml = '';
    if (total && pricePerYd && !isCutToOrder) {
      priceHtml = '<span class="qv-price">$' + total + '</span><span class="qv-price-per">$' + pricePerYd + '/yd for ' + yards + ' yds</span>';
    } else if (pricePerYd) {
      priceHtml = '<span class="qv-price">$' + pricePerYd + '/yd</span>';
      if (yards) priceHtml += '<span class="qv-price-per">' + yards + ' yds available</span>';
    }
    if (hasDiscount && origPerYd) {
      priceHtml += '<span class="qv-price-orig">$' + origPerYd + '/yd</span>';
    }

    // Specs HTML
    const specsHtml = specs.length
      ? '<div class="qv-specs">' + specs.map(function(s) {
          return '<span class="qv-spec-label">' + s[0] + '</span><span class="qv-spec-val">' + s[1] + '</span>';
        }).join('') + '</div>'
      : '';

    // Tags HTML
    const tagsHtml = tags.length
      ? '<div class="qv-tags">' + tags.map(function(t) { return '<span class="qv-tag">' + t + '</span>'; }).join('') + '</div>'
      : '';

    // CTA
    let ctaHtml;
    const isSold = (listing.status || '').toLowerCase() === 'sold' || !yards || yards <= 0;
    if (isSold) {
      ctaHtml = '<button class="qv-btn-primary" disabled style="opacity:0.5;cursor:not-allowed;">Sold out</button>';
    } else if (isCutToOrder) {
      ctaHtml = '<a href="' + href + '" class="qv-btn-primary">Choose yardage</a>';
    } else {
      ctaHtml = '<a href="' + href + '" class="qv-btn-primary">View full listing</a>';
    }

    modal.innerHTML = `
      <div class="qv-image-col">
        <img src="${currentImages[0]}" alt="${(listing.title || '').replace(/"/g, '&quot;')}" />
        ${arrowsHtml}
        ${dotsHtml}
      </div>
      <div class="qv-details">
        <button class="qv-close" aria-label="Close quick view">&times;</button>
        <div class="qv-title">${listing.title || 'Untitled'}</div>
        <div class="qv-price-row">${priceHtml}</div>
        ${tagsHtml}
        ${specsHtml}
        ${listing.description ? '<div class="qv-desc">' + listing.description + '</div>' : ''}
        <div class="qv-seller">Sold by <a href="${sellerHref}">${sellerName}</a></div>
        <div class="qv-actions">
          ${ctaHtml}
          <a href="${href}" class="qv-btn-secondary">Full details</a>
        </div>
      </div>
    `;

    // Wire up close button
    modal.querySelector('.qv-close').addEventListener('click', function() {
      closeQuickView(overlay);
    });

    // Wire up image navigation
    const prevBtn = modal.querySelector('.qv-prev');
    const nextBtn = modal.querySelector('.qv-next');
    if (prevBtn) prevBtn.addEventListener('click', function() { navigateImage(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function() { navigateImage(1); });
    modal.querySelectorAll('.qv-image-dot').forEach(function(dot) {
      dot.addEventListener('click', function() {
        currentImageIndex = parseInt(this.dataset.idx, 10);
        const img = modal.querySelector('.qv-image-col img');
        if (img) img.src = currentImages[currentImageIndex];
        modal.querySelectorAll('.qv-image-dot').forEach(function(d, i) {
          d.classList.toggle('active', i === currentImageIndex);
        });
      });
    });
  }

})();
