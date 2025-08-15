// /js/modules/a11y.js
export function initA11y() {
  // Ensure #main exists for skip links
  const main = document.getElementById('main');
  if (!main) {
    const m = document.createElement('main');
    m.id = 'main';
    document.body.appendChild(m);
  }

  // Keyboard-only focus outlines
  let usingMouse = false;
  document.addEventListener('mousedown', () => { usingMouse = true; });
  document.addEventListener('keydown', () => { usingMouse = false; });
  document.addEventListener('focusin', (e) => {
    if (usingMouse && e.target instanceof HTMLElement) e.target.style.outline = 'none';
  });
}
