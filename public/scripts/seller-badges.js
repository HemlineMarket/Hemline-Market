// File: public/scripts/seller-badges.js
// Utility for rendering seller badges across the site
// Include on: listing.html, atelier.html, threadtalk.html, browse.html, index.html

(function(){
  'use strict';

  /**
   * Generate badge HTML for a seller profile
   * @param {Object} profile - Profile object with badge fields
   * @param {Object} options - Options: { size: 'sm'|'md'|'lg', iconOnly: boolean, inline: boolean }
   * @returns {string} HTML string of badges
   */
  function renderBadges(profile, options = {}){
    if(!profile) return '';
    
    const { size = 'md', iconOnly = false, inline = false } = options;
    const badges = [];
    const sizeClass = size === 'sm' ? ' badge-sm' : '';
    const iconClass = iconOnly ? ' badge-icon-only' : '';
    
    // Founder badge (highest priority)
    if(profile.is_founder){
      badges.push(`<span class="badge-founder${sizeClass}${iconClass}">${iconOnly ? '' : 'Founder'}</span>`);
    }
    
    // Early seller badge
    if(profile.is_early_seller && profile.seller_number){
      const text = iconOnly ? '' : `OG Seller #${profile.seller_number}`;
      badges.push(`<span class="badge-early-seller${sizeClass}${iconClass}">${text}</span>`);
    }
    
    // Verified seller badge (only if not founder or early seller)
    if(profile.stripe_account_id && !profile.is_founder && !profile.is_early_seller){
      badges.push(`<span class="badge-verified${sizeClass}${iconClass}">${iconOnly ? '' : 'Verified'}</span>`);
    }
    
    if(badges.length === 0) return '';
    
    const containerClass = inline ? 'seller-badges-inline' : 'seller-badges';
    return `<span class="${containerClass}">${badges.join('')}</span>`;
  }

  /**
   * Create badge DOM elements
   * @param {Object} profile - Profile object with badge fields
   * @param {Object} options - Same as renderBadges
   * @returns {HTMLElement|null} Container element with badges, or null if no badges
   */
  function createBadgeElements(profile, options = {}){
    const html = renderBadges(profile, options);
    if(!html) return null;
    
    const wrapper = document.createElement('span');
    wrapper.innerHTML = html;
    return wrapper.firstElementChild;
  }

  /**
   * Insert badges after an element (like a name)
   * @param {HTMLElement} targetEl - Element to insert badges after
   * @param {Object} profile - Profile object
   * @param {Object} options - Badge options
   */
  function insertBadgesAfter(targetEl, profile, options = {}){
    if(!targetEl || !profile) return;
    
    // Remove existing badges first
    const existingBadges = targetEl.parentNode.querySelector('.seller-badges, .seller-badges-inline');
    if(existingBadges) existingBadges.remove();
    
    const badges = createBadgeElements(profile, { ...options, inline: true });
    if(badges){
      targetEl.insertAdjacentElement('afterend', badges);
    }
  }

  /**
   * Append badges inside an element
   * @param {HTMLElement} containerEl - Element to append badges to
   * @param {Object} profile - Profile object
   * @param {Object} options - Badge options
   */
  function appendBadges(containerEl, profile, options = {}){
    if(!containerEl || !profile) return;
    
    // Remove existing badges first
    const existingBadges = containerEl.querySelector('.seller-badges, .seller-badges-inline');
    if(existingBadges) existingBadges.remove();
    
    const badges = createBadgeElements(profile, options);
    if(badges){
      containerEl.appendChild(badges);
    }
  }

  /**
   * Batch render badges for multiple profiles
   * Useful for listing grids where you have multiple sellers
   * @param {Map|Object} profileMap - Map of seller_id -> profile
   * @param {string} selector - CSS selector for elements with data-seller-id
   * @param {Object} options - Badge options
   */
  function renderBadgesForElements(profileMap, selector, options = {}){
    const elements = document.querySelectorAll(selector);
    
    elements.forEach(el => {
      const sellerId = el.dataset.sellerId;
      if(!sellerId) return;
      
      const profile = profileMap instanceof Map 
        ? profileMap.get(sellerId) 
        : profileMap[sellerId];
      
      if(profile){
        appendBadges(el, profile, options);
      }
    });
  }

  /**
   * Fetch badge data for multiple seller IDs
   * @param {string[]} sellerIds - Array of seller IDs
   * @returns {Promise<Map<string, Object>>} Map of seller_id -> profile with badge fields
   */
  async function fetchBadgeData(sellerIds){
    const results = new Map();
    
    if(!sellerIds || !sellerIds.length) return results;
    
    const supabase = window.__hm_supabase || window.supabase_client || (window.HM && window.HM.supabase);
    if(!supabase){
      console.warn("[seller-badges] No supabase client available");
      return results;
    }

    try {
      const uniqueIds = [...new Set(sellerIds)];
      
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, is_founder, is_early_seller, seller_number, stripe_account_id")
        .in("id", uniqueIds);

      if(error){
        console.warn("[seller-badges] Fetch error:", error);
        return results;
      }

      (profiles || []).forEach(profile => {
        results.set(profile.id, profile);
      });

      return results;
    } catch(e){
      console.error("[seller-badges] Exception:", e);
      return results;
    }
  }

  // Export to window
  window.HM = window.HM || {};
  window.HM.badges = {
    render: renderBadges,
    create: createBadgeElements,
    insertAfter: insertBadgesAfter,
    append: appendBadges,
    renderForElements: renderBadgesForElements,
    fetchData: fetchBadgeData
  };

})();
