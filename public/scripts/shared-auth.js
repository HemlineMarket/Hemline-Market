// public/scripts/shared-auth.js
// Shared login/signup + OAuth logic for auth.html

import { supabase } from "./supabase-client.js";

// --------- DOM HELPERS ----------
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

function setBusy(isBusy) {
  const allButtons = [
    $("loginSubmit"),
    $("signupSubmit"),
    googleBtn,
    appleBtn,
    forgotBtn,
    magicBtn
  ].filter(Boolean);

  allButtons.forEach(b => {
    b.disabled = !!isBusy;
  });

  if (isBusy) {
    setMessage("Checking session…");
  } else if (messageBox && messageBox.textContent === "Checking session…") {
    setMessage("");
  }
}

// --------- SESSION CHECK ----------
(async () => {
  try {
    setBusy(true);
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("supabase.getSession error", error);
    }

    // If already logged in, go to homepage (your preference)
    if (data && data.session) {
      window.location.href = "/index.html";
      return;
    }
  } catch (e) {
    console.error(e);
  } finally {
    setBusy(false);
  }
})();

// --------- EMAIL / PASSWORD LOGIN ----------
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);

    const email = (document.getElementById("loginEmail") || {}).value?.trim();
    const password = (document.getElementById("loginPassword") || {}).value || "";

   try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Logged in. Redirecting…");
        // send them to homepage
        window.location.href = "/index.html";
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong signing in.");
    } finally {
      setBusy(false);
    }
  });
}

// --------- EMAIL / PASSWORD SIGNUP ----------
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);

    const name  = (document.getElementById("signupName") || {}).value?.trim();
    const email = (document.getElementById("signupEmail") || {}).value?.trim();
    const pw    = (document.getElementById("signupPassword") || {}).value || "";

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password: pw,
        options: {
          data: { display_name: name || null }
        }
      });

      if (error) {
        setError(error.message);
      } else {
        setMessage("Account created. Check your email to confirm.");
      }
    } catch (err) {
      console.error(err);
      setError("Something went wrong creating your account.");
    } finally {
      setBusy(false);
    }
  });
}

// --------- FORGOT PASSWORD ----------
if (forgotBtn) {
  forgotBtn.addEventListener("click", async () => {
    setError("");
    setMessage("");

    const email = (document.getElementById("loginEmail") || {}).value?.trim();
    if (!email) {
      setError("Enter your email first.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + "/reset.html"
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Password reset email sent.");
      }
    } catch (err) {
      console.error(err);
      setError("Could not send reset email.");
    } finally {
      setBusy(false);
    }
  });
}

// --------- MAGIC LINK (OPTIONAL) ----------
if (magicBtn) {
  magicBtn.addEventListener("click", async () => {
    setError("");
    setMessage("");

    const email = (document.getElementById("loginEmail") || {}).value?.trim();
    if (!email) {
      setError("Enter your email first.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + "/index.html" }
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Check your email for a sign-in link.");
      }
    } catch (err) {
      console.error(err);
      setError("Could not send sign-in code.");
    } finally {
      setBusy(false);
    }
  });
}

// --------- OAUTH (GOOGLE / APPLE) ----------
async function startOAuth(provider) {
  setError("");
  setMessage("");
  setBusy(true);
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: window.location.origin + "/index.html"
      }
    });
    if (error) {
      setBusy(false); // Supabase won’t redirect if there’s an error
      setError(error.message);
    }
  } catch (err) {
    console.error(err);
    setBusy(false);
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
