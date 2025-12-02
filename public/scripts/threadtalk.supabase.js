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

// More robust YouTube ID parsing: handles youtu.be links and ?v=… with extra params
function getYouTubeVideoId(urlRaw) {
  try {
    const u = new URL(urlRaw);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      return v && v.length >= 11 ? v.slice(0, 11) : null;
    }

    if (host === "youtu.be") {
      const parts = u.pathname.split("/").filter(Boolean);
      const id = parts[0] || "";
      return id.length >= 11 ? id.slice(0, 11) : null;
    }
  } catch {
    // If URL constructor fails, fall through and return null
  }
  return null;
}

/**
 * Turn plain text into HTML with:
 * - Normal clickable links for non-YouTube URLs
 * - Embedded, *reasonably sized* YouTube iframes when a YouTube URL is present
 *
 * This is used by ThreadTalk.html via a MutationObserver after threadtalk.js
 * renders the cards.
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
      if (segment) html += escapeHtml(segment);
      continue;
    }

    // Odd index → URL
    const url = segment.trim();
    if (!url) continue;

    const videoId = getYouTubeVideoId(url);

    if (videoId) {
      // YouTube embed: capped width, 16:9, centered; plus a small raw-link line.
      html += `
        <div class="tt-embed tt-embed-youtube" style="margin-top:8px;">
          <div
            class="tt-embed-inner"
            style="
              position:relative;
              width:100%;
              max-width:640px;
              margin:0 auto;
              padding-top:56.25%;
              border-radius:12px;
              overflow:hidden;
            "
          >
            <iframe
              src="https://www.youtube.com/embed/${videoId}"
              title="YouTube video player"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              style="
                position:absolute;
                inset:0;
                width:100%;
                height:100%;
                border:0;
              "
            ></iframe>
          </div>
          <div
            class="tt-embed-link"
            style="
              margin-top:4px;
              font-size:12px;
              color:var(--hm-muted, #6b7280);
              word-break:break-all;
            "
          >
            <a href="${url}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(url)}
            </a>
          </div>
        </div>
      `;
    } else {
      // Non-YouTube URL → normal inline link.
      const label = url.length > 80 ? url.slice(0, 77) + "..." : url;
      html += `<span class="tt-inline-link">
        <a href="${url}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(label)}
        </a>
      </span>`;
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
