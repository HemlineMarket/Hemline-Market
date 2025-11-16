// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- ELEMENTS ----
const modal = document.getElementById("authOverlay");
const closeBtn = document.getElementById("authCloseBtn");

// Header: big Log in button + initials circle
const loginHeaderBtn = document.getElementById("loginHeaderBtn");
const headerInitials = document.getElementById("headerAvatar");

// Auth forms inside the drawer
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");

const googleBtn = document.getElementById("googleBtn");
const appleBtn = document.getElementById("appleBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const logoutBtn = document.getElementById("logoutBtn");

const errBox = document.getElementById("authError");
const msgBox = document.getElementById("authMessage");

// Account layout
const accountGrid = document.getElementById("accountGrid");
const accountLoggedOut = document.getElementById("accountLoggedOut");

// Profile display
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileInitials = document.getElementById("profileAvatar");
const profileLocation = document.getElementById("profileLocation");
const profileMeta = document.getElementById("profileMeta");
const profileBio = document.getElementById("profileBio");
const profileWebsiteWrapper = document.getElementById("profileWebsiteWrapper");
const profileWebsite = document.getElementById("profileWebsite");

// Profile edit fields
const firstNameInput = document.getElementById("firstNameInput");
const lastNameInput = document.getElementById("lastNameInput");
const locationInput = document.getElementById("locationInput");
const bioInput = document.getElementById("bioInput");
const websiteInput = document.getElementById("websiteInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");

// Status / vacation hold
const vacSwitch = document.getElementById("vacSwitch");

// Hamburger / sheet
const openMenuBtn = document.getElementById("openMenu");
const closeMenuBtn = document.getElementById("closeMenu");
const menuSheet = document.getElementById("menuSheet");

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

// Build initials from Supabase user (fallback)
function getInitialsForUser(user) {
  const name = user?.user_metadata?.display_name || "";
  if (name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] || "";
    const last = parts[parts.length - 1]?.[0] || "";
    const letters = (first + last).toUpperCase();
    if (letters) return letters;
  }

  const email = user?.email || "";
  if (email) {
    return email[0].toUpperCase();
  }
  return "HM";
}

// Build initials from a full name, with user fallback
function getInitialsFromFullName(fullName, user) {
  if (fullName && fullName.trim()) {
    const parts = fullName.trim().split(/\s+/);
    const first = parts[0]?.[0] || "";
    const last = parts[1]?.[0] || "";
    const letters = (first + last).toUpperCase();
    if (letters) return letters;
  }
  return getInitialsForUser(user);
}

function applyInitials(initials) {
  if (headerInitials) headerInitials.textContent = initials;
  if (profileInitials) profileInitials.textContent = initials;
}

// Local storage key per user for profile fields
function profileStorageKey(userId) {
  return `hm_profile_${userId}`;
}

// Hydrate profile UI from stored data (or from Supabase display_name)
function hydrateProfile(user) {
  if (!user) return null;

  const key = profileStorageKey(user.id);
  let stored = null;

  try {
    const raw = localStorage.getItem(key);
    if (raw) stored = JSON.parse(raw);
  } catch (e) {
    console.warn("Error parsing stored profile", e);
  }

  let first = stored?.firstName || "";
  let last = stored?.lastName || "";
  let location = stored?.location || "";
  let bio = stored?.bio || "";
  let website = stored?.website || "";

  const nothingStored = !first && !last && !location && !bio && !website;

  if (nothingStored) {
    const displayName = user.user_metadata?.display_name || "";
    if (displayName.trim()) {
      const parts = displayName.trim().split(/\s+/);
      first = parts[0] || "";
      last = parts.slice(1).join(" ");
    }
  }

  // Fill inputs
  if (firstNameInput) firstNameInput.value = first;
  if (lastNameInput) lastNameInput.value = last;
  if (locationInput) locationInput.value = location;
  if (bioInput) bioInput.value = bio;
  if (websiteInput) websiteInput.value = website;

  // Display section
  const fullName =
    (first + " " + last).trim() ||
    user.user_metadata?.display_name ||
    "Hemline Market member";

  if (profileName) profileName.textContent = fullName;
  if (profileEmail) profileEmail.textContent = user.email || "";

  if (profileLocation) {
    if (location) {
      profileLocation.textContent = location;
      profileLocation.style.display = "block";
    } else {
      profileLocation.style.display = "none";
    }
  }

  if (profileBio) {
    profileBio.textContent = bio || "";
  }

  if (profileWebsiteWrapper && profileWebsite) {
    if (website) {
      profileWebsiteWrapper.style.display = "block";
      profileWebsite.textContent = website;
      profileWebsite.href = website;
    } else {
      profileWebsiteWrapper.style.display = "none";
    }
  }

  if (profileMeta) {
    if (bio || website) {
      profileMeta.style.display = "block";
    } else {
      profileMeta.style.display = "none";
    }
  }

  return fullName;
}

