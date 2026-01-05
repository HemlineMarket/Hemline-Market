/**
 * HEMLINE MARKET - Browse Page Enhancements
 * Skeleton Loaders + Applied Filter Chips
 * 
 * Usage: Include this script AFTER your main browse.html script
 * and call the functions as needed.
 */

(function() {
  'use strict';

  // =============================================
  // SKELETON LOADER FUNCTIONS
  // =============================================

  /**
   * Generate HTML for skeleton loader cards
   * @param {number} count - Number of skeleton cards to generate
   * @returns {string} HTML string of skeleton cards
   */
  window.generateSkeletonCards = function(count = 6) {
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <article class="listing-card skeleton-card">
          <div class="listing-thumb-link">
            <div class="listing-thumb" aria-hidden="true"></div>
          </div>
          <div class="listing-body">
            <div class="listing-title-row">
              <div class="skeleton-line" style="width:75%;height:16px;margin-bottom:4px"></div>
              <div class="skeleton-line" style="width:50px;height:20px;border-radius:999px"></div>
            </div>
            <div class="skeleton-line" style="width:40%;height:12px;margin:4px 0"></div>
            <div class="listing-cta-row" style="margin-top:8px">
              <div class="skeleton-btn"></div>
            </div>
            <div class="listing-price-row" style="margin-top:8px">
              <div class="skeleton-line" style="width:60px;height:14px"></div>
            </div>
            <div class="listing-seller-row" style="margin-top:6px">
              <div class="skeleton-line" style="width:80px;height:12px"></div>
            </div>
          </div>
        </article>
      `;
    }
    return html;
  };

  /**
   * Show skeleton loading state in the grid
   * @param {HTMLElement} gridEl - The grid container element
   * @param {number} count - Number of skeleton cards
   */
  window.showSkeletonLoading = function(gridEl, count = 6) {
    if (!gridEl) return;
    gridEl.innerHTML = generateSkeletonCards(count);
  };

  /**
   * Generate HTML for error state
   * @param {string} message - Error message to display
   * @returns {string} HTML string for error state
   */
  window.generateErrorState = function(message = 'Something went wrong') {
    return `
      <div class="browse-error">
        <div class="browse-error-icon">😕</div>
        <h3 class="browse-error-title">Oops!</h3>
        <p class="browse-error-text">${message}</p>
        <button class="browse-error-btn" onclick="window.location.reload()">
          Try Again
        </button>
      </div>
    `;
  };


  // =============================================
  // APPLIED FILTER CHIPS FUNCTIONS
  // =============================================

  /**
   * Get all currently active filters
   * @returns {Array} Array of filter objects with {type, label, value, clearFn}
   */
  window.getActiveFilters = function() {
    const filters = [];

    // Search query
    const qInput = document.getElementById('q');
    if (qInput && qInput.value.trim()) {
      filters.push({
        type: 'search',
        label: `"${qInput.value.trim()}"`,
        value: qInput.value.trim(),
        clear: () => { qInput.value = ''; }
      });
    }

    // Price range
    const minPrice = document.getElementById('minPrice');
    const maxPrice = document.getElementById('maxPrice');
    if (minPrice && minPrice.value) {
      filters.push({
        type: 'minPrice',
        label: `Min $${minPrice.value}/yd`,
        value: minPrice.value,
        clear: () => { minPrice.value = ''; }
      });
    }
    if (maxPrice && maxPrice.value) {
      filters.push({
        type: 'maxPrice',
        label: `Max $${maxPrice.value}/yd`,
        value: maxPrice.value,
        clear: () => { maxPrice.value = ''; }
      });
    }

    // Min yards
    const minYards = document.getElementById('minYards');
    if (minYards && minYards.value) {
      filters.push({
        type: 'minYards',
        label: `${minYards.value}+ yards`,
        value: minYards.value,
        clear: () => { minYards.value = ''; }
      });
    }

    // Width
    const minWidth = document.getElementById('minWidth');
    const maxWidth = document.getElementById('maxWidth');
    if (minWidth && minWidth.value) {
      filters.push({
        type: 'minWidth',
        label: `${minWidth.value}"+ wide`,
        value: minWidth.value,
        clear: () => { minWidth.value = ''; }
      });
    }
    if (maxWidth && maxWidth.value) {
      filters.push({
        type: 'maxWidth',
        label: `≤${maxWidth.value}" wide`,
        value: maxWidth.value,
        clear: () => { maxWidth.value = ''; }
      });
    }

    // GSM
    const minGsm = document.getElementById('minGsm');
    const maxGsm = document.getElementById('maxGsm');
    if (minGsm && minGsm.value) {
      filters.push({
        type: 'minGsm',
        label: `${minGsm.value}+ GSM`,
        value: minGsm.value,
        clear: () => { minGsm.value = ''; }
      });
    }
    if (maxGsm && maxGsm.value) {
      filters.push({
        type: 'maxGsm',
        label: `≤${maxGsm.value} GSM`,
        value: maxGsm.value,
        clear: () => { maxGsm.value = ''; }
      });
    }

    // Dropdowns
    const dropdowns = [
      { id: 'dept', label: 'Dept' },
      { id: 'fiberType', label: 'Fiber' },
      { id: 'pattern', label: 'Pattern' },
      { id: 'origin', label: 'Origin' },
      { id: 'feelsLike', label: 'Feels like' },
      { id: 'burnTest', label: 'Burn test' }
    ];

    dropdowns.forEach(dd => {
      const el = document.getElementById(dd.id);
      if (el && el.value) {
        filters.push({
          type: dd.id,
          label: el.value,
          value: el.value,
          clear: () => { el.value = ''; }
        });
      }
    });

    // Designer input
    const designer = document.getElementById('designer');
    if (designer && designer.value.trim()) {
      filters.push({
        type: 'designer',
        label: `Designer: ${designer.value.trim()}`,
        value: designer.value.trim(),
        clear: () => { designer.value = ''; }
      });
    }

    // Content checkboxes
    const contentChecked = document.querySelectorAll('input[name="content"]:checked');
    contentChecked.forEach(cb => {
      filters.push({
        type: 'content',
        label: cb.value,
        value: cb.value,
        clear: () => { 
          cb.checked = false;
          if (window.selectedContents) window.selectedContents.delete(cb.value);
        }
      });
    });

    // Fabric type checkboxes
    const fabricTypeChecked = document.querySelectorAll('input[name="fabricType"]:checked');
    fabricTypeChecked.forEach(cb => {
      filters.push({
        type: 'fabricType',
        label: cb.value,
        value: cb.value,
        clear: () => { 
          cb.checked = false;
          if (window.selectedFabricTypes) window.selectedFabricTypes.delete(cb.value);
        }
      });
    });

    // Color swatches
    if (window.selectedColors && window.selectedColors.size > 0) {
      window.selectedColors.forEach(color => {
        filters.push({
          type: 'color',
          label: color,
          value: color,
          clear: () => {
            window.selectedColors.delete(color);
            const sw = document.querySelector(`#colorBox .sw[data-name="${color}"]`);
            if (sw) sw.dataset.selected = 'false';
          }
        });
      });
    }

    // Cosplay filter
    const cosplayFilter = document.getElementById('cosplayFilter');
    if (cosplayFilter && cosplayFilter.checked) {
      filters.push({
        type: 'cosplay',
        label: '🦄 Cosplay-friendly',
        value: true,
        clear: () => {
          cosplayFilter.checked = false;
          const hint = document.getElementById('cosplayHint');
          const label = document.getElementById('cosplayLabel');
          if (hint) hint.style.display = 'none';
          if (label) {
            label.style.borderColor = 'var(--border)';
            label.style.background = '#fff';
          }
        }
      });
    }

    return filters;
  };

  /**
   * Render the applied filters chip bar
   * @param {Function} onFilterRemove - Callback when a filter is removed (to re-run search)
   */
  window.renderAppliedFilters = function(onFilterRemove) {
    let container = document.getElementById('appliedFilters');
    
    // Create container if it doesn't exist
    if (!container) {
      const resultsSection = document.querySelector('.results');
      if (!resultsSection) return;
      
      container = document.createElement('div');
      container.id = 'appliedFilters';
      container.className = 'applied-filters';
      
      // Insert before the grid
      const grid = document.getElementById('grid');
      if (grid) {
        resultsSection.insertBefore(container, grid);
      } else {
        resultsSection.appendChild(container);
      }
    }

    const filters = getActiveFilters();

    if (filters.length === 0) {
      container.classList.remove('has-filters');
      container.innerHTML = '';
      return;
    }

    container.classList.add('has-filters');

    let html = '<span class="applied-filters-label">Filters:</span>';

    filters.forEach((filter, index) => {
      html += `
        <span class="filter-chip" data-filter-index="${index}">
          <span class="filter-chip-text">${escapeHtml(filter.label)}</span>
          <button class="filter-chip-remove" data-filter-index="${index}" aria-label="Remove filter">×</button>
        </span>
      `;
    });

    // Add "Clear all" button if more than 1 filter
    if (filters.length > 1) {
      html += `
        <button class="filter-chip clear-all-filters-chip" id="clearAllChip">
          Clear all
        </button>
      `;
    }

    container.innerHTML = html;

    // Wire up remove buttons
    container.querySelectorAll('.filter-chip-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.filterIndex, 10);
        if (filters[idx] && filters[idx].clear) {
          filters[idx].clear();
          if (typeof onFilterRemove === 'function') {
            onFilterRemove();
          }
        }
      });
    });

    // Wire up "Clear all" button
    const clearAllBtn = document.getElementById('clearAllChip');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        if (typeof window.clearAllFilters === 'function') {
          window.clearAllFilters();
        } else {
          filters.forEach(f => f.clear && f.clear());
          if (typeof onFilterRemove === 'function') {
            onFilterRemove();
          }
        }
      });
    }
  };

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // =============================================
  // AUTO-INITIALIZATION
  // =============================================

  // Make functions globally available
  window.HMBrowseEnhancements = {
    generateSkeletonCards,
    showSkeletonLoading,
    generateErrorState,
    getActiveFilters,
    renderAppliedFilters
  };

})();
