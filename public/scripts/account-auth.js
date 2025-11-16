// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- ELEMENTS ----

// Auth drawer
const modal = document.getElementById("authOverlay");
const closeBtn = document.getElementById("authCloseBtn");

// Header
const loginHeaderBtn = document.getElementById("loginHeaderBtn");
const headerInitials = document.getElementById("headerAvatar");

// Account layout
const accountGrid = document.getElementById("accountGrid");
const accountLoggedOut = document.getElementById("accountLoggedOut");

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

// Profile form fields
const firstNameInput = document.getElementById("firstNameInput");
const lastNameInput = document.getElementById("lastNameInput");
const locationInput = document.getElementById("locationInput");
const bioInput = document.getElementById("bioInput");
const websiteInput = document.getElementById("websiteInput");

// Logout
const logoutBtn = document.getElementById("logoutBtn");

// Auth forms
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const googleBtn = document.getElementById("googleBtn");
const appleBtn = document.getElementById("appleBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

const errBox = document.getElementById("authError");
const msgBox = document.getElementById("authMessage");

// Payouts & shipping (placeholders for wiring later)
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
const saveShippingSettingsBtn = document.getElementById("saveShippingAddressBtn") ||
                                document.getElementById("saveShippingSettingsBtn");

// Status
const vacSwitch = document.getElementById("vacSwitch");

// ---- SMALL HELPERS ----
function showModal() {
  if (!modal) return;
  modal.classList.add("show");
  clearMessages();
}

function hideModal() {
  if (!modal) return;
  modal.classList.remove("show");
  clearMessages();
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

function show(el, displayValue = "") {
  if (el) el.style.display = displayValue;
}

function hide(el) {
  if (el) el.style.display = "none";
}

// Build initials from name or email
function getInitialsForUser(user) {
  const meta = user?.user_metadata || {};
  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const display = (meta.display_name || "").trim();

  let source = "";

  if (first || last) {
    source = `${first} ${last}`.trim();
  } else if (display) {
    source = display;
  }

  if (source) {
    const parts = source.split(/\s+/);
    const a = parts[0]?.[0] || "";
    const b = parts[parts.length - 1]?.[0] || "";
    const letters = (a + b).toUpperCase();
    if (letters) return letters;
  }

  const email = user?.email || "";
  if (email) return email[0].toUpperCase();

  return "HM";
}

function getAvatarStorageKey(user) {
  if (!user?.id) return null;
  return `hm-avatar-${user.id}`;
}

function applyAvatarFromStorage(user) {
  const key = getAvatarStorageKey(user);
  if (!key) return;
  const dataUrl = window.localStorage.getItem(key);
  if (!dataUrl) return;

  if (profileAvatar) {
    profileAvatar.style.backgroundImage = `url(${dataUrl})`;
    profileAvatar.textContent = "";
  }
  if (headerInitials) {
    headerInitials.style.backgroundImage = `url(${dataUrl})`;
    headerInitials.textContent = "";
  }
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

// ---- AUTH DRAWER BEHAVIOR ----
if (loginHeaderBtn) {
  loginHeaderBtn.addEventListener("click", () => {
    showModal();
  });
}

if (closeBtn) {
  closeBtn.addEventListener("click", () => {
    hideModal();
  });
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
      if (error.message.toLowerCase().includes("invalid login")) {
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

// ---- GOOGLE ----
if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    clearMessages();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + "/",
      },
    });
    if (error) setError(error.message);
  });
}

