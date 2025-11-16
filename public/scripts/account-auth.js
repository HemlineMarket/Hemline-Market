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

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");

const googleBtn = document.getElementById("googleBtn");
const appleBtn = document.getElementById("appleBtn");
const forgotPasswordBtn = document.getElementById("forgotPasswordBtn");
const logoutBtn = document.getElementById("logoutBtn");

const errBox = document.getElementById("authError");
const msgBox = document.getElementById("authMessage");

const accountGrid = document.getElementById("accountGrid");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileInitials = document.getElementById("profileAvatar");

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
      // Friendlier error messages
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

    // Supabase may require email confirmation depending on your settings.
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
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("Error getting current user:", error);
  }
  const user = data?.user || null;

  if (!user) {
    // Logged OUT state
    hide(accountGrid);
    hide(headerInitials);
    show(loginHeaderBtn, "inline-block");
    return;
  }

  // Logged IN state
  const initials = getInitialsForUser(user);

  if (headerInitials) {
    headerInitials.textContent = initials;
    show(headerInitials, "inline-grid");
  }

  if (profileInitials) {
    profileInitials.textContent = initials;
  }

  if (profileName) {
    profileName.textContent =
      user.user_metadata?.display_name || "Hemline Market member";
  }
  if (profileEmail) {
    profileEmail.textContent = user.email || "";
  }

  if (accountGrid) {
    accountGrid.style.display = "grid";
  }
  if (logoutBtn) {
    show(logoutBtn, "inline-block");
  }

  hide(loginHeaderBtn);
})();
