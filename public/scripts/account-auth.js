// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- LAYOUT TWEAK (prevent tall stretching) ----
document.addEventListener("DOMContentLoaded", () => {
  const grid = document.getElementById("accountGrid");
  if (grid) {
    grid.querySelectorAll(":scope > *").forEach((el) => {
      el.style.alignSelf = "flex-start";
    });
  }
});

// ---- ELEMENTS ----

// Auth overlay (login drawer on account page)
const modal = document.getElementById("authOverlay");
const closeAuthBtn = document.getElementById("authCloseBtn");

// Header pieces
const loginHeaderBtn = document.getElementById("loginHeaderBtn");
const headerAvatar = document.getElementById("headerAvatar");

// Logged-out vs logged-in containers
const accountLoggedOut = document.getElementById("accountLoggedOut");
const accountGrid = document.getElementById("accountGrid");

// Logged-out card login button
const accountLoginOpen = document.getElementById("accountLoginOpen");

// Profile summary + form
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileLocationSummary = document.getElementById("profileLocationSummary");
const profileBioSummary = document.getElementById("profileBioSummary");
const profileWebsiteWrapper = document.getElementById("profileWebsiteWrapper");
const profileWebsite = document.getElementById("profileWebsite");

const avatarChangeBtn = document.getElementById("avatarChangeBtn");
const avatarInput = document.getElementById("avatarInput");

const editProfileBtn = document.getElementById("editProfileBtn");
const profileForm = document.getElementById("profileForm");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const cancelProfileEditBtn = document.getElementById("cancelProfileEditBtn");

const firstNameInput = document.getElementById("firstNameInput");
const lastNameInput = document.getElementById("lastNameInput");
const locationInput = document.getElementById("locationInput");
const bioInput = document.getElementById("bioInput");
const websiteInput = document.getElementById("websiteInput");

// Logout button in profile card
const logoutBtn = document.getElementById("logoutBtn");

// Auth forms in the drawer
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const googleBtn = document.getElementById("googleBtn");
const appleBtn = document.getElementById("appleBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

const errBox = document.getElementById("authError");
const msgBox = document.getElementById("authMessage");

// Payouts & shipping
const payoutSetupBtn = document.getElementById("payoutSetupBtn");
const payoutManageBtn = document.getElementById("payoutManageBtn");
const payoutStatusText = document.getElementById("payoutStatusText");

const shipFromName = document.getElementById("shipFromName");
const shipFromStreet = document.getElementById("shipFromStreet");
const shipFromStreet2 = document.getElementById("shipFromStreet2");
const shipFromCity = document.getElementById("shipFromCity");
const shipFromState = document.getElementById("shipFromState");
const shipFromZip = document.getElementById("shipFromZip");
const shipFromCountry = document.getElementById("shipFromCountry");
const saveShippingSettingsBtn =
  document.getElementById("saveShippingAddressBtn") ||
  document.getElementById("saveShippingSettingsBtn");

// Status / vacation
const vacSwitch = document.getElementById("vacSwitch");

// ---- STATE ----
let currentUser = null;

// Shipping-summary UI (created programmatically)
let shippingSection = shipFromName
  ? shipFromName.closest("section")
  : null;
let shipSummaryBox = null;
let shipSummaryLines = null;
let editAddressBtn = null;
let cancelShippingBtn = null;
let shipEditElements = [];
let lastShippingMeta = null;

// ---- SMALL HELPERS ----
function show(el, displayValue = "block") {
  if (el) el.style.display = displayValue;
}
function hide(el) {
  if (el) el.style.display = "none";
}

function clearMessages() {
  if (errBox) errBox.textContent = "";
  if (msgBox) msgBox.textContent = "";
}
function setError(msg) {
  if (errBox) errBox.textContent = msg || "";
}
function setMessage(msg) {
  if (msgBox) msgBox.textContent = msg || "";
}

// Initials builder from user metadata/email
function getInitials(user) {
  const meta = user?.user_metadata || {};
  const display = (meta.display_name || "").trim();
  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();

  let source = "";
  if (first || last) {
    source = `${first} ${last}`.trim();
  } else if (display) {
    source = display;
  }

  if (source) {
    const parts = source.split(/\s+/);
    const a = parts[0]?.[0] || "";
    const b = (parts.length > 1 ? parts[parts.length - 1]?.[0] : "") || "";
    const letters = (a + b).toUpperCase();
    if (letters) return letters;
  }

  const email = user?.email || "";
  if (email) {
    const local = email.split("@")[0] || "";
    if (local) return local.slice(0, 2).toUpperCase();
  }

  return "HM";
}

// Avatar localStorage helpers
function getAvatarStorageKey(user) {
  if (!user?.id) return null;
  return `hm-avatar-${user.id}`;
}
function saveAvatarToStorage(user, dataUrl) {
  const key = getAvatarStorageKey(user);
  if (!key) return;
  try {
    window.localStorage.setItem(key, dataUrl);
  } catch (e) {
    console.warn("Could not save avatar to localStorage", e);
  }
}
function applyAvatarFromStorage(user) {
  const key = getAvatarStorageKey(user);
  if (!key) return;
  let dataUrl = null;
  try {
    dataUrl = window.localStorage.getItem(key);
  } catch (e) {
    console.warn("Could not read avatar from localStorage", e);
  }
  if (!dataUrl) return;

  if (profileAvatar) {
    profileAvatar.style.backgroundImage = `url(${dataUrl})`;
    profileAvatar.textContent = "";
  }
}

// ---- AUTH DRAWER BEHAVIOR ----
function openAuthModal() {
  if (!modal) return;
  modal.classList.add("show");
  clearMessages();
}
function closeAuthModal() {
  if (!modal) return;
  modal.classList.remove("show");
  clearMessages();
}

if (loginHeaderBtn) {
  loginHeaderBtn.addEventListener("click", openAuthModal);
}
if (accountLoginOpen) {
  accountLoginOpen.addEventListener("click", openAuthModal);
}
if (closeAuthBtn) {
  closeAuthBtn.addEventListener("click", closeAuthModal);
}

// ---- LOGIN (email/password) ----
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessages();

    const email = document.getElementById("loginEmail")?.value.trim();
    const pw = document.getElementById("loginPassword")?.value.trim();

    if (!email || !pw) {
      setError("Please enter your email and password.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: pw,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login")) {
        setError("Incorrect email or password. Please try again.");
      } else {
        setError(error.message);
      }
      return;
    }

    setMessage("Welcome back to Hemline Market!");
    setTimeout(() => {
      window.location.href = "/";
    }, 700);
  });
}

