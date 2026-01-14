/**
 * File: public/scripts/saved-search.js
 * Adds "Save this search" functionality to the browse page
 * Requires: hm-shell.js to be loaded first
 */

(function() {
  'use strict';

  // Wait for DOM and HM to be ready
  function init() {
    // Only run on browse page
    if (!window.location.pathname.includes('browse')) return;

    // Create and insert the save search button
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'save-search-btn';
    saveBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
      </svg>
      <span>Save search</span>
    `;
    saveBtn.style.cssText = `
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 14px;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
      background: #fff;
      color: #374151;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    `;

    // Insert after the search button
    const searchBtn = document.getElementById('doSearch');
    if (searchBtn && searchBtn.parentNode) {
      searchBtn.parentNode.insertBefore(saveBtn, searchBtn.nextSibling);
    } else {
      topbar.appendChild(saveBtn);
    }

    // Click handler
    saveBtn.addEventListener('click', handleSaveSearch);
  }

  async function handleSaveSearch() {
    // Check if user is signed in
    const supabase = window.HM?.supabase;
    if (!supabase) {
      showToast('Please wait for the page to load', 'error');
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      showToast('Please sign in to save searches', 'error');
      setTimeout(() => {
        window.location.href = 'auth.html?view=login&redirect=' + encodeURIComponent(window.location.href);
      }, 1500);
      return;
    }

    // Gather current filters
    const filters = gatherCurrentFilters();

    // Check if any filters are active
    const hasFilters = Object.keys(filters).some(key => {
      const val = filters[key];
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
      const res = await fetch('/api/saved-searches/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ filters })
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.message || data.error || 'Failed to save search', 'error');
        return;
      }

      showToast('Search saved! You\'ll get email alerts for new matches.', 'success');

    } catch (e) {
      console.error('Error saving search:', e);
      showToast('Failed to save search. Please try again.', 'error');
    }
  }

  function gatherCurrentFilters() {
    const filters = {};

    // Search query
    const qInput = document.getElementById('q');
    if (qInput?.value?.trim()) {
      filters.q = qInput.value.trim();
    }

    // Price range
    const minPrice = document.getElementById('minPrice');
    const maxPrice = document.getElementById('maxPrice');
    if (minPrice?.value) filters.minPrice = Number(minPrice.value);
    if (maxPrice?.value) filters.
