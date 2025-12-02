// scripts/threadtalk.supabase.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- CONFIGURE YOUR SUPABASE PROJECT ---
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- TEXT RENDERING (LINKS + YOUTUBE EMBEDS) ----------

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getYouTubeVideoId(url) {
  // Supports:
  // https://www.youtube.com/watch?v=VIDEOID
  // https://youtube.com/watch?v=VIDEOID
  // https://youtu.be/VIDEOID
  const watchMatch = url.match(
    /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^ ]*v=([a-zA-Z0-9_-]{11})/
  );
  if (watchMatch) return watchMatch[1];

  const shortMatch = url.match(
    /https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/
  );
  if (shortMatch) return shortMatch[1];

  return null;
}

/**
 * Turn plain text into HTML with:
 * - Normal clickable links for non-YouTube URLs
 * - Embedded YouTube iframes when a YouTube URL is present
 *
 * Use this in your UI code like:
 *   element.innerHTML = renderTextWithLinksAndEmbeds(post.text || "");
 */
export function renderTextWithLinksAndEmbeds(text) {
  if (!text) return "";

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  let html = "";

  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];

    // Even index → plain text
    if (i % 2 === 0) {
      html += escapeHtml(segment);
      continue;
    }

    // Odd index → URL
    const url = segment.trim();
    const videoId = getYouTubeVideoId(url);

    if (videoId) {
      // YouTube embed + small link under it
      html += `
        <div class="tt-embed tt-embed-youtube">
          <div class="tt-embed-inner">
            <iframe
              src="https://www.youtube.com/embed/${videoId}"
              title="YouTube video player"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
            ></iframe>
          </div>
          <div class="tt-embed-link">
            <a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(
              url
            )}</a>
          </div>
        </div>
      `;
    } else {
      // Non-YouTube URL → normal link
      const label = url.length > 80 ? url.slice(0, 77) + "..." : url;
      html += `<a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(
        label
      )}</a>`;
    }
  }

  return html;
}

// --- AUTH STATE HANDLING ---
export async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