// ---- SIGNUP (create account) ----
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessages();

    const name = document.getElementById("signupName")?.value.trim();
    const email = document.getElementById("signupEmail")?.value.trim();
    const pw = document.getElementById("signupPassword")?.value.trim();

    if (!name || !email || !pw) {
      setError("Please fill in name, email, and password.");
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password: pw,
      options: {
        data: { display_name: name },
      },
    });

    if (error) {
      setError(error.message);
      return;
    }

    setMessage(
      "Account created! Check your email to confirm, then log in to start sewing, sharing, and selling on Hemline Market."
    );
  });
}

// ---- FORGOT PASSWORD ----
if (forgotPasswordBtn) {
  forgotPasswordBtn.addEventListener("click", async () => {
    clearMessages();

    const email = document.getElementById("loginEmail")?.value.trim();
    if (!email) {
      setError("Please enter your email first.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/reset.html",
    });

    if (error) {
      setError(error.message);
      return;
    }

    setMessage("If an account exists for that email, a reset link has been sent.");
  });
}

// ---- OAUTH (Google / Apple) ----
if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    clearMessages();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/" },
    });
    if (error) setError(error.message);
  });
}
if (appleBtn) {
  appleBtn.addEventListener("click", async () => {
    clearMessages();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: window.location.origin + "/" },
    });
    if (error) setError(error.message);
  });
}

// ---- LOG OUT ----
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    clearMessages();
    await supabase.auth.signOut();
    window.location.href = "/";
  });
}

// ---- PROFILE UI ----
function setLoggedOutUI() {
  if (accountGrid) hide(accountGrid);
  if (accountLoggedOut) show(accountLoggedOut, "block");

  if (headerAvatar) hide(headerAvatar);
  if (loginHeaderBtn) show(loginHeaderBtn, "inline-block");
  if (logoutBtn) hide(logoutBtn);
}

function setLoggedInHeader(user) {
  const initials = getInitials(user);
  if (headerAvatar) {
    headerAvatar.style.backgroundImage = "";
    headerAvatar.textContent = initials;
    show(headerAvatar, "inline-grid");
  }
  if (loginHeaderBtn) hide(loginHeaderBtn);
}

