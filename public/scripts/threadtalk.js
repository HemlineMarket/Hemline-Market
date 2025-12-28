// scripts/threadtalk.js
// ThreadTalk: threads + comments + reactions + search (Supabase-backed, FB-style UI)

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.warn(
      "[ThreadTalk] Supabase client not found on window.HM.supabase; ThreadTalk disabled."
    );
    return;
  }

  // Optional per-page category filter: <body data-thread-category="showcase">
  const THREAD_CATEGORY_FILTER =
    document.body &&
    document.body.dataset &&
    document.body.dataset.threadCategory
      ? document.body.dataset.threadCategory
      : null;

  // ---------- DOM ----------
  const cardsEl = document.getElementById("cards");
  const emptyStateEl = document.getElementById("emptyState");
  const toastEl = document.getElementById("toast") || makeToastElement();

  const composerForm = document.getElementById("composer");
  const categorySelect = document.getElementById("composeCategory");
  const titleInput = document.getElementById("composeTitle");
  const textArea = document.getElementById("composeText");
  const photoInput = document.getElementById("photoInput");
  const videoInput = document.getElementById("videoInput");
  const mediaPreview = document.getElementById("mediaPreview");
  const postBtn = document.getElementById("postBtn");

  const searchInput = document.getElementById("threadSearch");

  // ---------- Constants ----------
  const STORAGE_BUCKET = "threadtalk-media";

  const CATEGORY_LABELS = {
    showcase: "Showcase",
    tailoring: "Tailoring",
    "stitch-school": "Stitch School",
    "fabric-sos": "Fabric SOS",
    "before-after": "Before & After",
    "pattern-hacks": "Pattern Hacks",
    "stash-confessions": "Stash Confessions",
    "loose-threads": "Loose Threads",
  };

  const CATEGORY_LINKS = {
    showcase: "showcase.html",
    tailoring: "tailoring.html",
    "stitch-school": "stitch-school.html",
    "fabric-sos": "fabric-sos.html",
    "before-after": "before-after.html",
    "pattern-hacks": "pattern-hacks.html",
    "stash-confessions": "stash-confessions.html",
    "loose-threads": "loose-threads.html",
  };

  const REACTION_TYPES = [
    { key: "like", emoji: "👍" },
    { key: "love", emoji: "❤️" },
    { key: "laugh", emoji: "😂" },
    { key: "wow", emoji: "😮" },
    { key: "cry", emoji: "😢" },
  ];

  // ---------- State ----------
  let currentUser = null;
  const profilesCache = {};
  let allThreads = [];
  let threads = [];
  let commentsByThread = {};
  let reactionsByThread = {};
  let commentReactionsByComment = {};
  const expandedCommentsThreads = new Set();

  // thread id from URL (?thread=123)
  const urlParams = new URLSearchParams(window.location.search || "");
  const THREAD_URL_ID = urlParams.get("thread")
    ? Number(urlParams.get("thread"))
    : null;

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    injectCompactStyles();
    await refreshCurrentUser();
    wireComposer();
    wireMediaInputs();
    wireCardDelegates();
    wireSearch();
    wireZoomClose();
    wireGlobalPickerClose();
    await loadThreads();
  }

  // ---------- Auth ----------
  async function refreshCurrentUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) return (currentUser = null);
      currentUser = data?.user || null;
      if (currentUser && !profilesCache[currentUser.id]) {
        await loadProfiles([currentUser.id]);
      }
    } catch (_) {
      currentUser = null;
    }
  }

  async function ensureLoggedInFor(actionLabel) {
    if (currentUser) return true;
    await refreshCurrentUser();
    if (!currentUser) {
      showToast(`Please sign in to ${actionLabel || "do that"} in ThreadTalk.`);
      return false;
    }
    return true;
  }

  async function loadProfiles(userIds) {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!ids.length) return;

    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, store_name, first_name, last_name, avatar_url")
        .in("id", ids);

      (data || []).forEach((p) => (profilesCache[p.id] = p));
    } catch (_) {
      // ignore
    }
  }

  function displayNameForUserId(userId) {
    const p = profilesCache[userId];
    if (!p) return "Unknown member";
    if (p.store_name?.trim()) return p.store_name.trim();
    const first = (p.first_name || "").trim();
    const last = (p.last_name || "").trim();
    return (first + " " + (last ? last[0] + "." : "")).trim() || "Unknown member";
  }

  // Get avatar HTML for a user - shows photo if available, placeholder SVG otherwise
  function getAvatarHtml(userId) {
    const p = profilesCache[userId];
    
    if (p?.avatar_url) {
      const name = displayNameForUserId(userId);
      return `<img src="${escapeAttr(p.avatar_url)}" alt="${escapeAttr(name)}" />`;
    }
    // Default placeholder SVG
    return '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
  }

  // Get avatar HTML for current user (for composer)
  function getCurrentUserAvatarHtml() {
    if (!currentUser) {
      return '<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>';
    }
    return getAvatarHtml(currentUser.id);
  }

  // Update the composer avatar element with current user's avatar
  function updateComposerAvatar() {
    const composerAvatar = composerForm?.querySelector('.composer-avatar');
    if (composerAvatar && currentUser) {
      composerAvatar.innerHTML = getCurrentUserAvatarHtml();
    }
  }

  // ---------- Load threads ----------
  async function loadThreads() {
    try {
      let query = supabase
        .from("threadtalk_threads")
        .select(
          "id, author_id, category, title, body, media_url, media_type, created_at, is_deleted"
        )
        .eq("is_deleted", false);

      // If a specific thread id is requested, ignore category filter and just fetch that one.
      if (THREAD_URL_ID) {
        query = query.eq("id", THREAD_URL_ID);
      } else if (THREAD_CATEGORY_FILTER) {
        query = query.eq("category", THREAD_CATEGORY_FILTER);
      }

      query = query.order("created_at", { ascending: false }).limit(100);

      const { data: threadRows, error: threadErr } = await query;
      if (threadErr) {
        console.error("[ThreadTalk] loadThreads threads error", threadErr);
        showToast("Could not load threads.");
        return;
      }

      allThreads = threadRows || [];

      if (!allThreads.length) {
        threads = [];
        if (cardsEl) cardsEl.innerHTML = "";
        if (emptyStateEl) emptyStateEl.style.display = "block";
        return;
      }

      const threadIds = allThreads.map((t) => t.id);
      const authorIds = allThreads.map((t) => String(t.author_id)).filter(Boolean);

      // normalize
      allThreads = allThreads.map((t) => ({ ...t, author_id: String(t.author_id) }));

      // Load comments (including parent_comment_id for nesting)
      const { data: commentRows, error: commentErr } = await supabase
        .from("threadtalk_comments")
        .select(
          "id, thread_id, author_id, body, media_url, media_type, created_at, is_deleted, parent_comment_id"
        )
        .in("thread_id", threadIds);

      if (commentErr) {
        console.error("[ThreadTalk] loadThreads comments error", commentErr);
      }

      commentsByThread = {};
      const commentIds = [];

      (commentRows || [])
        .filter((c) => !c.is_deleted)
        .forEach((c) => {
          if (!commentsByThread[c.thread_id]) {
            commentsByThread[c.thread_id] = [];
          }
          commentsByThread[c.thread_id].push(c);
          commentIds.push(c.id);
          if (c.author_id) authorIds.push(String(c.author_id));
          c.author_id = String(c.author_id);
        });

      // Load comment reactions
      commentReactionsByComment = {};
      if (commentIds.length) {
        const { data: cReactRows, error: cReactErr } = await supabase
          .from("threadtalk_comment_reactions")
          .select("comment_id, user_id, reaction_type")
          .in("comment_id", commentIds);

        if (cReactErr) {
          console.error(
            "[ThreadTalk] loadThreads comment reactions error",
            cReactErr
          );
        }

        (cReactRows || []).forEach((r) => {
          if (!commentReactionsByComment[r.comment_id]) {
            commentReactionsByComment[r.comment_id] = [];
          }
          commentReactionsByComment[r.comment_id].push(r);
          authorIds.push(r.user_id);
        });
      }

      // Thread reactions
      const { data: reactionRows, error: reactErr } = await supabase
        .from("threadtalk_reactions")
        .select("thread_id, user_id, reaction_type")
        .in("thread_id", threadIds);

      if (reactErr) {
        console.error("[ThreadTalk] loadThreads thread reactions error", reactErr);
      }

      reactionsByThread = {};
      (reactionRows || []).forEach((r) => {
        if (!reactionsByThread[r.thread_id]) {
          reactionsByThread[r.thread_id] = [];
        }
        reactionsByThread[r.thread_id].push(r);
        authorIds.push(r.user_id);
      });

      await loadProfiles(authorIds);
      applySearchFilter();
    } catch (err) {
      console.error("[ThreadTalk] loadThreads error", err);
      showToast("Could not load threads.");
    }
  }

  // ---------- Search ----------
  function wireSearch() {
    if (!searchInput) return;
    searchInput.addEventListener("input", applySearchFilter);
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applySearchFilter();
      }
    });
  }

  function applySearchFilter() {
    const q = (searchInput?.value || "").trim().toLowerCase();

    // Base list: full list or filtered by search text
    let base = !q
      ? allThreads.slice()
      : allThreads.filter((t) => {
          const title = (t.title || "").toLowerCase();
          const body = (t.body || "").toLowerCase();
          return title.includes(q) || body.includes(q);
        });

    // If ?thread=123 is present, show only that one
    if (THREAD_URL_ID) {
      base = base.filter((t) => Number(t.id) === THREAD_URL_ID);
    }

    threads = base;
    renderThreads();
  }

  // ---------- Comment tree helpers ----------
  function buildCommentTree(comments) {
    if (!comments || !comments.length) return [];

    const byId = {};
    comments.forEach((c) => {
      c.children = [];
      byId[c.id] = c;
    });

    const roots = [];
    comments.forEach((c) => {
      if (c.parent_comment_id && byId[c.parent_comment_id]) {
        byId[c.parent_comment_id].children.push(c);
      } else {
        roots.push(c);
      }
    });

    const sortByCreated = (arr) => {
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      arr.forEach((c) => c.children && sortByCreated(c.children));
    };
    sortByCreated(roots);

    return roots;
  }

  function renderCommentTree(threadId, nodes, depth) {
    if (!nodes || !nodes.length) return "";
    return nodes
      .map((c) => {
        const selfHtml = renderCommentHtml(threadId, c, depth);
        const childrenHtml =
          c.children && c.children.length
            ? `<div class="tt-comment-children">${renderCommentTree(
                threadId,
                c.children,
                depth + 1
              )}</div>`
            : "";
        return selfHtml + childrenHtml;
      })
      .join("");
  }

  // ---------- Rendering ----------
  function renderThreads() {
    if (!cardsEl) return;
    cardsEl.innerHTML = "";
    if (emptyStateEl) {
      emptyStateEl.style.display = threads.length ? "none" : "block";
    }

    threads.forEach((thread) => {
      const card = document.createElement("article");
      card.className = "card";
      card.dataset.threadId = String(thread.id);

      const authorName = displayNameForUserId(thread.author_id);
      const catSlug = thread.category || "loose-threads";
      const catLabel = CATEGORY_LABELS[catSlug] || "Loose Threads";
      const catLink = CATEGORY_LINKS[catSlug] || "loose-threads.html";
      const when = timeAgo(thread.created_at);
      const title = (thread.title || "").trim();

      const threadRows = reactionsByThread[thread.id] || [];
      const { counts: threadCounts, mine: threadMine } =
        computeReactionState(threadRows);
      const myType =
        REACTION_TYPES.find((r) => threadMine[r.key])?.key || null;

      const comments = commentsByThread[thread.id] || [];
      const mediaHtml = renderMedia(thread);

      // Replies collapsed by default; expand only after click
      const isExpanded = expandedCommentsThreads.has(thread.id);
      const commentTree = isExpanded ? buildCommentTree(comments) : [];
      const commentsHtml = renderCommentTree(thread.id, commentTree, 0);

      const isMine = currentUser && thread.author_id === currentUser.id;

      const menuHtml = isMine
        ? `
        <div class="tt-menu">
          <button class="tt-menu-btn" type="button" data-tt-role="menu">···</button>
          <div class="tt-menu-pop" data-tt-role="menu-pop" hidden>
            <button class="tt-menu-item" data-tt-role="edit-thread" type="button">Edit</button>
            <button class="tt-menu-item danger" data-tt-role="delete-thread" type="button">Delete</button>
          </div>
        </div>`
        : "";

      const showRepliesButton = comments.length && !isExpanded;

      const hiddenHtml = showRepliesButton
        ? `<button class="tt-more-comments" type="button" data-tt-role="show-all-comments">
             View all ${comments.length} repl${
               comments.length === 1 ? "y" : "ies"
             }…
           </button>`
        : "";

      let chipsHtml = "";
      REACTION_TYPES.forEach((r) => {
        const count = threadCounts[r.key];
        if (count) {
          chipsHtml += `
            <span class="tt-react-chip">
              <span class="tt-react-emoji">${r.emoji}</span>
              <span class="tt-react-count">${count}</span>
            </span>`;
        }
      });
      const reactionSummaryHtml = chipsHtml
        ? `<div class="tt-react-summary">${chipsHtml}</div>`
        : "";

      const pickerHtml =
        '<div class="tt-react-picker" data-tt-role="thread-picker">' +
        REACTION_TYPES.map(
          (r) =>
            `<button class="tt-react-pill"
                type="button"
                data-tt-role="thread-react"
                data-reaction="${r.key}">
              <span>${r.emoji}</span>
             </button>`
        ).join("") +
        "</div>";

      // author link → Atelier (using ?u= to match existing atelier.html)
      const authorHtml = thread.author_id
        ? `<a class="card-author" href="atelier.html?u=${encodeURIComponent(thread.author_id)}">${escapeHtml(authorName)}</a>`
        : `<span class="card-author">${escapeHtml(authorName)}</span>`;

      // Get user avatar (photo or initials)
      const avatarHtml = getAvatarHtml(thread.author_id);
      const currentUserAvatar = getCurrentUserAvatarHtml();

      card.innerHTML = `
        <div class="card-header">
          <div class="card-avatar">${avatarHtml}</div>
          <div class="card-meta">
            ${authorHtml}
            <div class="card-info">
              <span>${when}</span> · <a href="${catLink}">${escapeHtml(catLabel)}</a>
            </div>
            ${title ? `<div class="card-title">${escapeHtml(title)}</div>` : ""}
          </div>
          ${isMine ? `<button class="card-menu" type="button" data-tt-role="menu">···</button>` : ""}
        </div>

        <div class="card-body">${linkify(thread.body || "")}</div>
        ${mediaHtml ? `<div class="card-media">${mediaHtml}</div>` : ""}

        ${reactionSummaryHtml ? `<div class="card-reactions">${reactionSummaryHtml}</div>` : ""}

        <div class="card-actions">
          <button class="card-action${myType ? " active" : ""}" type="button" data-tt-role="thread-like-toggle">
            <svg viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
            Like
          </button>
          <button class="card-action" type="button" data-tt-role="focus-comment-input">
            <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            Comment
          </button>
          <button class="card-action share-btn" type="button" data-tt-role="share-thread">
            <svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
            Share
          </button>
        </div>

        <div class="card-comments">
          ${comments.length && !isExpanded ? `<button class="view-comments" type="button" data-tt-role="show-all-comments">View all ${comments.length} comment${comments.length === 1 ? "" : "s"}</button>` : ""}
          <div class="comments-list">${commentsHtml}</div>
          <div class="comment-input-row">
            <div class="comment-avatar">${currentUserAvatar}</div>
            <input class="comment-input" type="text" maxlength="500" placeholder="Write a comment..."/>
            <div class="comment-tools">
              <label class="comment-tool photo" title="Add photo">
                <svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
                <input type="file" accept="image/*" data-tt-role="comment-photo" hidden>
              </label>
              <label class="comment-tool video" title="Add video">
                <svg viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
                <input type="file" accept="video/*" data-tt-role="comment-video" hidden>
              </label>
            </div>
            <button class="comment-send" type="button" data-tt-role="send-comment">Post</button>
          </div>
        </div>
      `;

      // Link preview card (YouTube + normal sites) – no iframe
      attachLinkPreview(card, thread);

      cardsEl.appendChild(card);
    });
  }

  // ---------- Render each comment ----------
  function renderCommentHtml(threadId, c, depth) {
    const d = depth || 0;
    const name = displayNameForUserId(c.author_id);
    const ts = timeAgo(c.created_at);

    const reactions = commentReactionsByComment[c.id] || [];
    const { counts, mine } = computeReactionState(reactions);
    const myType = REACTION_TYPES.find((r) => mine[r.key])?.key || null;

    let chipsHtml = "";
    REACTION_TYPES.forEach((r) => {
      const count = counts[r.key];
      if (count) {
        chipsHtml += `
          <span class="tt-react-chip">
            <span class="tt-react-emoji">${r.emoji}</span>
            <span class="tt-react-count">${count}</span>
          </span>`;
      }
    });

    const summaryHtml = chipsHtml
      ? `<div class="tt-react-summary tt-react-summary-comment">${chipsHtml}</div>`
      : "";

    const deleteHtml =
      currentUser && c.author_id === currentUser.id
        ? `
      <div class="tt-menu tt-menu-comment">
        <button class="tt-menu-btn"
                type="button"
                data-tt-role="comment-menu">···</button>
        <div class="tt-menu-pop"
             data-tt-role="comment-menu-pop"
             hidden>
          <button class="tt-menu-item"
                  type="button"
                  data-tt-role="edit-comment"
                  data-comment-id="${c.id}">
            Edit
          </button>
          <button class="tt-menu-item danger"
                  type="button"
                  data-tt-role="delete-comment"
                  data-comment-id="${c.id}">
            Delete
          </button>
        </div>
      </div>`
        : "";

    const pickerHtml =
      `<div class="tt-react-picker" data-tt-role="comment-picker" data-comment-id="${c.id}">` +
      REACTION_TYPES.map(
        (r) =>
          `<button class="tt-react-pill"
                    type="button"
                    data-tt-role="comment-react"
                    data-comment-id="${c.id}"
                    data-reaction="${r.key}">
            <span>${r.emoji}</span>
          </button>`
      ).join("") +
      "</div>";

    const mediaHtml = renderCommentMedia(c);

    // author link → Atelier for comments (using ?u=)
    const authorHtml = c.author_id
      ? `<a class="comment-author" href="atelier.html?u=${encodeURIComponent(c.author_id)}">${escapeHtml(name)}</a>`
      : `<span class="comment-author">${escapeHtml(name)}</span>`;

    // Get user avatar (photo or initials)
    const commentAvatarHtml = getAvatarHtml(c.author_id);

    // Get current user avatar for reply box
    const replyAvatarHtml = getCurrentUserAvatarHtml();

    return `
      <div class="tt-comment comment${d > 0 ? ' nested' : ''}${d > 1 ? ' nested-deep' : ''}" data-comment-id="${c.id}" data-thread-id="${threadId}" data-depth="${d}">
        <div class="comment-avatar">${commentAvatarHtml}</div>
        <div class="comment-content">
          <div class="comment-bubble">
            ${authorHtml}
            <div class="comment-text">${linkify(c.body)}</div>
          </div>
          ${mediaHtml}
          <div class="comment-meta">
            <button type="button" class="${myType ? 'active' : ''}" data-tt-role="comment-like-toggle" data-comment-id="${c.id}">Like</button>
            <button type="button" data-tt-role="respond-comment" data-comment-id="${c.id}">Reply</button>
            <span>${ts}</span>
            ${chipsHtml}
          </div>
          <div class="tt-comment-reply-box" hidden data-parent-comment-id="${c.id}">
            <div class="comment-avatar reply-avatar">${replyAvatarHtml}</div>
            <input class="tt-comment-input" type="text" maxlength="500" placeholder="Write a reply..." />
            <button class="comment-send" type="button" data-tt-role="send-comment-reply">Post</button>
          </div>
        </div>
      </div>`;
  }

  // ---------- Media rendering ----------
  function renderMedia(thread) {
    if (!thread.media_url || !thread.media_type) return "";

    // Handle multiple images
    if (thread.media_type === "images") {
      try {
        const urls = JSON.parse(thread.media_url);
        if (Array.isArray(urls) && urls.length) {
          const imagesHtml = urls.map(url => `
            <img class="post-img post-img-multi"
                 src="${escapeAttr(url)}"
                 alt="Post image"
                 data-tt-role="zoom-img"/>
          `).join("");
          return `<div class="post-media-wrap post-media-grid">${imagesHtml}</div>`;
        }
      } catch (e) {
        console.warn("[ThreadTalk] Could not parse multiple images", e);
      }
    }

    const src = escapeAttr(thread.media_url);

    if (thread.media_type === "image") {
      return `
        <div class="post-media-wrap">
          <img class="post-img"
               src="${src}"
               alt="Post image"
               data-tt-role="zoom-img"/>
        </div>`;
    }

    if (thread.media_type === "video") {
      return `
        <div class="post-media-wrap">
          <video class="post-video" controls src="${src}"></video>
        </div>`;
    }

    return "";
  }

  function renderCommentMedia(c) {
    if (!c.media_url || !c.media_type) return "";
    const src = escapeAttr(c.media_url);

    if (c.media_type === "image") {
      return `
        <div class="tt-comment-media">
          <img class="post-img"
               src="${src}"
               alt="Reply image"
               data-tt-role="zoom-img"/>
        </div>`;
    }

    if (c.media_type === "video") {
      return `
        <div class="tt-comment-media">
          <video class="post-video" controls src="${src}"></video>
        </div>`;
    }

    return "";
  }

  // ---------- Reaction state helpers ----------
  function computeReactionState(rows) {
    const counts = { like: 0, love: 0, laugh: 0, wow: 0, cry: 0 };
    const mine = { like: false, love: false, laugh: false, wow: false, cry: false };

    rows.forEach((r) => {
      if (counts[r.reaction_type] != null) {
        counts[r.reaction_type] += 1;
      }
      if (currentUser && r.user_id === currentUser.id) {
        mine[r.reaction_type] = true;
      }
    });

    return { counts, mine };
  }

  // ---------- Notifications helper ----------
  async function createThreadNotification({
    recipientId,
    threadId,
    commentId,
    type,
    message,
  }) {
    if (!currentUser || !recipientId || recipientId === currentUser.id) return;

    try {
      const href = `ThreadTalk.html?thread=${threadId}`;

      // Note: Only inserting columns that exist in the notifications table
      // The thread_id and comment_id are encoded in the href URL instead
      const { error } = await supabase.from("notifications").insert({
        user_id: recipientId,          // recipient
        type,                          // "thread_reaction", "comment_reply", etc.
        kind: "threadtalk",            // used by notifications.html as pill label
        title: message,                // main line in notifications list
        body: message,                 // secondary line (same text for now)
        href,                          // notifications.html prefers href / link
        link: href,
      });

      if (error) {
        console.warn("[ThreadTalk] notification insert error", error);
      }
    } catch (err) {
      console.warn("[ThreadTalk] notification exception", err);
    }
  }

  // ---------- Composer ----------
  function wireComposer() {
    if (!composerForm) return;

    // Update composer avatar when user is logged in
    updateComposerAvatar();

    composerForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      let body = (textArea.value || "").trim();
      let title = (titleInput?.value || "").trim();
      let cat = categorySelect?.value || "loose-threads";

      const hasMedia = !!(photoInput?.files?.[0] || videoInput?.files?.[0]);

      if (!title) {
        titleInput?.focus();
        showToast("Add a post title.");
        return;
      }

      if (!body && !hasMedia) {
        textArea.focus();
        return;
      }

      const ok = await ensureLoggedInFor("post");
      if (!ok) return;

      postBtn.disabled = true;

      try {
        const mediaInfo = await maybeUploadComposerMedia();
        if (!body && hasMedia) body = "image attached";

        const payload = {
          author_id: currentUser.id,
          category: cat,
          title,
          body,
          media_url: mediaInfo.media_url,
          media_type: mediaInfo.media_type,
        };

        const { data, error } = await supabase
          .from("threadtalk_threads")
          .insert(payload)
          .select()
          .single();

        if (error) {
          console.error("[ThreadTalk] thread insert error", error);
          showToast("Could not post.");
          return;
        }

        // No notification here: it's the author's own thread.

        textArea.value = "";
        titleInput.value = "";
        clearMediaPreview();

        allThreads.unshift(data);
        applySearchFilter();
        showToast("Posted");
      } catch (err) {
        console.error("[ThreadTalk] composer exception", err);
        showToast("Could not post.");
      } finally {
        postBtn.disabled = false;
      }
    });
  }

  async function maybeUploadComposerMedia() {
    if (!currentUser) return { media_url: null, media_type: null };

    // Check for video first (single file)
    const videoFile = videoInput?.files?.[0];
    if (videoFile) {
      try {
        const ext = videoFile.name.split(".").pop().toLowerCase();
        const path = `${currentUser.id}/thread-${Date.now()}.${ext}`;

        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, videoFile, {
            cacheControl: "3600",
            upsert: false,
            contentType: videoFile.type,
          });

        if (error) {
          console.error("[ThreadTalk] upload error", error);
          showToast("Upload failed.");
          return { media_url: null, media_type: null };
        }

        const { data: pub } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(data.path);

        return {
          media_url: pub?.publicUrl || null,
          media_type: "video",
        };
      } catch (err) {
        console.error("[ThreadTalk] upload exception", err);
        showToast("Upload failed.");
        return { media_url: null, media_type: null };
      }
    }

    // Handle multiple images
    const photoFiles = photoInput?.files;
    if (!photoFiles || photoFiles.length === 0) {
      return { media_url: null, media_type: null };
    }

    const files = Array.from(photoFiles).slice(0, 4);
    const uploadedUrls = [];

    for (const file of files) {
      try {
        const ext = file.name.split(".").pop().toLowerCase();
        const path = `${currentUser.id}/thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

        const { data, error } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type,
          });

        if (error) {
          console.error("[ThreadTalk] upload error", error);
          continue;
        }

        const { data: pub } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(data.path);

        if (pub?.publicUrl) {
          uploadedUrls.push(pub.publicUrl);
        }
      } catch (err) {
        console.error("[ThreadTalk] upload exception", err);
      }
    }

    if (uploadedUrls.length === 0) {
      showToast("Upload failed.");
      return { media_url: null, media_type: null };
    }

    // Store multiple URLs as JSON array string for multi-image support
    // Single image: store as plain URL for backward compatibility
    if (uploadedUrls.length === 1) {
      return {
        media_url: uploadedUrls[0],
        media_type: "image",
      };
    }

    return {
      media_url: JSON.stringify(uploadedUrls),
      media_type: "images", // plural indicates multiple
    };
  }

  async function maybeUploadCommentMedia(file) {
    if (!currentUser || !file) return { media_url: null, media_type: null };

    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const path = `${currentUser.id}/comment-${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });

      if (error) {
        console.error("[ThreadTalk] upload reply error", error);
        showToast("Upload failed.");
        return { media_url: null, media_type: null };
      }

      const { data: pub } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(data.path);

      return {
        media_url: pub?.publicUrl || null,
        media_type: "image", // replies only allow image for now
      };
    } catch (err) {
      console.error("[ThreadTalk] upload reply exception", err);
      showToast("Upload failed.");
      return { media_url: null, media_type: null };
    }
  }

  // ---------- Media preview ----------
  function wireMediaInputs() {
    if (!photoInput || !videoInput || !mediaPreview) return;

    photoInput.addEventListener("change", () => {
      if (photoInput.files?.length) {
        videoInput.value = "";
        // Limit to 4 photos
        const files = Array.from(photoInput.files).slice(0, 4);
        showMultiplePreview(files, "image");
      }
    });

    videoInput.addEventListener("change", () => {
      if (videoInput.files?.[0]) {
        photoInput.value = "";
        showPreview(videoInput.files[0], "video");
      }
    });
  }

  function showMultiplePreview(files, kind) {
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = "";

    files.forEach((file, idx) => {
      const url = URL.createObjectURL(file);
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:relative;display:inline-block;margin-right:8px;";
      
      if (kind === "image") {
        const img = document.createElement("img");
        img.src = url;
        img.alt = `Preview image ${idx + 1}`;
        wrapper.appendChild(img);
      }
      
      // Add remove button
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.style.cssText = "position:absolute;top:2px;right:2px;background:#000;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:14px;line-height:1;";
      removeBtn.addEventListener("click", () => {
        wrapper.remove();
        if (mediaPreview.children.length === 0) {
          mediaPreview.hidden = true;
          photoInput.value = "";
        }
      });
      wrapper.appendChild(removeBtn);
      
      mediaPreview.appendChild(wrapper);
    });
    
    if (files.length >= 4) {
      showToast("Maximum 4 images per post");
    }
  }

  function showPreview(file, kind) {
    const url = URL.createObjectURL(file);
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = "";

    if (kind === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Preview image";
      mediaPreview.appendChild(img);
    } else {
      const vid = document.createElement("video");
      vid.controls = true;
      vid.src = url;
      mediaPreview.appendChild(vid);
    }
  }

  function clearMediaPreview() {
    mediaPreview.hidden = true;
    mediaPreview.innerHTML = "";
    if (photoInput) photoInput.value = "";
    if (videoInput) videoInput.value = "";
  }

  // ---------- Picker closing ----------
  function closeAllPickers() {
    document
      .querySelectorAll(".tt-like-wrapper.tt-picker-open")
      .forEach((el) => el.classList.remove("tt-picker-open"));
  }

  function wireGlobalPickerClose() {
    document.addEventListener("click", (e) => {
      const inside =
        e.target.closest(".tt-like-wrapper") ||
        e.target.closest(".tt-react-picker");

      if (!inside) closeAllPickers();

      const menuBtn = e.target.closest(".tt-menu-btn");
      const menuPop = e.target.closest(".tt-menu-pop");

      if (!menuBtn && !menuPop) {
        document
          .querySelectorAll(".tt-menu-pop")
          .forEach((el) => el.setAttribute("hidden", "true"));
      }
    });
  }

  // ---------- Card interaction delegation ----------
  function wireCardDelegates() {
    if (!cardsEl) return;

    cardsEl.addEventListener("click", async (e) => {
      const roleEl = e.target.closest("[data-tt-role]");
      if (!roleEl) return;

      const role = roleEl.dataset.ttRole;
      const card = roleEl.closest(".card");
      const threadId = card ? Number(card.dataset.threadId) : null;

      switch (role) {
        case "thread-like-toggle": {
          const ok = await ensureLoggedInFor("react");
          if (!ok) return;
          const wrapper = roleEl.closest(".tt-like-wrapper");
          const isOpen = wrapper.classList.contains("tt-picker-open");
          closeAllPickers();
          if (!isOpen) wrapper.classList.add("tt-picker-open");
          break;
        }

        case "thread-react": {
          const type = roleEl.dataset.reaction;
          if (threadId && type) {
            closeAllPickers();
            await handleThreadReaction(threadId, type);
          }
          break;
        }

        case "respond":
          focusCommentBox(card);
          break;

        case "focus-comment-input":
          focusCommentBox(card);
          break;

        case "respond-comment": {
          const commentEl = roleEl.closest(".tt-comment");
          if (!commentEl) break;
          const box = commentEl.querySelector(".tt-comment-reply-box");
          if (!box) break;
          const hidden = box.hasAttribute("hidden");
          if (hidden) {
            box.removeAttribute("hidden");
          } else {
            box.setAttribute("hidden", "true");
          }
          const input = box.querySelector(".tt-comment-input");
          if (input) input.focus();
          break;
        }

        case "show-all-comments":
          if (threadId) {
            expandedCommentsThreads.add(threadId);
            renderThreads();
          }
          break;

        case "send-comment":
          if (threadId) await handleSendComment(roleEl, threadId);
          break;

        case "send-comment-reply":
          if (threadId) await handleSendComment(roleEl, threadId);
          break;

        case "comment-like-toggle": {
          const ok2 = await ensureLoggedInFor("react");
          if (!ok2) return;
          const wrapper2 = roleEl.closest(".tt-like-wrapper");
          const isOpen2 = wrapper2.classList.contains("tt-picker-open");
          closeAllPickers();
          if (!isOpen2) wrapper2.classList.add("tt-picker-open");
          break;
        }

        case "comment-react": {
          const commentId = Number(roleEl.dataset.commentId);
          const type2 = roleEl.dataset.reaction;
          if (commentId && type2) {
            closeAllPickers();
            await handleCommentReaction(commentId, type2);
          }
          break;
        }

        case "comment-menu": {
          const pop = roleEl
            .closest(".tt-menu")
            ?.querySelector('[data-tt-role="comment-menu-pop"]');
          const hidden2 = pop.hasAttribute("hidden");
          document
            .querySelectorAll('[data-tt-role="comment-menu-pop"]')
            .forEach((el) => el.setAttribute("hidden", "true"));
          if (hidden2 && pop) pop.removeAttribute("hidden");
          break;
        }

        case "delete-comment": {
          const commentId2 = Number(roleEl.dataset.commentId);
          if (commentId2) await handleDeleteComment(commentId2);
          break;
        }

        case "edit-comment": {
          const commentId3 = Number(roleEl.dataset.commentId);
          if (commentId3) handleEditComment(commentId3);
          break;
        }

        case "menu":
          toggleMenu(card);
          break;

        case "edit-thread":
          if (threadId) await handleEditThread(card, threadId);
          break;

        case "delete-thread":
          if (threadId) await handleDeleteThread(threadId);
          break;

        case "share-thread":
          if (threadId) await handleShareThread(threadId, e);
          break;

        case "zoom-img":
          openZoomModal(roleEl.getAttribute("src"));
          break;
      }
    });
  }

  // ---------- Reactions ----------
  async function handleThreadReaction(threadId, type) {
    if (!REACTION_TYPES.find((r) => r.key === type)) return;
    const ok = await ensureLoggedInFor("react");
    if (!ok) return;

    const existing = (reactionsByThread[threadId] || []).filter(
      (r) => r.user_id === currentUser.id
    );

    try {
      if (existing.length === 1 && existing[0].reaction_type === type) {
        const { error } = await supabase
          .from("threadtalk_reactions")
          .delete()
          .match({
            thread_id: threadId,
            user_id: currentUser.id,
            reaction_type: type,
          });
        if (error) {
          console.warn("[ThreadTalk] reaction delete error", error);
          showToast("Could not update reaction.");
          return;
        }
      } else {
        if (existing.length) {
          const { error: delErr } = await supabase
            .from("threadtalk_reactions")
            .delete()
            .match({
              thread_id: threadId,
              user_id: currentUser.id,
            });
          if (delErr) {
            console.warn("[ThreadTalk] reaction switch delete error", delErr);
            showToast("Could not update reaction.");
            return;
          }
        }

        const { error: insErr } = await supabase
          .from("threadtalk_reactions")
          .insert({
            thread_id: threadId,
            user_id: currentUser.id,
            reaction_type: type,
          });

        if (insErr) {
          console.warn("[ThreadTalk] reaction insert error", insErr);
          showToast("Could not update reaction.");
          return;
        }

        // Notify thread author about reaction
        const thread = allThreads.find((t) => t.id === threadId);
        if (
          thread &&
          thread.author_id &&
          currentUser &&
          thread.author_id !== currentUser.id
        ) {
          const actorName = displayNameForUserId(currentUser.id);
          const titleText = thread.title || "";

          await createThreadNotification({
            recipientId: thread.author_id,
            threadId,
            commentId: null,
            type: "thread_reaction",
            message: `${actorName} reacted to your thread "${titleText}"`,
          });
        }
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleThreadReaction exception", err);
      showToast("Could not update reaction.");
    }
  }

  async function handleCommentReaction(commentId, type) {
    if (!REACTION_TYPES.find((r) => r.key === type)) return;
    const ok = await ensureLoggedInFor("react");
    if (!ok) return;

    const existing = (commentReactionsByComment[commentId] || []).filter(
      (r) => r.user_id === currentUser.id
    );

    try {
      if (existing.length === 1 && existing[0].reaction_type === type) {
        const { error } = await supabase
          .from("threadtalk_comment_reactions")
          .delete()
          .match({
            comment_id: commentId,
            user_id: currentUser.id,
            reaction_type: type,
          });
        if (error) {
          console.warn("[ThreadTalk] comment reaction delete error", error);
          showToast("Could not update reaction.");
          return;
        }
      } else {
        if (existing.length) {
          const { error: delErr } = await supabase
            .from("threadtalk_comment_reactions")
            .delete()
            .match({
              comment_id: commentId,
              user_id: currentUser.id,
            });
          if (delErr) {
            console.warn(
              "[ThreadTalk] comment reaction switch delete error",
              delErr
            );
            showToast("Could not update reaction.");
            return;
          }
        }

        const { error: insErr } = await supabase
          .from("threadtalk_comment_reactions")
          .insert({
            comment_id: commentId,
            user_id: currentUser.id,
            reaction_type: type,
          });

        if (insErr) {
          console.warn("[ThreadTalk] comment reaction insert error", insErr);
          showToast("Could not update reaction.");
          return;
        }

        // Notify comment author about reaction
        let targetComment = null;
        let parentThread = null;

        for (const [tid, list] of Object.entries(commentsByThread)) {
          const found = list.find((c) => c.id === commentId);
          if (found) {
            targetComment = found;
            parentThread = allThreads.find((t) => t.id === Number(tid));
            break;
          }
        }

        if (
          targetComment &&
          parentThread &&
          targetComment.author_id &&
          currentUser &&
          targetComment.author_id !== currentUser.id
        ) {
          const actorName = displayNameForUserId(currentUser.id);
          const titleText = parentThread.title || "";

          await createThreadNotification({
            recipientId: targetComment.author_id,
            threadId: parentThread.id,
            commentId,
            type: "comment_reaction",
            message: `${actorName} reacted to your comment on "${titleText}"`,
          });
        }
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleCommentReaction exception", err);
      showToast("Could not update reaction.");
    }
  }

  // ---------- Send / reply to comments ----------
  async function handleSendComment(row, threadId) {
    if (!threadId) return;

    const ok = await ensureLoggedInFor("comment");
    if (!ok) return;

    // Figure out which input + file input we are using
    let container =
      row.closest(".tt-comment-reply-box") ||
      row.closest(".tt-comment-new");
    if (!container) return;

    const input = container.querySelector(".tt-comment-input");
    const fileInput = container.querySelector(".tt-comment-photo");

    let body = (input?.value || "").trim();
    const file = fileInput?.files?.[0] || null;

    if (!body && !file) {
      if (input) input.focus();
      return;
    }

    // parent_comment_id for nested replies
    let parentCommentId = null;
    const replyBox = row.closest(".tt-comment-reply-box");
    if (replyBox && replyBox.dataset.parentCommentId) {
      const parsed = Number(replyBox.dataset.parentCommentId);
      if (Number.isFinite(parsed)) {
        parentCommentId = parsed;
      }
    }

    // Optional media upload
    let media = { media_url: null, media_type: null };
    if (file) {
      media = await maybeUploadCommentMedia(file);
    }

    if (!body && media.media_url) {
      body = "image attached";
    }

    try {
      const { error } = await supabase.from("threadtalk_comments").insert({
        thread_id: threadId,
        author_id: currentUser.id,
        body,
        media_url: media.media_url,
        media_type: media.media_type,
        parent_comment_id: parentCommentId,
      });

      if (error) {
        console.error("[ThreadTalk] comment insert error", error);
        showToast("Could not post reply.");
        return;
      }

      // ---- Notifications for comments ----
      const thread = allThreads.find((t) => t.id === threadId);
      if (thread && currentUser) {
        const actorName = displayNameForUserId(currentUser.id);
        const title = thread.title || "";

        if (parentCommentId) {
          const list = commentsByThread[threadId] || [];
          const parent = list.find((c) => c.id === parentCommentId);

          // Notify parent comment author
          if (
            parent &&
            parent.author_id &&
            parent.author_id !== currentUser.id
          ) {
            await createThreadNotification({
              recipientId: parent.author_id,
              threadId,
              commentId: parentCommentId,
              type: "comment_reply",
              message: `${actorName} replied to your comment on "${title}"`,
            });
          }

          // ALSO notify thread author (if different from actor and parent)
          if (
            thread.author_id &&
            thread.author_id !== currentUser.id &&
            (!parent || thread.author_id !== parent.author_id)
          ) {
            await createThreadNotification({
              recipientId: thread.author_id,
              threadId,
              commentId: parentCommentId,
              type: "thread_comment",
              message: `${actorName} replied to a comment on your thread "${title}"`,
            });
          }
        } else if (
          thread.author_id &&
          thread.author_id !== currentUser.id
        ) {
          // Top-level comment → only thread author
          await createThreadNotification({
            recipientId: thread.author_id,
            threadId,
            commentId: null,
            type: "thread_comment",
            message: `${actorName} commented on your thread "${title}"`,
          });
        }

        // NEW: Notify other users who have commented on this thread (Facebook-style)
        // "User X also commented on a thread you're following"
        const existingComments = commentsByThread[threadId] || [];
        const otherCommenters = new Set();
        existingComments.forEach(c => {
          if (c.author_id && 
              c.author_id !== currentUser.id && 
              c.author_id !== thread.author_id) {
            otherCommenters.add(c.author_id);
          }
        });

        for (const commenterId of otherCommenters) {
          await createThreadNotification({
            recipientId: commenterId,
            threadId,
            commentId: null,
            type: "thread_activity",
            message: `${actorName} also commented on "${title}"`,
          });
        }
      }

      // Clear UI
      if (input) input.value = "";
      if (fileInput) fileInput.value = "";

      expandedCommentsThreads.add(threadId);
      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleSendComment exception", err);
      showToast("Could not post reply.");
    }
  }

  function focusCommentBox(card) {
    if (!card) return;
    const input = card.querySelector(".tt-comment-new .tt-comment-input");
    if (!input) return;

    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  }

  // ---------- Thread menus / edit / delete ----------
  function toggleMenu(card) {
    const pop = card?.querySelector('[data-tt-role="menu-pop"]');
    if (!pop) return;

    const hidden = pop.hasAttribute("hidden");

    document
      .querySelectorAll('[data-tt-role="menu-pop"]')
      .forEach((el) => el.setAttribute("hidden", "true"));

    if (hidden) pop.removeAttribute("hidden");
  }

  async function handleEditThread(card, threadId) {
    const thread = allThreads.find((t) => t.id === threadId);
    if (!thread) return;

    if (!currentUser || thread.author_id !== currentUser.id) {
      showToast("You can only edit your own posts.");
      return;
    }

    const previewEl = card.querySelector(".preview");
    if (!previewEl) return;

    const original = thread.body || "";
    previewEl.innerHTML = `
      <textarea class="tt-edit-area">${escapeHtml(original)}</textarea>
      <div class="tt-edit-actions">
        <button type="button" class="tt-edit-save">Save</button>
        <button type="button" class="tt-edit-cancel">Cancel</button>
      </div>
    `;

    const area = previewEl.querySelector(".tt-edit-area");
    const saveBtn = previewEl.querySelector(".tt-edit-save");
    const cancelBtn = previewEl.querySelector(".tt-edit-cancel");

    cancelBtn.addEventListener("click", () => {
      previewEl.innerHTML = linkify(original);
    });

    saveBtn.addEventListener("click", async () => {
      const body = (area.value || "").trim();
      if (!body) {
        area.focus();
        return;
      }

      try {
        const { error } = await supabase
          .from("threadtalk_threads")
          .update({
            body,
            updated_at: new Date().toISOString(),
          })
          .eq("id", threadId)
          .eq("author_id", currentUser.id);

        if (error) {
          console.error("[ThreadTalk] update thread error", error);
          showToast("Could not save edit.");
          return;
        }

        await loadThreads();
      } catch (err) {
        console.error("[ThreadTalk] handleEditThread exception", err);
        showToast("Could not save edit.");
      }
    });
  }

  async function handleDeleteThread(threadId) {
    const authOk = await ensureLoggedInFor("delete a post");
    if (!authOk) return;

    const ok = confirm("Delete this thread?");
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("threadtalk_threads")
        .update({
          is_deleted: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", threadId); // RLS enforces author

      if (error) {
        console.error("[ThreadTalk] delete thread error", error);
        showToast("Could not delete post.");
        return;
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleDeleteThread exception", err);
      showToast("Could not delete post.");
    }
  }

  async function handleDeleteComment(commentId) {
    const authOk = await ensureLoggedInFor("delete a reply");
    if (!authOk) return;

    const ok = confirm("Delete this reply?");
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("threadtalk_comments")
        .update({
          is_deleted: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", commentId); // RLS enforces author

      if (error) {
        console.error("[ThreadTalk] delete comment error", error);
        showToast("Could not delete reply.");
        return;
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleDeleteComment exception", err);
      showToast("Could not delete reply.");
    }
  }

  // ---------- Edit Comment ----------
  function handleEditComment(commentId) {
    const commentEl = document.querySelector(`.tt-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) return;

    // Close the menu
    const menuPop = commentEl.querySelector('[data-tt-role="comment-menu-pop"]');
    if (menuPop) menuPop.setAttribute("hidden", "true");

    const bodyEl = commentEl.querySelector(".tt-comment-body");
    if (!bodyEl) return;

    // Check if already editing
    if (commentEl.querySelector(".tt-comment-edit-container")) return;

    // Get current text (strip HTML for editing)
    const currentText = bodyEl.innerText || bodyEl.textContent || "";

    // Hide the body
    bodyEl.style.display = "none";

    // Create edit container
    const editContainer = document.createElement("div");
    editContainer.className = "tt-comment-edit-container";
    editContainer.innerHTML = `
      <textarea class="tt-comment-edit-area">${escapeHtml(currentText)}</textarea>
      <div class="tt-comment-edit-actions">
        <button type="button" class="tt-comment-edit-save">Save</button>
        <button type="button" class="tt-comment-edit-cancel">Cancel</button>
      </div>
    `;

    bodyEl.parentNode.insertBefore(editContainer, bodyEl.nextSibling);

    const textarea = editContainer.querySelector(".tt-comment-edit-area");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Handle save
    const saveBtn = editContainer.querySelector(".tt-comment-edit-save");
    saveBtn.addEventListener("click", async () => {
      const newText = textarea.value.trim();
      if (!newText) {
        showToast("Reply cannot be empty.");
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      try {
        const { error } = await supabase
          .from("threadtalk_comments")
          .update({
            body: newText,
            updated_at: new Date().toISOString(),
          })
          .eq("id", commentId);

        if (error) {
          console.error("[ThreadTalk] edit comment error", error);
          showToast("Could not save changes.");
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
          return;
        }

        showToast("Reply updated!");
        await loadThreads();
      } catch (err) {
        console.error("[ThreadTalk] handleEditComment save exception", err);
        showToast("Could not save changes.");
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    });

    // Handle cancel
    const cancelBtn = editContainer.querySelector(".tt-comment-edit-cancel");
    cancelBtn.addEventListener("click", () => {
      editContainer.remove();
      bodyEl.style.display = "";
    });
  }

  // ---------- Share ----------
  async function handleShareThread(threadId, clickEvent) {
    // Build link from CURRENT page path, so it works on /ThreadTalk, /ThreadTalk.html, etc.
    const baseUrl =
      window.location.origin + window.location.pathname.replace(/\/$/, "");
    const url = `${baseUrl}?thread=${encodeURIComponent(threadId)}`;

    // Find the share button that was clicked
    const shareBtn = clickEvent?.target?.closest('.share-btn');

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showShareTooltip(shareBtn, "Copied!");
      } else {
        const tmp = document.createElement("input");
        tmp.value = url;
        document.body.appendChild(tmp);
        tmp.select();
        try {
          document.execCommand("copy");
        } catch (_) {
          // ignore
        }
        document.body.removeChild(tmp);
        showShareTooltip(shareBtn, "Copied!");
      }
    } catch (err) {
      console.warn("[ThreadTalk] handleShareThread error", err);
      showShareTooltip(shareBtn, "Failed");
    }
  }

  // Show tooltip near the share button
  function showShareTooltip(btn, msg) {
    if (!btn) {
      showToast(msg);
      return;
    }
    
    // Remove any existing tooltip
    const existing = btn.querySelector('.share-tooltip');
    if (existing) existing.remove();
    
    // Create tooltip
    const tooltip = document.createElement('span');
    tooltip.className = 'share-tooltip';
    tooltip.textContent = msg;
    btn.style.position = 'relative';
    btn.appendChild(tooltip);
    
    // Remove after animation
    setTimeout(() => {
      tooltip.remove();
    }, 1500);
  }

  // ---------- Zoom modal ----------
  function openZoomModal(src) {
    if (!src) return;

    let modal = document.getElementById("tt-zoom-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "tt-zoom-modal";
      modal.innerHTML = `
        <div class="tt-zoom-backdrop" data-tt-role="close-zoom"></div>
        <div class="tt-zoom-inner">
          <button class="tt-zoom-close"
                  type="button"
                  data-tt-role="close-zoom">×</button>
          <img class="tt-zoom-img"
               src="${escapeAttr(src)}"
               alt="Zoomed image"/>
        </div>
      `;
      document.body.appendChild(modal);
    } else {
      const img = modal.querySelector(".tt-zoom-img");
      if (img) img.src = src;
    }

    modal.classList.add("show");
  }

  function closeZoomModal() {
    const modal = document.getElementById("tt-zoom-modal");
    if (!modal) return;
    modal.classList.remove("show");
  }

  function wireZoomClose() {
    document.addEventListener("click", (e) => {
      const roleEl = e.target.closest("[data-tt-role]");
      if (!roleEl) return;
      if (roleEl.dataset.ttRole === "close-zoom") {
        closeZoomModal();
      }
    });
  }

  // ---------- Utilities ----------
  function makeToastElement() {
    const el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    el.textContent = "";
    document.body.appendChild(el);
    return el;
  }

  let toastTimer = null;
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2600);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  // Get initials from a name (e.g. "John Doe" → "JD", "Alice" → "A")
  function getInitials(name) {
    if (!name || typeof name !== 'string') return '?';
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }

  // Turn raw text into safe HTML with clickable links, keeping all original text.
  function linkify(text) {
    const str = String(text || "");
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    let lastIndex = 0;
    let html = "";
    let match;

    while ((match = urlRegex.exec(str)) !== null) {
      const url = match[0];
      const before = str.slice(lastIndex, match.index);
      html += escapeHtml(before);
      html += `<a href="${escapeAttr(
        url
      )}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
      lastIndex = match.index + url.length;
    }

    html += escapeHtml(str.slice(lastIndex));
    return html;
  }

  function timeAgo(iso) {
    if (!iso) return "";
    const then = new Date(iso);
    const now = new Date();
    const diff = (now - then) / 1000;

    if (diff < 60) return "now";
    if (diff < 3600) {
      const m = Math.round(diff / 60);
      return `${m}m`;
    }
    if (diff < 86400) {
      const h = Math.round(diff / 3600);
      return `${h}h`;
    }
    if (diff < 604800) { // Less than 7 days
      const d = Math.round(diff / 86400);
      return `${d}d`;
    }
    
    // More than 7 days - show short date
    return then.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }

  // ---------- Link previews (YouTube + website cards, no iframes) ----------
  async function attachLinkPreview(card, thread) {
    const body = thread.body || "";
    const urlMatch = body.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) return;

    const url = urlMatch[0];

    let previewData = null;
    try {
      previewData = await fetchLinkMetadata(url);
    } catch (_) {
      previewData = null;
    }

    const rawTitle =
      (previewData && (previewData.title || previewData.ogTitle)) || url;
    let title = rawTitle || url;
    if (title.length > 120) title = title.slice(0, 117) + "…";

    let host = "";
    try {
      const u = new URL(url);
      host = u.hostname.replace(/^www\./, "");
    } catch (_) {
      host = "";
    }

    let thumb =
      (previewData &&
        (previewData.thumbnailUrl ||
          previewData.thumbnail_url ||
          previewData.image ||
          previewData["og:image"])) ||
      null;

    // Fallback to YouTube thumbnail if needed
    if (!thumb && isYoutubeUrl(url)) {
      const vid = extractYoutubeId(url);
      if (vid) {
        thumb = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      }
    }

    const actionsRow = card.querySelector(".tt-actions-row");
    if (!actionsRow) return;

    const container = document.createElement("div");
    container.className = "tt-link-preview-wrap";

    container.innerHTML = `
      <a class="tt-link-card"
         href="${escapeAttr(url)}"
         target="_blank"
         rel="noopener noreferrer">
        ${
          thumb
            ? `<div class="tt-link-thumb" style="background-image:url('${escapeAttr(
                thumb
              )}');"></div>`
            : ""
        }
        <div class="tt-link-meta">
          <div class="tt-link-title">${escapeHtml(title)}</div>
          ${
            host
              ? `<div class="tt-link-host">${escapeHtml(host)}</div>`
              : ""
          }
        </div>
      </a>
    `;

    // Insert the preview just above the Like / Reply row
    card.insertBefore(container, actionsRow);
  }

  function isYoutubeUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return (
        host === "youtube.com" ||
        host === "m.youtube.com" ||
        host === "youtu.be"
      );
    } catch (_) {
      return false;
    }
  }

  function extractYoutubeId(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();

      if (host === "youtu.be") {
        return u.pathname.replace("/", "");
      }

      if (host === "youtube.com" || host === "m.youtube.com") {
        return u.searchParams.get("v") || "";
      }

      return "";
    } catch (_) {
      return "";
    }
  }

  async function fetchLinkMetadata(url) {
    try {
      const { data, error } = await HM.supabase.functions.invoke(
        "link-metadata",
        {
          body: { url },
        }
      );

      if (error) {
        console.error("[Link Metadata Error]", error);
        return null;
      }

      return data;
    } catch (err) {
      console.error("[Link Metadata Exception]", err);
      return null;
    }
  }


  // ---------- Styles injection (minimal - main styles in threadtalk.css) ----------
  function injectCompactStyles() {
    const css = `
      /* Minimal overrides - main styles in external CSS */
      .tt-wrap, .cards, .card, .card-body, .card-comments, .comment-input-row {
        max-width: 100%;
        box-sizing: border-box;
      }
      .card-body {
        word-wrap: break-word;
        overflow-wrap: break-word;
      }
    `;
    const tag = document.createElement("style");
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
