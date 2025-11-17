// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- ELEMENTS ----

// Header
const headerAvatar = document.getElementById("headerUser");
const headerLoginBtn = document.getElementById("headerLoginBtn");

// Account page containers
const accountLoggedOut = document.getElementById("accountLoggedOut");
const accountGrid = document.getElementById("accountGrid");

// Profile summary
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileLocationSummary = document.getElementById("profileLocationSummary");
const profileBioSummary = document.getElementById("profileBioSummary");
const profileWebsiteWrapper = document.getElementById("profileWebsiteWrapper");
const profileWebsite = document.getElementById("profileWebsite");

// Profile editing
const editProfileBtn = document.getElementById("editProfileBtn");
const profileForm = document.getElementById("profileForm");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelProfileEditBtn = document.getElementById("cancelProfileEditBtn");

// Profile form inputs
const firstNameInput = document.getElementById("firstNameInput");
const lastNameInput = document.getElementById("lastNameInput");
const locationInput = document.getElementById("locationInput");
const bioInput = document.getElementById("bioInput");
const websiteInput = document.getElementById("websiteInput");

// Avatar upload
const avatarChangeBtn = document.getElementById("avatarChangeBtn");
const avatarInput = document.getElementById("avatarInput");

// Shipping
const shipFromName = document.getElementById("shipFromName");
const shipFromStreet = document.getElementById("shipFromStreet");
const shipFromStreet2 = document.getElementById("shipFromStreet2");
const shipFromCity = document.getElementById("shipFromCity");
const shipFromState = document.getElementById("shipFromState");
const shipFromZip = document.getElementById("shipFromZip");
const shipFromCountry = document.getElementById("shipFromCountry");
const saveShippingSettingsBtn = document.getElementById("saveShippingAddressBtn");

// Logout
const logoutBtn = document.getElementById("logoutBtn");

// --- HELPERS ----

function getInitials(user) {
  const meta = user?.user_metadata || {};

  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const display = (meta.display_name || "").trim();

  if (first || last) {
    return `${first[0] || ""}${last[0] || ""}`.toUpperCase();
  }

  if (display) {
    const parts = display.split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
  }

  return (user.email?.[0] || "H").toUpperCase();
}

function applyHeaderUser(user) {
  if (!headerAvatar || !headerLoginBtn) return;

  if (!user) {
    headerAvatar.classList.add("is-hidden");
    headerLoginBtn.classList.remove("is-hidden");
    return;
  }

  headerAvatar.textContent = getInitials(user);
  headerAvatar.classList.remove("is-hidden");
  headerLoginBtn.classList.add("is-hidden");
}

function applyProfileAvatar(user) {
  const key = `hm-avatar-${user.id}`;
  const stored = localStorage.getItem(key);

  if (stored && profileAvatar) {
    profileAvatar.style.backgroundImage = `url(${stored})`;
    profileAvatar.textContent = "";
  } else if (profileAvatar) {
    profileAvatar.textContent = getInitials(user);
  }
}

function show(el) {
  if (el) el.style.display = "block";
}
function hide(el) {
  if (el) el.style.display = "none";
}
// ---- FILL PROFILE SUMMARY ----
function fillProfileSummary(user) {
  const meta = user.user_metadata || {};

  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const display = (meta.display_name || "").trim();

  const nameToShow =
    first || last
      ? `${first} ${last}`.trim()
      : display || user.email?.split("@")[0] || "Hemline Member";

  if (profileName) profileName.textContent = nameToShow;
  if (profileEmail) profileEmail.textContent = user.email || "";

  // LOCATION
  const loc = (meta.location || "").trim();
  if (loc && profileLocationSummary) {
    profileLocationSummary.textContent = loc;
    show(profileLocationSummary);
  } else if (profileLocationSummary) {
    hide(profileLocationSummary);
  }

  // BIO
  const bio = (meta.bio || "").trim();
  if (bio && profileBioSummary) {
    profileBioSummary.textContent = bio;
    show(profileBioSummary);
  } else if (profileBioSummary) {
    hide(profileBioSummary);
  }

  // WEBSITE
  const website = (meta.website || "").trim();
  if (website && profileWebsite && profileWebsiteWrapper) {
    profileWebsite.href = website;
    profileWebsite.textContent = website;
    show(profileWebsiteWrapper);
  } else if (profileWebsiteWrapper) {
    hide(profileWebsiteWrapper);
  }
}

// ---- FILL PROFILE FORM ----
function fillProfileForm(user) {
  const meta = user.user_metadata || {};

  if (firstNameInput) firstNameInput.value = meta.first_name || "";
  if (lastNameInput) lastNameInput.value = meta.last_name || "";
  if (locationInput) locationInput.value = meta.location || "";
  if (bioInput) bioInput.value = meta.bio || "";
  if (websiteInput) websiteInput.value = meta.website || "";
}

