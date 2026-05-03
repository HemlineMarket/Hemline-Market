// api/thread/[id].js
// Server-renders a ThreadTalk post as a full HTML page.
// URL: /thread/123  → indexable by Google, shows real title/body/author
// The client-side ThreadTalk page still works for logged-in interaction.
//
// Fixes Search Console errors on DiscussionForumPosting:
//   1. "Invalid object type for field author" — was caused by microdata in the
//      <article> body (itemprop="author" on a plain text node). Microdata
//      attributes have been removed; JSON-LD is now the single source of truth.
//   2. "Missing field url (in author)" — author.url now points to
//      atelier.html?u={author_id} (the public seller storefront).
//   3. "Missing field url" — JSON-LD url is set; conflicting microdata removed.
//   4. "Missing field comment" — replies are now fetched and emitted as a
//      nested Comment[] array (with parent_comment_id → nested .comment).
//
// Also adds:
//   - BreadcrumbList JSON-LD (Home → ThreadTalk → Category → Thread).
//   - image[] in the JSON-LD when the post has a photo attachment.

const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";
const SITE_BASE = "https://hemlinemarket.com";

// Cap the number of comments serialized into JSON-LD to keep the page light.
const MAX_COMMENTS_IN_SCHEMA = 100;

const CATEGORY_LABELS = {
  showcase: "Showcase",
  cosplay: "Cosplay",
  "stitch-school": "Stitch School",
  "fabric-sos": "Fabric SOS",
  "before-after": "Before & After",
  "pattern-hacks": "Pattern Hacks",
  tailoring: "Tailoring",
  "loose-threads": "Loose Threads",
};

const CATEGORY_PAGES = {
  showcase: "showcase.html",
  cosplay: "cosplay.html",
  "stitch-school": "stitch-school.html",
  "fabric-sos": "fabric-sos.html",
  "before-after": "before-after.html",
  "pattern-hacks": "pattern-hacks.html",
  tailoring: "tailoring.html",
  "loose-threads": "loose-threads.html",
};

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

