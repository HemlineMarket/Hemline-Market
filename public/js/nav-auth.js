import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

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
