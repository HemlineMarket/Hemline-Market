// scripts/threadtalk.supabase.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURE YOUR SUPABASE PROJECT ---
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- AUTH STATE HANDLING ---
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// --- POSTS CRUD ---
export async function loadPosts() {
  const { data, error } = await supabase
    .from("threadtalk_posts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) console.error("Error loading posts:", error);
  return data || [];
}

export async function createPost({ category, text, username }) {
  const user = await getCurrentUser();
  if (!user) {
    alert("You must be logged in to post!");
    return;
  }

  const { error } = await supabase.from("threadtalk_posts").insert([
    {
      user_id: user.id,
      username,
      category: category || "Loose Threads",
      text,
      created_at: new Date().toISOString(),
    },
  ]);

  if (error) console.error("Post error:", error);
  else console.log("Post added");
}

export async function deletePost(id) {
  const user = await getCurrentUser();
  if (!user) return;

  const { error } = await supabase
    .from("threadtalk_posts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) console.error("Delete error:", error);
}
