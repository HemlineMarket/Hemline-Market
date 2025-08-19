import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Replace with your actual values
const SUPABASE_URL = "https://YOUR-PROJECT-URL.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const message = document.getElementById("message");

// Sign in
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signInWithPassword({
    email: emailInput.value,
    password: passwordInput.value,
  });
  message.textContent = error ? error.message : "Signed in!";
});

// Sign up
document.getElementById("signup").addEventListener("click", async () => {
  const { error } = await supabase.auth.signUp({
    email: emailInput.value,
    password: passwordInput.value,
  });
  message.textContent = error ? error.message : "Signed up! Check your email.";
});

// Magic link
document.getElementById("magic").addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithOtp({
    email: emailInput.value,
  });
  message.textContent = error ? error.message : "Magic link sent!";
});
