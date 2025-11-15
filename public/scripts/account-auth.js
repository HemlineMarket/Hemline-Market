// public/scripts/account-auth.js
console.log("HM account-auth.js loaded");

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
// ⬇️ REPLACE these two with your real values from Supabase (Project Settings → API)
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON = "YOUR_ANON_KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- ELEMENTS ----
const modal = document.getElementById("authOverlay");
const closeBtn = document.getElementById("authCloseBtn");
const avatar = document.getElementById("avatar");

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");

const googleBtn = document.getElementById("googleBtn");
const appleBtn = document.getElementById("appleBtn");

const logoutBtn = document.getElementById("logoutBtn");

const errBox = document.getElementById("authError");
const msgBox = document.getElementById("authMessage");

const accountGrid = document.getElementById("accountGrid");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");

// ---- HELPERS ----
function showModal() {
  if (!modal) return;
  modal.classList.add("show");
}
function hideModal() {
  if (!modal) return;
  modal.classList.remove("show");
  if (errBox) errBox.textContent = "";
  if (msgBox) msgBox.textContent = "";
}
function error(msg) {
  if (errBox) errBox.textContent = msg;
}
function message(msg) {
  if (msgBox) msgBox.textContent = msg;
}

// ---- CLICK AVATAR ----
if (avatar) {
  avatar.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) showModal();
    } catch (e) {
      console.error("Error getting user:", e);
      error("Problem checking login.");
    }
  });
}

// ---- CLOSE ----
if (closeBtn) {
  closeBtn.addEventListener("click", hideModal);
}

// ---- LOGIN ----
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errBox) errBox.textContent = "";
    message("");

    const email = document.getElementById("loginEmail")?.value.trim();
    const pw = document.getElementById("loginPassword")?.value.trim();

    if (!email || !pw) return error("Email and password are required.");

    try {
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password: pw
      });

      if (err) return error(err.message);

      message("Logged in");
      setTimeout(() => window.location.reload(), 600);
    } catch (e2) {
      console.error("Login error:", e2);
      error("Could not log in.");
    }
  });
}

// ---- SIGNUP ----
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (errBox) errBox.textContent = "";
    message("");

    const name = document.getElementById("signupName")?.value.trim();
    const email = document.getElementById("signupEmail")?.value.trim();
    const pw = document.getElementById("signupPassword")?.value.trim();

    if (!name || !email || !pw) return error("All fields are required.");

    try {
      const { error: err } = await supabase.auth.signUp({
        email,
        password: pw,
        options: { data: { display_name: name } }
      });

      if (err) return error(err.message);

      message("Account created. Check your email.");
    } catch (e2) {
      console.error("Signup error:", e2);
      error("Could not create account.");
    }
  });
}

// ---- FORGOT PASSWORD ----
const forgotBtn = document.getElementById("forgotPasswordBtn");
if (forgotBtn) {
  forgotBtn.addEventListener("click", async () => {
    const email = document.getElementById("loginEmail")?.value.trim();
    if (!email) return error("Enter your email first.");

    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset.html"
      });

      if (err) return error(err.message);
      message("Reset email sent.");
    } catch (e2) {
      console.error("Reset error:", e2);
      error("Could not send reset email.");
    }
  });
}

// ---- GOOGLE ----
if (googleBtn) {
  googleBtn.addEventListener("click", async () => {
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.href }
      });
      if (err) error(err.message);
    } catch (e2) {
      console.error("Google OAuth error:", e2);
      error("Could not start Google login.");
    }
  });
}

// ---- APPLE ----
if (appleBtn) {
  appleBtn.addEventListener("click", async () => {
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: { redirectTo: window.location.href }
      });
      if (err) error(err.message);
    } catch (e2) {
      console.error("Apple OAuth error:", e2);
      error("Could not start Apple login.");
    }
  });
}

// ---- LOGOUT ----
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
      window.location.reload();
    } catch (e2) {
      console.error("Logout error:", e2);
      error("Could not log out.");
    }
  });
}

// ---- LOAD USER ON PAGE LOAD ----
(async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (accountGrid) accountGrid.style.display = "grid";
    if (logoutBtn) logoutBtn.style.display = "inline-block";

    if (profileName) {
      profileName.textContent = user.user_metadata?.display_name || "Profile";
    }
    if (profileEmail) {
      profileEmail.textContent = user.email || "";
    }
  } catch (e) {
    console.error("Init user load error:", e);
  }
})();
