// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
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
  modal.classList.add("show");
}
function hideModal() {
  modal.classList.remove("show");
  errBox.textContent = "";
  msgBox.textContent = "";
}
function error(msg) {
  errBox.textContent = msg;
}
function message(msg) {
  msgBox.textContent = msg;
}

// ---- CLICK AVATAR ----
avatar.addEventListener("click", async (e) => {
  e.preventDefault();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) showModal();
});

// ---- CLOSE ----
closeBtn.addEventListener("click", hideModal);

// ---- LOGIN ----
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.textContent = "";
  message("");

  const email = document.getElementById("loginEmail").value.trim();
  const pw = document.getElementById("loginPassword").value.trim();

  const { error: err } = await supabase.auth.signInWithPassword({
    email,
    password: pw
  });

  if (err) return error(err.message);

  message("Logged in");
  setTimeout(() => window.location.reload(), 600);
});

// ---- SIGNUP ----
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errBox.textContent = "";
  message("");

  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const pw = document.getElementById("signupPassword").value.trim();

  const { error: err } = await supabase.auth.signUp({
    email,
    password: pw,
    options: { data: { display_name: name } }
  });

  if (err) return error(err.message);

  message("Account created. Check your email.");
});

// ---- FORGOT PASSWORD ----
document.getElementById("forgotPasswordBtn").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) return error("Enter your email");

  const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + "/reset.html"
  });

  if (err) return error(err.message);
  message("Reset email sent.");
});

// ---- GOOGLE ----
googleBtn.addEventListener("click", async () => {
  const { error: err } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.href }
  });
  if (err) error(err.message);
});

// ---- APPLE ----
appleBtn.addEventListener("click", async () => {
  const { error: err } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: window.location.href }
  });
  if (err) error(err.message);
});

// ---- LOGOUT ----
logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.reload();
});

// ---- LOAD USER ----
(async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Logged in
  accountGrid.style.display = "grid";
  logoutBtn.style.display = "inline-block";

  profileName.textContent = user.user_metadata?.display_name || "Profile";
  profileEmail.textContent = user.email || "";
})();