function fillProfileSummary(user) {
  const meta = user.user_metadata || {};

  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const displayName = (meta.display_name || "").trim();

  const nameToShow =
    first || last ? `${first} ${last}`.trim() : displayName || "Hemline Market member";

  if (profileName) profileName.textContent = nameToShow;
  if (profileEmail) profileEmail.textContent = user.email || "";

  const initials = getInitials(user);

  if (profileAvatar && !profileAvatar.style.backgroundImage) {
    profileAvatar.textContent = initials;
  }

  // Location
  const loc = (meta.location || "").trim();
  if (loc && profileLocationSummary) {
    profileLocationSummary.textContent = loc;
    show(profileLocationSummary, "block");
  } else if (profileLocationSummary) {
    hide(profileLocationSummary);
  }

  // Bio
  const bio = (meta.bio || "").trim();
  if (bio && profileBioSummary) {
    profileBioSummary.textContent = bio;
    show(profileBioSummary, "block");
  } else if (profileBioSummary) {
    hide(profileBioSummary);
  }

  // Website
  const website = (meta.website || "").trim();
  if (website && profileWebsite && profileWebsiteWrapper) {
    profileWebsite.href = website;
    profileWebsite.textContent = website;
    show(profileWebsiteWrapper, "block");
  } else if (profileWebsiteWrapper) {
    hide(profileWebsiteWrapper);
  }
}

function fillProfileForm(user) {
  const meta = user.user_metadata || {};

  if (firstNameInput) firstNameInput.value = meta.first_name || "";
  if (lastNameInput) lastNameInput.value = meta.last_name || "";
  if (locationInput) locationInput.value = meta.location || "";
  if (bioInput) bioInput.value = meta.bio || "";
  if (websiteInput) websiteInput.value = meta.website || "";
}

function isProfileIncomplete(user) {
  const meta = user.user_metadata || {};
  const hasAny =
    (meta.first_name && meta.first_name.trim()) ||
    (meta.last_name && meta.last_name.trim()) ||
    (meta.location && meta.location.trim()) ||
    (meta.bio && meta.bio.trim()) ||
    (meta.website && meta.website.trim());
  return !hasAny;
}

// Profile edit
if (editProfileBtn && profileForm) {
  editProfileBtn.addEventListener("click", () => {
    if (!currentUser) return;
    fillProfileForm(currentUser);
    show(profileForm, "block");
  });
}
if (cancelProfileEditBtn && profileForm) {
  cancelProfileEditBtn.addEventListener("click", () => {
    hide(profileForm);
  });
}
if (saveProfileBtn) {
  saveProfileBtn.addEventListener("click", async () => {
    if (!currentUser) return;

    const first = firstNameInput?.value.trim() || "";
    const last = lastNameInput?.value.trim() || "";
    const loc = locationInput?.value.trim() || "";
    const bio = bioInput?.value.trim() || "";
    const website = websiteInput?.value.trim() || "";

    const nameForDisplay =
      first || last
        ? `${first} ${last}`.trim()
        : currentUser.user_metadata?.display_name || "";

    try {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          ...currentUser.user_metadata,
          first_name: first || null,
          last_name: last || null,
          display_name: nameForDisplay || null,
          location: loc || null,
          bio: bio || null,
          website: website || null,
        },
      });

      if (error) {
        console.error("Error saving profile:", error);
        alert("There was a problem saving your profile. Please try again.");
        return;
      }

      currentUser = data.user;
      fillProfileSummary(currentUser);
      applyAvatarFromStorage(currentUser);
      hide(profileForm);
    } catch (e) {
      console.error(e);
      alert("There was a problem saving your profile. Please try again.");
    }
  });
}

