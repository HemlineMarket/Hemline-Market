// public/scripts/shared-auth.js
// Keeps the header initials + header login button in sync with Supabase auth.

import { supabase } from "./supabase-client.js";

async function initHeaderAuth() {
  const avatar = document.getElementById("avatar");
  const headerLoginBtn = document.getElementById("headerLoginBtn");

  // If a page doesn't have the header, do nothing.
  if (!avatar && !headerLoginBtn) return;

  // Get current user from Supabase
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user || null;

  // Helper: set initials
  function setInitials(userObj) {
    if (!avatar) return;

    let initials = "";
    const name =
      userObj?.user_metadata?.display_name ||
      userObj?.user_metadata?.full_name ||
      "";

    if (name) {
      initials = name
        .trim()
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 3)
        .toUpperCase();
    }

    if (!initials && userObj?.email) {
      initials = userObj.email[0].toUpperCase();
    }

    if (!initials) initials = "U";

    avatar.textContent = initials;
    avatar.style.backgroundImage = "";
    avatar.setAttribute("aria-label", `Account (${initials})`);
  }

  if (!user) {
    // Not logged in
    if (avatar) {
      avatar.textContent = "AA";
      avatar.style.backgroundImage = "";
      avatar.setAttribute("aria-label", "Log in to Hemline Market");

      avatar.addEventListener("click", (e) => {
        // Always send logged-out users to the auth page, not a dead account page
        e.preventDefault();
        window.location.href = "auth.html?view=login";
      });
    }

    if (headerLoginBtn) {
      headerLoginBtn.style.display = "inline-flex";
      headerLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.href = "auth.html?view=login";
      });
    }

    return;
  }

  // Logged in
  setInitials(user);

  if (headerLoginBtn) {
    headerLoginBtn.style.display = "none";
  }

  if (avatar) {
    avatar.href = "account.html";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initHeaderAuth().catch((err) => {
    console.error("Header auth init failed", err);
  });
});
