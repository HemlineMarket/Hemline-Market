// /js/modules/marketplace.js
export function initMarketplace() {
  const grid = document.querySelector('[data-market-grid]');
  if (!grid) return;
  if (grid.children.length) return; // don't duplicate
  const sample = [
    { title: "Italian Wool Dobby", price: 38, unit: "yd" },
    { title: "Merino Suiting", price: 42, unit: "yd" },
    { title: "Carlos Cotton Sateen", price: 24, unit: "yd" }
  ];
  const frag = document.createDocumentFragment();
  sample.forEach((it) => {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h3>${it.title}</h3>
      <p class="muted">$${it.price}/${it.unit}</p>
      <a class="button" href="#">View</a>
    `;
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}
