// File: /public/scripts/browse-url-params.js
// Reads URL parameters and applies saved search filters
// Must be loaded AFTER browse.js
(function() {
  'use strict';

  function applyUrlParams() {
    var params = new URLSearchParams(window.location.search);
    
    // Skip if no filter params
    if (params.toString() === '' || (params.has('q') && params.toString() === 'q=' + params.get('q'))) {
      return;
    }

    var hasFilters = false;

    // Text search (already handled by browse.js, but just in case)
    var q = params.get('q');
    if (q) {
      var qInput = document.getElementById('q');
      if (qInput) qInput.value = q;
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
    var dept = params.get('dept');
    if (dept) {
      var el = document.getElementById('dept');
      if (el) { el.value = dept; hasFilters = true; }
    }

    var fiberType = params.get('fiberType');
    if (fiberType) {
      var el = document.getElementById('fiberType');
      if (el) { el.value = fiberType; hasFilters = true; }
    }

    var origin = params.get('origin');
    if (origin) {
      var el = document.getElementById('origin');
      if (el) { el.value = origin; hasFilters = true; }
    }

    var designer = params.get('designer');
    if (designer) {
      var el = document.getElementById('designer');
      if (el) { el.value = designer; hasFilters = true; }
    }

    var feelsLike = params.get('feelsLike');
    if (feelsLike) {
      var el = document.getElementById('feelsLike');
      if (el) { el.value = feelsLike; hasFilters = true; }
    }

    var burnTest = params.get('burnTest');
    if (burnTest) {
      var el = document.getElementById('burnTest');
      if (el) { el.value = burnTest; hasFilters = true; }
    }

    // Content (fabric content checkboxes)
    var content = params.get('content');
    if (content && window.selectedContents) {
      var contents = content.split(',');
      contents.forEach(function(c) {
        window.selectedContents.add(c.trim());
        // Check the checkbox
        var checkbox = document.querySelector('#contentBox input[data-label="' + c.trim() + '"]');
        if (!checkbox) {
          // Try finding by label text
          var labels = document.querySelectorAll('#contentBox label');
          labels.forEach(function(label) {
            if (label.textContent.trim() === c.trim()) {
              var cb = label.parentElement.querySelector('input[type="checkbox"]');
              if (cb) { cb.checked = true; }
            }
          });
        } else {
          checkbox.checked = true;
        }
      });
      hasFilters = true;
    }

    // Fabric types (checkboxes)
    var fabricTypes = params.get('fabricTypes');
    if (fabricTypes && window.selectedFabricTypes) {
      var types = fabricTypes.split(',');
      types.forEach(function(t) {
        window.selectedFabricTypes.add(t.trim());
        // Check the checkbox
        var labels = document.querySelectorAll('#fabricTypeBox label');
        labels.forEach(function(label) {
          if (label.textContent.trim() === t.trim()) {
            var cb = label.parentElement.querySelector('input[type="checkbox"]');
            if (cb) { cb.checked = true; }
          }
        });
      });
      hasFilters = true;
    }

    // Colors
    var colors = params.get('colors');
    if (colors && window.selectedColors) {
      var colorList = colors.split(',');
      colorList.forEach(function(c) {
        window.selectedColors.add(c.trim());
        // Select the color swatch
        var swatch = document.querySelector('#colorBox .sw[data-name="' + c.trim() + '"]');
        if (swatch) {
          swatch.setAttribute('data-selected', 'true');
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

    // If we applied filters, trigger a search
    if (hasFilters) {
      // Small delay to let browse.js finish initializing
      setTimeout(function() {
        // Try to find and click the search button, or call runSearch directly
        var searchBtn = document.getElementById('doSearch');
        if (searchBtn) {
          searchBtn.click();
        } else if (window.runSearch) {
          window.runSearch();
        }
        
        // Update filter chips if available
        if (window.updateAppliedFiltersUI) {
          window.updateAppliedFiltersUI();
        }
      }, 100);
    }
  }

  // Run after DOM is ready and browse.js has initialized
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(applyUrlParams, 200);
    });
  } else {
    setTimeout(applyUrlParams, 200);
  }

})();
