import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO (next step): replace these with your real values
const SUPABASE_URL = "https://YOUR-PROJECT-URL.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const signinLink = document.getElementById("signin-link");
const accountLink = document.getElementById("account-link");
const signoutLink = document.getElementById("signout-link");

async function refresh() {
  const { data: { user } } = await supabase.auth.getUser();
  const signedIn = !!user;
  if (signinLink) signinLink.style.display = signedIn ? "none" : "inline";
  if (accountLink) accountLink.style.display = signedIn ? "inline" : "none";
  if (signoutLink) signoutLink.style.display = signedIn ? "inline" : "none";
}

refresh();
supabase.auth.onAuthStateChange(() => refresh());

signoutLink?.addEventListener("click", async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  location.reload();
});
