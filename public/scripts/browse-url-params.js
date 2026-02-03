// File: /public/scripts/browse-url-params.js
// Reads URL parameters and applies saved search filters
// Must be loaded AFTER browse.js
(function() {
  'use strict';

  function applyUrlParams() {
    var params = new URLSearchParams(window.location.search);
    
    // Skip if no params at all
    if (!params.toString()) return;

    console.log('[browse-url-params] Applying filters from URL:', params.toString());

    var hasFilters = false;

    // Text search (already handled by browse.js, but just in case)
    var q = params.get('q');
    if (q) {
      var qInput = document.getElementById('q');
      if (qInput && !qInput.value) qInput.value = q;
    }

    // Price
    var minPrice = params.get('minPrice');
    var maxPrice = params.get('maxPrice');
    if (minPrice) {
      var el = document.getElementById('minPrice');
      if (el) { el.value = minPrice; hasFilters = true; }
    }
    if (maxPrice) {
      var el = document.getElementById('maxPrice');
      if (el) { el.value = maxPrice; hasFilters = true; }
    }

    // Yards
    var minYards = params.get('minYards');
    if (minYards) {
      var el = document.getElementById('minYards');
      if (el) { el.value = minYards; hasFilters = true; }
    }

    // Width
    var minWidth = params.get('minWidth');
    var maxWidth = params.get('maxWidth');
    if (minWidth) {
      var el = document.getElementById('minWidth');
      if (el) { el.value = minWidth; hasFilters = true; }
    }
    if (maxWidth) {
      var el = document.getElementById('maxWidth');
      if (el) { el.value = maxWidth; hasFilters = true; }
    }

    // GSM
    var minGsm = params.get('minGsm');
    var maxGsm = params.get('maxGsm');
    if (minGsm) {
      var el = document.getElementById('minGsm');
      if (el) { el.value = minGsm; hasFilters = true; }
    }
    if (maxGsm) {
      var el = document.getElementById('maxGsm');
      if (el) { el.value = maxGsm; hasFilters = true; }
    }

    // Dropdowns
    var dropdowns = ['dept', 'fiberType', 'origin', 'designer', 'feelsLike', 'burnTest'];
    dropdowns.forEach(function(id) {
      var val = params.get(id);
      if (val) {
        var el = document.getElementById(id);
        if (el) { el.value = val; hasFilters = true; }
      }
    });

    // Sort order (stored as 'sort' in URL, maps to #sortBy select)
    var sort = params.get('sort');
    if (sort) {
      var sortEl = document.getElementById('sortBy');
      if (sortEl) {
        sortEl.value = sort;
        console.log('[browse-url-params] Set sort to:', sort);
      }
    }

    // Content (fabric content checkboxes) - use value attribute
    var content = params.get('content');
    if (content) {
      var contents = content.split(',');
      contents.forEach(function(c) {
        var val = c.trim();
        if (window.selectedContents) {
          window.selectedContents.add(val);
        }
        // Find checkbox by value attribute
        var cb = document.querySelector('#contentBox input[type="checkbox"][value="' + val + '"]');
        if (cb) {
          cb.checked = true;
          console.log('[browse-url-params] Checked content:', val);
        } else {
          console.log('[browse-url-params] Could not find content checkbox for:', val);
        }
      });
      hasFilters = true;
    }

    // Fabric types (checkboxes) - use value attribute
    var fabricTypes = params.get('fabricTypes');
    if (fabricTypes) {
      var types = fabricTypes.split(',');
      types.forEach(function(t) {
        var val = t.trim();
        if (window.selectedFabricTypes) {
          window.selectedFabricTypes.add(val);
        }
        // Find checkbox by value attribute
        var cb = document.querySelector('#fabricTypeBox input[type="checkbox"][value="' + val + '"]');
        if (cb) {
          cb.checked = true;
          console.log('[browse-url-params] Checked fabricType:', val);
        }
      });
      hasFilters = true;
    }

    // Colors - swatches have data-name attribute
    var colors = params.get('colors');
    if (colors) {
      var colorList = colors.split(',');
      colorList.forEach(function(c) {
        var val = c.trim();
        if (window.selectedColors) {
          window.selectedColors.add(val);
        }
        // Select the color swatch
        var swatch = document.querySelector('#colorBox .sw[data-name="' + val + '"]');
        if (swatch) {
          swatch.setAttribute('data-selected', 'true');
          swatch.style.outline = '2px solid #111';
          console.log('[browse-url-params] Selected color:', val);
        }
      });
      hasFilters = true;
    }

    // Cosplay filter
    var cosplay = params.get('cosplay');
    if (cosplay === '1') {
      var el = document.getElementById('cosplayFilter');
      if (el) { el.checked = true; hasFilters = true; }
    }

    // If we applied filters, trigger a search that preserves page
    if (hasFilters) {
      console.log('[browse-url-params] Triggering search (keepPage)...');
      setTimeout(function() {
        if (typeof window.runSearch === 'function') {
          window.runSearch('keepPage');
        } else {
          var searchBtn = document.getElementById('doSearch');
          if (searchBtn) searchBtn.click();
        }
      }, 50);
    }
  }

  // Wait for browse.js to create the checkboxes (needs longer delay)
  function waitAndApply() {
    // Check if contentBox has children (means browse.js has run)
    var contentBox = document.getElementById('contentBox');
    if (contentBox && contentBox.children.length > 0) {
      applyUrlParams();
    } else {
      // Keep waiting
      setTimeout(waitAndApply, 100);
    }
  }

  // Start waiting after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(waitAndApply, 300);
    });
  } else {
    setTimeout(waitAndApply, 300);
  }

})();