// Avatar upload
if (avatarChangeBtn && avatarInput) {
  avatarChangeBtn.addEventListener("click", () => avatarInput.click());

  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (!currentUser) return;

      if (profileAvatar) {
        profileAvatar.style.backgroundImage = `url(${dataUrl})`;
        profileAvatar.textContent = "";
      }

      saveAvatarToStorage(currentUser, dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

// ---- SHIPPING HELPERS ----
function addressIsComplete(meta = {}) {
  return (
    meta.ship_from_name?.trim() &&
    meta.ship_from_street?.trim() &&
    meta.ship_from_city?.trim() &&
    meta.ship_from_zip?.trim()
  );
}

function ensureShippingSummaryUI() {
  if (!shippingSection || shipSummaryBox || !shipFromName) return;

  // Insert summary box after the explanatory paragraph (second child)
  const children = Array.from(shippingSection.children);
  const afterIndex =
    children.findIndex((el) => el.tagName === "P") !== -1
      ? children.findIndex((el) => el.tagName === "P")
      : 0;

  shipSummaryBox = document.createElement("div");
  shipSummaryBox.id = "shipSummaryBox";
  shipSummaryBox.style.margin = "6px 0 10px";
  shipSummaryBox.style.fontSize = "13px";
  shipSummaryBox.style.display = "none";

  shipSummaryBox.innerHTML = `
    <div id="shipSummaryLines" style="margin-bottom:6px;"></div>
    <button id="editAddressBtn" class="btn" type="button">Edit address</button>
  `;

  if (afterIndex >= 0 && children[afterIndex]) {
    children[afterIndex].insertAdjacentElement("afterend", shipSummaryBox);
  } else {
    shippingSection.insertBefore(shipSummaryBox, shippingSection.firstChild);
  }

  shipSummaryLines = document.getElementById("shipSummaryLines");
  editAddressBtn = document.getElementById("editAddressBtn");

  // Collect elements that belong to "edit mode" so we can hide/show them
  shipEditElements = [];
  shippingSection.querySelectorAll(".field").forEach((el) => {
    shipEditElements.push(el);
  });
  // The row wrapper with city/state/zip & the button row
  shippingSection.querySelectorAll("div[style*='flex'], div[style*='margin-top:10px']").forEach((el) => {
    shipEditElements.push(el);
  });

  // Add Cancel button next to Save button
  if (saveShippingSettingsBtn) {
    cancelShippingBtn = document.createElement("button");
    cancelShippingBtn.id = "cancelShippingEditBtn";
    cancelShippingBtn.type = "button";
    cancelShippingBtn.className = "btn";
    cancelShippingBtn.textContent = "Cancel";
    cancelShippingBtn.style.marginLeft = "8px";
    saveShippingSettingsBtn.parentElement.appendChild(cancelShippingBtn);
  }

  if (editAddressBtn) {
    editAddressBtn.addEventListener("click", () => {
      setShippingMode("edit");
      if (lastShippingMeta) {
        applyShippingMetaToInputs(lastShippingMeta);
      }
    });
  }

  if (cancelShippingBtn) {
    cancelShippingBtn.addEventListener("click", () => {
      if (lastShippingMeta) {
        applyShippingMetaToInputs(lastShippingMeta);
      }
      setShippingMode("summary");
    });
  }
}

function formatShippingLines(meta = {}) {
  const lines = [];

  const name = (meta.ship_from_name || "").trim();
  if (name) lines.push(name);

  let line1 = (meta.ship_from_street || "").trim();
  const apt = (meta.ship_from_street2 || "").trim();
  if (apt) {
    line1 = line1 ? `${line1}, ${apt}` : apt;
  }
  if (line1) lines.push(line1);

  const city = (meta.ship_from_city || "").trim();
  const state = (meta.ship_from_state || "").trim();
  const zip = (meta.ship_from_zip || "").trim();
  let cityLine = "";
  if (city) cityLine += city;
  if (state) cityLine += (cityLine ? ", " : "") + state;
  if (zip) cityLine += (cityLine ? " " : "") + zip;
  if (cityLine) lines.push(cityLine);

  const country = (meta.ship_from_country || "").trim();
  if (country) lines.push(country);

  return lines;
}

function updateShippingSummary(meta = {}) {
  if (!shipSummaryBox || !shipSummaryLines) return;
  const lines = formatShippingLines(meta);

  if (!lines.length) {
    shipSummaryBox.style.display = "none";
    shipSummaryLines.innerHTML = "";
    return;
  }

  shipSummaryLines.innerHTML = "";
  lines.forEach((text) => {
    const div = document.createElement("div");
    div.textContent = text;
    shipSummaryLines.appendChild(div);
  });
  shipSummaryBox.style.display = "block";
}

function setShippingMode(mode) {
  const edit = mode === "edit";

  shipEditElements.forEach((el) => {
    el.style.display = edit ? "" : "none";
  });

  if (saveShippingSettingsBtn) {
    saveShippingSettingsBtn.style.display = edit ? "inline-block" : "none";
  }
  if (cancelShippingBtn) {
    cancelShippingBtn.style.display = edit ? "inline-block" : "none";
  }
  if (shipSummaryBox) {
    const hasAddress = addressIsComplete(lastShippingMeta || {});
    shipSummaryBox.style.display = !edit && hasAddress ? "block" : "none";
  }
}

function applyShippingMetaToInputs(meta = {}) {
  if (shipFromName) shipFromName.value = meta.ship_from_name || "";
  if (shipFromStreet) shipFromStreet.value = meta.ship_from_street || "";
  if (shipFromStreet2) shipFromStreet2.value = meta.ship_from_street2 || "";
  if (shipFromCity) shipFromCity.value = meta.ship_from_city || "";
  if (shipFromState) shipFromState.value = meta.ship_from_state || "";
  if (shipFromZip) shipFromZip.value = meta.ship_from_zip || "";
  if (shipFromCountry && meta.ship_from_country) {
    shipFromCountry.value = meta.ship_from_country;
  } else if (shipFromCountry && !meta.ship_from_country) {
    shipFromCountry.value = "";
  }
}

// Fill both inputs + summary from user metadata
function fillShippingFromMeta(user) {
  const meta = user.user_metadata || {};
  ensureShippingSummaryUI();

  lastShippingMeta = {
    ship_from_name: meta.ship_from_name || "",
    ship_from_street: meta.ship_from_street || "",
    ship_from_street2: meta.ship_from_street2 || "",
    ship_from_city: meta.ship_from_city || "",
    ship_from_state: meta.ship_from_state || "",
    ship_from_zip: meta.ship_from_zip || "",
    ship_from_country: meta.ship_from_country || "",
    payouts_status: meta.payouts_status || "not_configured",
  };

  applyShippingMetaToInputs(lastShippingMeta);
  updateShippingSummary(lastShippingMeta);

  // Payouts status text + buttons
  const payoutsStatus = lastShippingMeta.payouts_status || "not_configured";
  if (payoutStatusText) {
    if (payoutsStatus === "active") {
      payoutStatusText.textContent =
        "Payouts are active. Stripe will send your earnings to your bank account.";
      if (payoutSetupBtn) hide(payoutSetupBtn);
      if (payoutManageBtn) show(payoutManageBtn, "inline-block");
    } else {
      payoutStatusText.textContent =
        "Set up payouts so we can send you money from your fabric sales.";
      if (payoutSetupBtn) show(payoutSetupBtn, "inline-block");
      if (payoutManageBtn) hide(payoutManageBtn);
    }
  }

  // Decide initial mode
  if (addressIsComplete(lastShippingMeta)) {
    setShippingMode("summary");
  } else {
    setShippingMode("edit");
  }
}

// Save shipping
if (saveShippingSettingsBtn) {
  saveShippingSettingsBtn.addEventListener("click", async () => {
    if (!currentUser) {
      alert("Please sign in to save your shipping address.");
      return;
    }

    const meta = currentUser.user_metadata || {};
    const updatedMeta = {
      ...meta,
      ship_from_name: shipFromName?.value.trim() || null,
      ship_from_street: shipFromStreet?.value.trim() || null,
      ship_from_street2: shipFromStreet2?.value.trim() || null,
      ship_from_city: shipFromCity?.value.trim() || null,
      ship_from_state: shipFromState?.value.trim() || null,
      ship_from_zip: shipFromZip?.value.trim() || null,
      ship_from_country: shipFromCountry?.value || null,
    };

    try {
      const { data, error } = await supabase.auth.updateUser({
        data: updatedMeta,
      });

      if (error) {
        console.error("Error saving shipping settings:", error);
        alert("There was a problem saving your shipping address.");
        return;
      }

      currentUser = data.user;
      fillShippingFromMeta(currentUser);
      alert("Shipping address saved for your labels.");
      setShippingMode("summary");
    } catch (e) {
      console.error(e);
      alert("There was a problem saving your shipping address.");
    }
  });
}

// ---- STRIPE PAYOUT BUTTONS ----
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

// ---- VACATION SWITCH (visual only) ----
if (vacSwitch) {
  vacSwitch.addEventListener("click", () => {
    const current = vacSwitch.getAttribute("data-on") === "true";
    vacSwitch.setAttribute("data-on", current ? "false" : "true");
  });
}

// ---- INITIAL LOAD ----
(async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("Error getting current user:", error);
    }

    currentUser = data?.user || null;

    if (!currentUser) {
      setLoggedOutUI();
      return;
    }

    // Logged-in UI
    if (accountLoggedOut) hide(accountLoggedOut);
    if (accountGrid) accountGrid.style.display = "grid";

    setLoggedInHeader(currentUser);
    fillProfileSummary(currentUser);
    fillProfileForm(currentUser);
    applyAvatarFromStorage(currentUser);
    fillShippingFromMeta(currentUser);

    if (logoutBtn) show(logoutBtn, "inline-block");

    // If profile is totally empty, open the form once
    if (isProfileIncomplete(currentUser) && profileForm) {
      show(profileForm, "block");
    }
  } catch (e) {
    console.error("Error during account initialization:", e);
    setLoggedOutUI();
  }
})();
