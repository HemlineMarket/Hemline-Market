// public/scripts/shared-auth.js
// Simple shared login / signup / OAuth logic for auth.html

import { supabase } from "./supabase-client.js";

// ------- helpers -------
function $(id) {
  return document.getElementById(id);
}

const loginForm   = $("loginForm");
const signupForm  = $("signupForm");
const googleBtn   = $("googleBtn");
const appleBtn    = $("appleBtn");
const forgotBtn   = $("forgotPasswordBtn");
const magicBtn    = $("magicLinkBtn");
const errorBox    = $("authError");
const messageBox  = $("authMessage");

function setError(msg) {
  if (errorBox) errorBox.textContent = msg || "";
}

function setMessage(msg) {
  if (messageBox) messageBox.textContent = msg || "";
}

// ------- email/password login -------
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    const emailEl = $("loginEmail");
    const pwEl    = $("loginPassword");
    const email   = emailEl ? emailEl.value.trim() : "";
    const pw      = pwEl ? pwEl.value : "";

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password: pw,
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Logged in. Redirecting…");
        window.location.href = "/index.html";
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong signing in.");
    }
  });
}

// ------- email/password signup -------
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    const nameEl  = $("signupName");
    const emailEl = $("signupEmail");
    const pwEl    = $("signupPassword");

    const name  = nameEl ? nameEl.value.trim() : "";
    const email = emailEl ? emailEl.value.trim() : "";
    const pw    = pwEl ? pwEl.value : "";

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: pw,
        options: {
          data: { display_name: name || null },
        },
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Account created. Check your email to confirm.");
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating your account.");
    }
  });
}

// ------- forgot password -------
if (forgotBtn) {
  forgotBtn.addEventListener("click", async () => {
    setError("");
    setMessage("");

    const emailEl = $("loginEmail");
    const email   = emailEl ? emailEl.value.trim() : "";
    if (!email) {
      setError("Enter your email first.");
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset.html",
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Password reset email sent.");
      }
    } catch (err) {
      console.error(err);
      setError("Could not send reset email.");
    }
  });
}

// ------- magic link (optional) -------
if (magicBtn) {
  magicBtn.addEventListener("click", async () => {
    setError("");
    setMessage("");

    const emailEl = $("loginEmail");
    const email   = emailEl ? emailEl.value.trim() : "";
    if (!email) {
      setError("Enter your email first.");
      return;
    }

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin + "/index.html",
        },
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Check your email for a sign-in link.");
      }
    } catch (err) {
      console.error(err);
      setError("Could not send sign-in code.");
    }
  });
}

// ------- OAuth (Google / Apple) -------
async function startOAuth(provider) {
  setError("");
  setMessage("");
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + "/index.html",
      },
    });
    if (error) {
      setError(error.message);
    }
  } catch (err) {
    console.error(err);
    setError("Could not start " + provider + " sign-in.");
  }
}

if (googleBtn) {
  googleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    startOAuth("google");
  });
}

if (appleBtn) {
  appleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    startOAuth("apple");
  });
}
