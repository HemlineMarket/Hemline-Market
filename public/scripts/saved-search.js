// File: /public/scripts/saved-search.js
// Adds "Save this search" button to browse page
(function() {
  'use strict';

  function init() {
    // Only run on browse page
    if (!window.location.pathname.includes('browse')) return;

    var topbar = document.querySelector('.topbar');
    if (!topbar) return;

    // Create the save search button
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.id = 'saveSearchBtn';
    saveBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg><span>Save search</span>';
    saveBtn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:9px 14px;border-radius:10px;border:1px solid #991b1b;background:#fff;color:#991b1b;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;';

    // Insert after the Hide filters button
    var hideFiltersBtn = document.getElementById('toggleFilters');
    if (hideFiltersBtn && hideFiltersBtn.parentNode) {
      hideFiltersBtn.parentNode.insertBefore(saveBtn, hideFiltersBtn.nextSibling);
    } else {
      topbar.appendChild(saveBtn);
    }

    saveBtn.addEventListener('click', handleSaveSearch);
  }

  async function handleSaveSearch() {
    // Wait for HM.supabase
    var supabase = window.HM ? window.HM.supabase : null;
    if (!supabase) {
      showToast('Please wait for the page to load', 'error');
      return;
    }

    // Check if user is signed in
    var result = await supabase.auth.getSession();
    var session = result.data.session;
    if (!session || !session.user) {
      showToast('Please sign in to save searches', 'error');
      setTimeout(function() {
        window.location.href = 'auth.html?view=login&redirect=' + encodeURIComponent(window.location.href);
      }, 1500);
      return;
    }

    // Gather current filters
    var filters = gatherCurrentFilters();

    // Check if any filters are active
    var hasFilters = Object.keys(filters).some(function(key) {
      var val = filters[key];
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === 'string') return val.trim().length > 0;
      return val != null;
    });

    if (!hasFilters) {
      showToast('Add some filters first, then save your search', 'info');
      return;
    }

    // Save the search
    try {
      var res = await fetch('/api/saved-searches/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ filters: filters })
      });

      var data = await res.json();

      if (!res.ok) {
        showToast(data.message || data.error || 'Failed to save search', 'error');
        return;
      }

      showToast('Search saved! Manage it in Favorites → Saved Searches', 'success');

    } catch (e) {
      console.error('Error saving search:', e);
      showToast('Failed to save search. Please try again.', 'error');
    }
  }

  function gatherCurrentFilters() {
    var filters = {};

    // Text search
    var qInput = document.getElementById('q');
    if (qInput && qInput.value && qInput.value.trim()) {
      filters.q = qInput.value.trim();
    }

    // Price range
    var minPrice = document.getElementById('minPrice');
    var maxPrice = document.getElementById('maxPrice');
    if (minPrice && minPrice.value) filters.minPrice = Number(minPrice.value);
    if (maxPrice && maxPrice.value) filters.maxPrice = Number(maxPrice.value);

    // Yards
    var minYards = document.getElementById('minYards');
    if (minYards && minYards.value) filters.minYards = Number(minYards.value);

    // Width
    var minWidth = document.getElementById('minWidth');
    var maxWidth = document.getElementById('maxWidth');
    if (minWidth && minWidth.value) filters.minWidth = Number(minWidth.value);
    if (maxWidth && maxWidth.value) filters.maxWidth = Number(maxWidth.value);

    // GSM
    var minGsm = document.getElementById('minGsm');
    var maxGsm = document.getElementById('maxGsm');
    if (minGsm && minGsm.value) filters.minGsm = Number(minGsm.value);
    if (maxGsm && maxGsm.value) filters.maxGsm = Number(maxGsm.value);

    // Dropdowns
    var dept = document.getElementById('dept');
    if (dept && dept.value) filters.dept = dept.value;

    var fiberType = document.getElementById('fiberType');
    if (fiberType && fiberType.value) filters.fiberType = fiberType.value;

    var origin = document.getElementById('origin');
    if (origin && origin.value) filters.origin = origin.value;

    var designer = document.getElementById('designer');
    if (designer && designer.value && designer.value.trim()) filters.designer = designer.value.trim();

    var feelsLike = document.getElementById('feelsLike');
    if (feelsLike && feelsLike.value) filters.feelsLike = feelsLike.value;

    var burnTest = document.getElementById('burnTest');
    if (burnTest && burnTest.value) filters.burnTest = burnTest.value;

    // Multi-select: Fabric content (from browse.js global)
    if (window.selectedContents && window.selectedContents.size > 0) {
      filters.content = Array.from(window.selectedContents);
    }

    // Multi-select: Fabric types
    if (window.selectedFabricTypes && window.selectedFabricTypes.size > 0) {
      filters.fabricTypes = Array.from(window.selectedFabricTypes);
    }

    // Multi-select: Colors
    if (window.selectedColors && window.selectedColors.size > 0) {
      filters.colors = Array.from(window.selectedColors);
    }

    // Cosplay filter
    var cosplayFilter = document.getElementById('cosplayFilter');
    if (cosplayFilter && cosplayFilter.checked) {
      filters.cosplay = true;
    }

    return filters;
  }

  function showToast(message, type) {
    type = type || 'info';

    // Remove existing toast
    var existing = document.querySelector('.hm-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'hm-toast';

    var bgColor = '#1e40af'; // info blue
    if (type === 'success') bgColor = '#065f46';
    if (type === 'error') bgColor = '#991b1b';

    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:' + bgColor + ';color:#fff;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;box-shadow:0 4px 16px rgba(0,0,0,0.2);z-index:99999;animation:toastSlideUp 0.3s ease-out;';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Add animation keyframes if not present
    if (!document.getElementById('toast-styles')) {
      var style = document.createElement('style');
      style.id = 'toast-styles';
      style.textContent = '@keyframes toastSlideUp{from{opacity:0;transform:translateX(-50%) translateY(20px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}';
      document.head.appendChild(style);
    }

    // Auto-remove after 4 seconds
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease-out';
      setTimeout(function() { toast.remove(); }, 300);
    }, 4000);
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