// Wire "Save profile" button
function wireProfileSave(user) {
  if (!saveProfileBtn || !user) return;

  saveProfileBtn.addEventListener("click", () => {
    if (!firstNameInput || !lastNameInput || !locationInput || !bioInput || !websiteInput) {
      return;
    }

    const first = firstNameInput.value.trim();
    const last = lastNameInput.value.trim();
    const location = locationInput.value.trim();
    const bio = bioInput.value.trim();
    const website = websiteInput.value.trim();

    const fullName =
      (first + " " + last).trim() ||
      user.user_metadata?.display_name ||
      "Hemline Market member";

    const payload = { firstName: first, lastName: last, location, bio, website };

    try {
      localStorage.setItem(profileStorageKey(user.id), JSON.stringify(payload));
    } catch (e) {
      console.warn("Unable to save profile locally", e);
    }

    // Update display
    if (profileName) profileName.textContent = fullName;
    if (profileLocation) {
      if (location) {
        profileLocation.textContent = location;
        profileLocation.style.display = "block";
      } else {
        profileLocation.style.display = "none";
      }
    }
    if (profileBio) profileBio.textContent = bio || "";

    if (profileWebsiteWrapper && profileWebsite) {
      if (website) {
        profileWebsiteWrapper.style.display = "block";
        profileWebsite.textContent = website;
        profileWebsite.href = website;
      } else {
        profileWebsiteWrapper.style.display = "none";
      }
    }
    if (profileMeta) {
      if (bio || website) {
        profileMeta.style.display = "block";
      } else {
        profileMeta.style.display = "none";
      }
    }

    const initials = getInitialsFromFullName(fullName, user);
    applyInitials(initials);

    alert("Profile saved");
  });
}

// Vacation hold toggle
function wireVacationHold(user) {
  if (!vacSwitch) return;

  const key = user ? `hm_vacation_hold_${user.id}` : "hm_vacation_hold";

  const applyState = (on) => {
    vacSwitch.setAttribute("data-on", on ? "true" : "false");
  };

  let saved = null;
  try {
    saved = localStorage.getItem(key);
  } catch (e) {
    // ignore
  }

  applyState(saved === "true");

  const toggle = () => {
    const current = vacSwitch.getAttribute("data-on") === "true";
    const next = !current;
    applyState(next);
    try {
      localStorage.setItem(key, String(next));
    } catch (e) {
      // ignore
    }
  };

  vacSwitch.addEventListener("click", toggle);
  vacSwitch.addEventListener("keypress", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
}

// Hamburger / sheet
function wireHamburger() {
  if (!openMenuBtn || !closeMenuBtn || !menuSheet) return;

  const openSheet = () => {
    menuSheet.classList.add("open");
    menuSheet.setAttribute("aria-hidden", "false");
    openMenuBtn.setAttribute("aria-expanded", "true");
  };

  const closeSheet = () => {
    menuSheet.classList.remove("open");
    menuSheet.setAttribute("aria-hidden", "true");
    openMenuBtn.setAttribute("aria-expanded", "false");
  };

  openMenuBtn.addEventListener("click", openSheet);
  closeMenuBtn.addEventListener("click", closeSheet);

  menuSheet.addEventListener("click", (e) => {
    if (e.target === menuSheet) {
      closeSheet();
    }
  });
}

// ---- HEADER BEHAVIOR ----

// Big "Log in" button: open modal
if (loginHeaderBtn) {
  loginHeaderBtn.addEventListener("click", () => {
    showModal();
  });
}

// Close button in modal
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

// ---- INITIAL SESSION LOAD ----
(async () => {
  wireHamburger();

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("Error getting current user:", error);
  }
  const user = data?.user || null;

  if (!user) {
    // Logged OUT state
    hide(accountGrid);
    if (accountLoggedOut) show(accountLoggedOut, "block");
    hide(headerInitials);
    show(loginHeaderBtn, "inline-block");
    return;
  }

  // Logged IN state
  if (accountLoggedOut) hide(accountLoggedOut);
  if (accountGrid) show(accountGrid, "grid");
  hide(loginHeaderBtn);

  // Fill profile from storage / metadata
  const fullName = hydrateProfile(user);

  // Apply initials
  const initials = getInitialsFromFullName(fullName, user);
  applyInitials(initials);

  // Ensure email is set (in case hydrateProfile didn't yet)
  if (profileEmail) profileEmail.textContent = user.email || "";

  if (logoutBtn) show(logoutBtn, "inline-block");

  // Wire per-user features
  wireProfileSave(user);
  wireVacationHold(user);
})();
