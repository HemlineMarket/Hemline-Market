/* 
 * FILE: public/scripts/escape-html.js
 * ADD this as a NEW file
 * 
 * This prevents hackers from injecting code into your website
 * Include it on pages that show user content (comments, reviews, etc.)
 */

(function() {
  'use strict';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#x2F;');
  }

  function linkify(text) {
    if (!text) return '';
    
    const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
    let lastIndex = 0;
    let html = '';
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[0];
      const before = text.slice(lastIndex, match.index);
      html += escapeHtml(before);
      html += `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      lastIndex = match.index + url.length;
    }

    html += escapeHtml(text.slice(lastIndex));
    return html;
  }

  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.linkify = linkify;
})();