// ---- SHIPPING SUMMARY ----
function fillShippingFromMeta(user) {
  const meta = user.user_metadata || {};

  if (shipFromName) shipFromName.value = meta.ship_from_name || "";
  if (shipFromStreet) shipFromStreet.value = meta.ship_from_street || "";
  if (shipFromStreet2) shipFromStreet2.value = meta.ship_from_street2 || "";
  if (shipFromCity) shipFromCity.value = meta.ship_from_city || "";
  if (shipFromState) shipFromState.value = meta.ship_from_state || "";
  if (shipFromZip) shipFromZip.value = meta.ship_from_zip || "";
  if (shipFromCountry && meta.ship_from_country) {
    shipFromCountry.value = meta.ship_from_country;
  }
}

// ---- SAVE SHIPPING ----
if (saveShippingSettingsBtn) {
  saveShippingSettingsBtn.addEventListener("click", async () => {
    if (!currentUser) return;

    const meta = currentUser.user_metadata || {};
    const updated = {
      ...meta,
      ship_from_name: shipFromName.value.trim() || null,
      ship_from_street: shipFromStreet.value.trim() || null,
      ship_from_street2: shipFromStreet2.value.trim() || null,
      ship_from_city: shipFromCity.value.trim() || null,
      ship_from_state: shipFromState.value.trim() || null,
      ship_from_zip: shipFromZip.value.trim() || null,
      ship_from_country: shipFromCountry.value || null,
    };

    const { data, error } = await supabase.auth.updateUser({ data: updated });

    if (error) {
      alert("Could not save address.");
      return;
    }

    currentUser = data.user;
    fillShippingFromMeta(currentUser);
    alert("Address saved!");
  });
}

// ---- AVATAR UPLOAD ----
if (avatarChangeBtn && avatarInput) {
  avatarChangeBtn.addEventListener("click", () => avatarInput.click());

  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      alert("Choose an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const key = `hm-avatar-${currentUser.id}`;
      localStorage.setItem(key, dataUrl);

      profileAvatar.style.backgroundImage = `url(${dataUrl})`;
      profileAvatar.textContent = "";
    };
    reader.readAsDataURL(file);
  });
}

// ---- SAVE PROFILE ----
if (saveProfileBtn) {
  saveProfileBtn.addEventListener("click", async () => {
    if (!currentUser) return;

    const first = firstNameInput.value.trim();
    const last = lastNameInput.value.trim();
    const loc = locationInput.value.trim();
    const bio = bioInput.value.trim();
    const website = websiteInput.value.trim();

    const display =
      first || last
        ? `${first} ${last}`.trim()
        : currentUser.user_metadata.display_name || null;

    const updated = {
      ...currentUser.user_metadata,
      first_name: first || null,
      last_name: last || null,
      location: loc || null,
      bio: bio || null,
      website: website || null,
      display_name: display,
    };

    const { data, error } = await supabase.auth.updateUser({ data: updated });

    if (error) {
      alert("Could not save profile.");
      return;
    }

    currentUser = data.user;
    fillProfileSummary(currentUser);
    hide(profileForm);
  });
}
// ---- STRIPE ----
if (payoutSetupBtn) {
  payoutSetupBtn.addEventListener("click", () => {
    window.open("https://dashboard.stripe.com/login", "_blank", "noopener");
  });
}

if (payoutManageBtn) {
  payoutManageBtn.addEventListener("click", () => {
    window.open("https://dashboard.stripe.com/login", "_blank", "noopener");
  });
}

// ---- VACATION SWITCH ----
if (vacSwitch) {
  vacSwitch.addEventListener("click", () => {
    const val = vacSwitch.getAttribute("data-on") === "true";
    vacSwitch.setAttribute("data-on", val ? "false" : "true");
  });
}

// ---- INITIAL LOAD ----
(async () => {
  const { data } = await supabase.auth.getSession();
  const sessionUser = data?.session?.user || null;

  if (!sessionUser) {
    setLoggedOutUI();
    return;
  }

  currentUser = sessionUser;

  // Logged-in UI
  show(accountGrid, "block");
  hide(accountLoggedOut);

  // Header initials
  setLoggedInHeader(currentUser);

  // Profile
  fillProfileSummary(currentUser);
  fillProfileForm(currentUser);

  // Shipping
  fillShippingFromMeta(currentUser);

  // Avatar
  const avatarKey = `hm-avatar-${currentUser.id}`;
  const savedAvatar = localStorage.getItem(avatarKey);
  if (savedAvatar && profileAvatar) {
    profileAvatar.style.backgroundImage = `url(${savedAvatar})`;
    profileAvatar.textContent = "";
  }

  if (logoutBtn) show(logoutBtn, "inline-block");
})();
