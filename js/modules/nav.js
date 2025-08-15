// /js/modules/nav.js
export function initNav() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const menu = document.querySelector("[data-nav-menu]");
  if (!toggle || !menu) return;
  toggle.addEventListener("click", () => {
    const open = menu.getAttribute("data-open") === "true";
    menu.setAttribute("data-open", String(!open));
    toggle.setAttribute("aria-expanded", String(!open));
  });
}
