// /js/modules/contact.js
export function initContact() {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    alert("Form stub: wired! Backend comes later.");
    if (btn) btn.disabled = false;
  });
}
