// /js/app.js
import { initNav } from "./modules/nav.js";
import { initContact } from "./modules/contact.js";
import { initMarketplace } from "./modules/marketplace.js";
import { initA11y } from "./modules/a11y.js";

// Small helper
const domReady = (fn) => {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
  else fn();
};

domReady(() => {
  initA11y();
  initNav();
  initContact();
  initMarketplace();
  // Add future initializers here.
});