async function supabaseFetch(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// Serialize an object as JSON-LD safe to embed inside an HTML <script> tag.
// Escapes "<" so any user-supplied "</script>" inside titles/bodies/comments
// can't break out of the script block. Also escapes line separators that
// can break legacy JS parsers.
function safeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// ---------- JSON-LD helpers ----------

function displayName(profile) {
  if (!profile) return "Hemline Member";
  if (profile.store_name && profile.store_name.trim()) return profile.store_name.trim();
  const fullName = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  return fullName || "Hemline Member";
}

function authorUrl(authorId) {
  if (!authorId) return null;
  // /atelier/:id is the canonical SSR seller storefront page.
  return `${SITE_BASE}/atelier/${encodeURIComponent(authorId)}`;
}

function buildPerson(profile, authorId) {
  const person = {
    "@type": "Person",
    name: displayName(profile),
  };
  const url = authorUrl(authorId);
  if (url) person.url = url;
  return person;
}

// Recursively build a Comment node and any of its replies.
function buildCommentNode(comment, allComments, profilesById) {
  const node = {
    "@type": "Comment",
    text: comment.body || "",
    datePublished: comment.created_at,
    author: buildPerson(profilesById[comment.author_id], comment.author_id),
  };
  const replies = allComments.filter((c) => c.parent_comment_id === comment.id);
  if (replies.length > 0) {
    node.comment = replies.map((r) => buildCommentNode(r, allComments, profilesById));
  }
  return node;
}

function buildBreadcrumbs(categoryLabel, categoryPage, threadTitle, canonicalUrl) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Hemline Market",
        item: SITE_BASE + "/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "ThreadTalk",
        item: `${SITE_BASE}/ThreadTalk.html`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: categoryLabel,
        item: `${SITE_BASE}/${categoryPage}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: threadTitle,
        item: canonicalUrl,
      },
    ],
  };
}

// ---------- Handler ----------

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id || isNaN(Number(id))) {
    return res.status(400).send("Invalid thread ID");
  }

  // Fetch thread
  const threads = await supabaseFetch(
    `threadtalk_threads?id=eq.${id}&is_deleted=eq.false&limit=1`
  );
  if (!threads || threads.length === 0) {
    return res.status(404).send("Thread not found");
  }
  const thread = threads[0];

  // Fetch thread author profile
  let threadAuthorProfile = null;
  if (thread.author_id) {
    const profiles = await supabaseFetch(
      `profiles?id=eq.${thread.author_id}&select=id,store_name,first_name,last_name&limit=1`
    );
    if (profiles && profiles.length > 0) threadAuthorProfile = profiles[0];
  }

  // Fetch comments (full content, ordered, capped)
  const commentRows = await supabaseFetch(
    `threadtalk_comments?thread_id=eq.${id}&is_deleted=eq.false` +
      `&select=id,author_id,body,created_at,parent_comment_id` +
      `&order=created_at.asc&limit=${MAX_COMMENTS_IN_SCHEMA}`
  );
  const comments = commentRows || [];
  const commentCount = comments.length;

  // Batch-fetch comment author profiles in a single query.
  const commentAuthorIds = [
    ...new Set(comments.map((c) => c.author_id).filter(Boolean)),
  ];
  const profilesById = {};
  if (commentAuthorIds.length > 0) {
    const idsParam = commentAuthorIds.map(encodeURIComponent).join(",");
    const rows = await supabaseFetch(
      `profiles?id=in.(${idsParam})&select=id,store_name,first_name,last_name`
    );
    (rows || []).forEach((p) => {
      profilesById[p.id] = p;
    });
  }
  if (threadAuthorProfile) {
    profilesById[thread.author_id] = threadAuthorProfile;
  }

  const authorName = displayName(threadAuthorProfile);
  const categoryLabel = CATEGORY_LABELS[thread.category] || "ThreadTalk";
  const categoryPage = CATEGORY_PAGES[thread.category] || "ThreadTalk.html";
  const canonicalUrl = `${SITE_BASE}/thread/${id}`;
  const title = escapeHtml(thread.title || "ThreadTalk Post");
  const bodyText = escapeHtml(thread.body || "");
  const description = (thread.body || "").slice(0, 160).replace(/\n/g, " ");

  const isImage = thread.media_type === "image" && thread.media_url;
  const isVideo = thread.media_type === "video" && thread.media_url;

  // Build top-level comment nodes (those with no parent), each with their reply tree.
  const topLevelComments = comments
    .filter((c) => !c.parent_comment_id)
    .map((c) => buildCommentNode(c, comments, profilesById));

  // Build the DiscussionForumPosting JSON-LD.
  const postingSchema = {
    "@context": "https://schema.org",
    "@type": "DiscussionForumPosting",
    headline: thread.title,
    text: thread.body || "",
    url: canonicalUrl,
    datePublished: thread.created_at,
    author: buildPerson(threadAuthorProfile, thread.author_id),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/CommentAction",
      userInteractionCount: commentCount,
    },
    isPartOf: {
      "@type": "WebPage",
      url: `${SITE_BASE}/${categoryPage}`,
      name: `ThreadTalk — ${categoryLabel} • Hemline Market`,
    },
  };
  if (isImage) postingSchema.image = [thread.media_url];
  if (topLevelComments.length > 0) postingSchema.comment = topLevelComments;

  // Build BreadcrumbList JSON-LD.
  const breadcrumbSchema = buildBreadcrumbs(
    categoryLabel,
    categoryPage,
    thread.title || "ThreadTalk Post",
    canonicalUrl
  );

  const postingJsonLd = safeJsonLd(postingSchema);
  const breadcrumbJsonLd = safeJsonLd(breadcrumbSchema);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title} — ThreadTalk • Hemline Market</title>
  <meta name="description" content="${escapeHtml(description)}"/>
  <meta name="robots" content="index, follow"/>
  <link rel="canonical" href="${canonicalUrl}"/>

  <meta property="og:type" content="article"/>
  <meta property="og:url" content="${canonicalUrl}"/>
  <meta property="og:title" content="${title} — Hemline Market"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  ${isImage ? `<meta property="og:image" content="${escapeHtml(thread.media_url)}"/>` : `<meta property="og:image" content="${SITE_BASE}/images/og-image.jpg"/>`}
  <meta property="og:site_name" content="Hemline Market"/>

  <meta name="twitter:card" content="${isImage ? "summary_large_image" : "summary"}"/>
  <meta name="twitter:title" content="${title} — Hemline Market"/>
  <meta name="twitter:description" content="${escapeHtml(description)}"/>

  <script type="application/ld+json">${postingJsonLd}</script>
  <script type="application/ld+json">${breadcrumbJsonLd}</script>

  <link rel="icon" href="/favicon.ico"/>
  <link rel="stylesheet" href="/styles/hm-modern.css"/>
  <link rel="stylesheet" href="/styles/hm-header.css"/>
  <link rel="stylesheet" href="/styles/hm-typography.css"/>
  <link rel="stylesheet" href="/styles/hm-footer.css"/>

  <style>
    .tt-post-page { max-width: 720px; margin: 40px auto; padding: 0 20px 60px; }
    .tt-breadcrumb { font-size: 13px; color: #888; margin-bottom: 20px; }
    .tt-breadcrumb a { color: #c8a96e; text-decoration: none; }
    .tt-breadcrumb a:hover { text-decoration: underline; }
    .tt-post-card { background: #fff; border: 1px solid #e8e0d5; border-radius: 12px; padding: 28px 32px; }
    .tt-category-tag { display: inline-block; background: #f5efe8; color: #8b6914; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 20px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
    .tt-post-title { font-size: 24px; font-weight: 700; color: #1a1a1a; margin: 0 0 12px; line-height: 1.3; }
    .tt-post-meta { font-size: 13px; color: #888; margin-bottom: 20px; }
    .tt-post-meta strong { color: #444; }
    .tt-post-meta a { color: inherit; text-decoration: none; }
    .tt-post-meta a:hover { text-decoration: underline; }
    .tt-post-body { font-size: 16px; line-height: 1.7; color: #333; white-space: pre-wrap; word-break: break-word; }
    .tt-post-media { margin: 20px 0; }
    .tt-post-media img { max-width: 100%; border-radius: 8px; }
    .tt-post-media video { max-width: 100%; border-radius: 8px; }
    .tt-comment-count { margin-top: 20px; padding-top: 16px; border-top: 1px solid #f0e8dc; font-size: 14px; color: #888; }
    .tt-view-full { margin-top: 28px; text-align: center; }
    .tt-view-full a { display: inline-block; background: #1a1a1a; color: #fff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600; }
    .tt-view-full a:hover { background: #333; }
  </style>
</head>
<body>
  <div id="hm-header"></div>

  <main class="tt-post-page">
    <nav class="tt-breadcrumb" aria-label="Breadcrumb">
      <a href="/">Hemline Market</a> &rsaquo;
      <a href="/ThreadTalk.html">ThreadTalk</a> &rsaquo;
      <a href="/${escapeHtml(categoryPage)}">${escapeHtml(categoryLabel)}</a> &rsaquo;
      ${title}
    </nav>

    <article class="tt-post-card">
      <span class="tt-category-tag">${escapeHtml(categoryLabel)}</span>
      <h1 class="tt-post-title">${title}</h1>
      <p class="tt-post-meta">
        Posted by
        ${
          thread.author_id
            ? `<a href="/atelier/${escapeHtml(thread.author_id)}"><strong>${escapeHtml(authorName)}</strong></a>`
            : `<strong>${escapeHtml(authorName)}</strong>`
        }
        on <time datetime="${escapeHtml(thread.created_at)}">${formatDate(thread.created_at)}</time>
      </p>

      ${isImage ? `<div class="tt-post-media"><img src="${escapeHtml(thread.media_url)}" alt="${title}" loading="lazy"/></div>` : ""}
      ${isVideo ? `<div class="tt-post-media"><video src="${escapeHtml(thread.media_url)}" controls playsinline></video></div>` : ""}

      <div class="tt-post-body">${bodyText}</div>

      ${commentCount > 0 ? `<p class="tt-comment-count">💬 ${commentCount} comment${commentCount === 1 ? "" : "s"}</p>` : ""}

      <div class="tt-view-full">
        <a href="/${escapeHtml(categoryPage)}?thread=${id}">View full thread &amp; join the conversation →</a>
      </div>
    </article>
  </main>

  <div id="hm-footer"></div>

  <script src="/scripts/supabase-config.js"></script>
  <script src="/scripts/hm-shell.js"></script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(html);
}