// ---- APPLE ----
if (appleBtn) {
  appleBtn.addEventListener("click", async () => {
    clearMessages();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: window.location.origin + "/",
      },
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

// ---- PROFILE + ACCOUNT STATE ----

let currentUser = null;

function setLoggedOutUI() {
  hide(accountGrid);
  show(accountLoggedOut, "block");

  hide(headerInitials);
  if (loginHeaderBtn) show(loginHeaderBtn, "inline-block");
}

function setLoggedInHeader(user) {
  const initials = getInitialsForUser(user);

  if (headerInitials) {
    headerInitials.style.backgroundImage = "";
    headerInitials.textContent = initials;
    show(headerInitials, "inline-grid");
  }
  if (loginHeaderBtn) hide(loginHeaderBtn);
}

function fillProfileSummary(user) {
  const meta = user.user_metadata || {};

  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const displayName = (meta.display_name || "").trim();

  const nameToShow =
    (first || last) ? `${first} ${last}`.trim() :
    displayName || "Hemline Market member";

  if (profileName) {
    profileName.textContent = nameToShow;
  }
  if (profileEmail) {
    profileEmail.textContent = user.email || "";
  }

  const initials = getInitialsForUser(user);

  if (profileAvatar) {
    profileAvatar.style.backgroundImage = "";
    profileAvatar.textContent = initials;
  }

  // Location
  const loc = (meta.location || "").trim();
  if (loc) {
    if (profileLocationSummary) {
      profileLocationSummary.textContent = loc;
      show(profileLocationSummary, "block");
    }
  } else if (profileLocationSummary) {
    hide(profileLocationSummary);
  }

  // Bio
  const bio = (meta.bio || "").trim();
  if (bio) {
    if (profileBioSummary) {
      profileBioSummary.textContent = bio;
      show(profileBioSummary, "block");
    }
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

  // Payout status text (VERY light for now)
  const payoutsStatus = meta.payouts_status || "not_configured";
  if (payoutStatusText) {
    if (payoutsStatus === "active") {
      payoutStatusText.textContent =
        "Payouts are active. Stripe will send your earnings to your bank account.";
      hide(payoutSetupBtn);
      show(payoutManageBtn, "inline-block");
    } else {
      payoutStatusText.textContent =
        "Set up payouts so we can send you money from your fabric sales.";
      show(payoutSetupBtn, "inline-block");
      hide(payoutManageBtn);
    }
  }
}

// Initial load
(async () => {
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
  show(accountGrid, "grid");
  hide(accountLoggedOut);
  setLoggedInHeader(currentUser);
  fillProfileSummary(currentUser);
  fillProfileForm(currentUser);
  fillShippingFromMeta(currentUser);
  applyAvatarFromStorage(currentUser);

  if (logoutBtn) show(logoutBtn, "inline-block");

  // If profile is incomplete, open the form by default so they can fill it
  if (isProfileIncomplete(currentUser)) {
    if (profileForm) show(profileForm, "block");
  }
})();

// ---- PROFILE EDIT BEHAVIOR ----
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

    const nameForDisplay = (first || last)
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
      hide(profileForm);
    } catch (e) {
      console.error(e);
      alert("There was a problem saving your profile. Please try again.");
    }
  });
}

// ---- AVATAR PHOTO UPLOAD (localStorage-based persistence) ----
if (avatarChangeBtn && avatarInput) {
  avatarChangeBtn.addEventListener("click", () => {
    avatarInput.click();
  });

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

      // Apply to avatars
      if (profileAvatar) {
        profileAvatar.style.backgroundImage = `url(${dataUrl})`;
        profileAvatar.textContent = "";
      }
      if (headerInitials) {
        headerInitials.style.backgroundImage = `url(${dataUrl})`;
        headerInitials.textContent = "";
      }

      saveAvatarToStorage(currentUser, dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

// ---- SHIPPING ADDRESS SAVE (stored in user_metadata for now) ----
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
      alert("Shipping address saved for your labels.");
    } catch (e) {
      console.error(e);
      alert("There was a problem saving your shipping address.");
    }
  });
}

// ---- SIMPLE VACATION TOGGLE (visual only for now) ----
if (vacSwitch) {
  vacSwitch.addEventListener("click", () => {
    const current = vacSwitch.getAttribute("data-on") === "true";
    vacSwitch.setAttribute("data-on", current ? "false" : "true");
  });
}
