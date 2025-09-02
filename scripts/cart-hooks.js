// scripts/cart-hooks.js
// Wires any button/link with [data-add-to-cart] to the Cart module.
// Expects data attributes on the element:
//   data-id, data-name, data-price (cents), data-currency, data-image, data-url, data-qty (optional)

(function () {
  function getItemFromEl(el) {
    return {
      id: el.getAttribute('data-id'),
      name: el.getAttribute('data-name'),
      price: Number(el.getAttribute('data-price') || 0),       // cents
      currency: (el.getAttribute('data-currency') || 'usd').toLowerCase(),
      image: el.getAttribute('data-image') || '',
      url: el.getAttribute('data-url') || location.href,
      quantity: Number(el.getAttribute('data-qty') || 1)
    };
  }

  function handleClick(e) {
    const el = e.currentTarget;
    e.preventDefault();
    try {
      const item = getItemFromEl(el);
      if (!item.id || !item.name || !item.price) {
        console.warn('Add to Cart missing fields:', item);
        return;
      }
      if (!window.Cart) {
        console.error('Cart module not found (scripts/cart.js not loaded)');
        return;
      }
      window.Cart.add(item);

      // Optional UX: brief “Added” flash on the button
      const prev = el.textContent;
      el.textContent = 'Added ✓';
      el.disabled = true;
      setTimeout(() => { el.textContent = prev; el.disabled = false; }, 900);
    } catch (err) {
      console.error('Add to Cart error:', err);
    }
  }

  function attach() {
    document.querySelectorAll('[data-add-to-cart]').forEach((el) => {
      // Avoid double-binding
      if (el.__hmBound) return;
      el.__hmBound = true;
      el.addEventListener('click', handleClick);
    });
  }

  document.addEventListener('DOMContentLoaded', attach);
  // Also re-scan if content is injected dynamically
  const obs = new MutationObserver(attach);
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
