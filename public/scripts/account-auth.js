// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- LAYOUT FIX: stop cards from stretching to full row height ----
document.addEventListener("DOMContentLoaded", () => {
  const grid = document.querySelector(".grid");
  if (grid) {
    grid.querySelectorAll(":scope > *").forEach((el) => {
      el.style.alignSelf = "flex-start";
    });
  }
});

// ---- ELEMENTS ----

// Auth drawer (login panel)
const modal = document.getElementById("authOverlay");
const closeBtn = document.getElementById("authCloseBtn");

// Header pieces (on Account page)
const loginHeaderBtn = document.getElementById("loginHeaderBtn");
const headerInitials = document.getElementById("headerAvatar");

// Account layout
const accountGrid = document.getElementById("accountGrid");

// Simple profile display (Account > Profile card)
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileLocation = document.getElementById("profileLocation");
const profileBio = document.getElementById("profileBio");

// Logout button inside Profile card
const logoutBtn = document.getElementById("logoutBtn");

// Auth forms inside the drawer
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const googleBtn = document.getElementById("googleBtn");
const appleBtn = document.getElementById("appleBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");

const errBox = document.getElementById("authError");
const msgBox = document.getElementById("authMessage");

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

// Build initials from name/email/profile
function getInitials(user, profile) {
  // Prefer profile.full_name if we have it
  const fullName = (profile?.full_name || "").trim();
  if (fullName) {
    const parts = fullName.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    const a = parts[0][0] || "";
    const b = parts[1][0] || "";
    const letters = (a + b).toUpperCase();
    if (letters) return letters;
  }

  // Fall back to auth metadata display_name
  const meta = user?.user_metadata || {};
  const display = (meta.display_name || "").trim();
  if (display) {
    const parts = display.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    const a = parts[0][0] || "";
    const b = parts[1][0] || "";
    const letters = (a + b).toUpperCase();
    if (letters) return letters;
  }

  // Last resort: first two letters of email local-part
  const email = user?.email || "";
  if (email) {
    const local = email.split("@")[0] || "";
    if (local) return local.slice(0, 2).toUpperCase();
  }

  return "HM";
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

// Fetch or create a row in `profiles` for this user
async function fetchOrCreateProfile(user) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, tagline, location")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("Error loading profile:", error);
    }

    if (data) {
      return data;
    }

    // No row yet: create a basic one using display_name or email
    const meta = user.user_metadata || {};
    const displayName = (meta.display_name || "").trim();
    const fullName = displayName || user.email || "Hemline sewist";

    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        full_name: fullName,
        tagline: "",
        location: "",
      })
      .select("id, full_name, tagline, location")
      .single();

    if (insertError) {
      console.warn("Error creating profile row:", insertError);
      return {
        id: user.id,
        full_name: fullName,
        tagline: "",
        location: "",
      };
    }

    return inserted;
  } catch (e) {
    console.error("Unexpected error loading/creating profile:", e);
    return {
      id: user.id,
      full_name: user.email || "Hemline sewist",
      tagline: "",
      location: "",
    };
  }
}

function setLoggedOutUI() {
  if (accountGrid) hide(accountGrid);

  if (headerInitials) hide(headerInitials);
  if (loginHeaderBtn) show(loginHeaderBtn, "inline-block");
  if (logoutBtn) hide(logoutBtn);
}

function applyProfileUI(user, profile) {
  // Show account layout
  if (accountGrid) show(accountGrid, "block");

  // Header initials circle
  const initials = getInitials(user, profile);
  if (headerInitials) {
    headerInitials.style.backgroundImage = "";
    headerInitials.textContent = initials;
    show(headerInitials, "inline-grid");
  }
  if (loginHeaderBtn) hide(loginHeaderBtn);
  if (logoutBtn) show(logoutBtn, "inline-block");

  // Profile card fields
  if (profileName) {
    profileName.textContent =
      profile.full_name || user.email || "Hemline Market member";
  }
  if (profileEmail) {
    profileEmail.textContent = user.email || "";
  }
  if (profileLocation) {
    profileLocation.textContent = profile.location || "";
  }
  if (profileBio) {
    // Use tagline if set, otherwise keep whatever was in HTML
    if (profile.tagline && profile.tagline.trim()) {
      profileBio.textContent = profile.tagline;
    }
  }

  // If there's no custom avatar applied, show initials in the profile avatar
  if (profileAvatar && !profileAvatar.style.backgroundImage) {
    profileAvatar.textContent = initials;
  }
}

// Initial load: check session, then load profile
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

    const profile = await fetchOrCreateProfile(currentUser);
    applyProfileUI(currentUser, profile);
  } catch (e) {
    console.error("Error during account initialization:", e);
    setLoggedOutUI();
  }
})();
