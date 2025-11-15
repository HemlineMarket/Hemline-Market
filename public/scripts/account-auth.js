// public/scripts/account-auth.js
import { supabase } from '/scripts/supabase-client.js';

/* -------------------------------------------------------
   1. Utility: show/hide the modal
------------------------------------------------------- */
const modal = document.getElementById("authModal");
const closeModalBtn = document.getElementById("authClose");
const openAvatar = document.getElementById("avatar");

function openModal() {
  if (modal) modal.classList.add("open");
}
function closeModal() {
  if (modal) modal.classList.remove("open");
}

openAvatar?.addEventListener("click", (e) => {
  e.preventDefault();
  openModal();
});

closeModalBtn?.addEventListener("click", () => {
  closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* -------------------------------------------------------
   2. Email Login
------------------------------------------------------- */
const loginEmail = document.getElementById("loginEmail");
const loginPassword = document.getElementById("loginPassword");
const loginBtn = document.getElementById("loginBtn");

loginBtn?.addEventListener("click", async () => {
  const email = loginEmail.value.trim();
  const pw = loginPassword.value.trim();
  if (!email || !pw) return alert("Enter email and password");

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: pw
  });

  if (error) return alert(error.message);
  location.reload();
});

/* -------------------------------------------------------
   3. Create Account
------------------------------------------------------- */
const signupEmail = document.getElementById("signupEmail");
const signupPassword = document.getElementById("signupPassword");
const createBtn = document.getElementById("createBtn");

createBtn?.addEventListener("click", async () => {
  const email = signupEmail.value.trim();
  const pw = signupPassword.value.trim();
  if (!email || !pw) return alert("Enter email and password");

  const { error } = await supabase.auth.signUp({
    email,
    password: pw
  });

  if (error) return alert(error.message);
  alert("Account created! Check your email to confirm.");
});

/* -------------------------------------------------------
   4. Forgot Password
------------------------------------------------------- */
const forgotBtn = document.getElementById("forgotBtn");

forgotBtn?.addEventListener("click", async () => {
  const email = loginEmail.value.trim();
  if (!email) return alert("Enter your email first");

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + "/reset.html"
  });

  if (error) return alert(error.message);
  alert("Password reset email sent!");
});

/* -------------------------------------------------------
   5. Login with Google
------------------------------------------------------- */
const googleBtn = document.getElementById("googleBtn");

googleBtn?.addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + "/account.html" }
  });
  if (error) alert(error.message);
});

/* -------------------------------------------------------
   6. Login with Apple
------------------------------------------------------- */
const appleBtn = document.getElementById("appleBtn");

appleBtn?.addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: { redirectTo: location.origin + "/account.html" }
  });
  if (error) alert(error.message);
});

/* -------------------------------------------------------
   7. On load: check session, update UI
------------------------------------------------------- */
(async function () {
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    // Hide the modal
    closeModal();

    // Replace avatar initials
    const email = session.user.email;
    const initials = email ? email.substring(0, 2).toUpperCase() : "AA";
    openAvatar.textContent = initials;
  }
})();
