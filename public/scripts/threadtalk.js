// scripts/threadtalk.js
// ThreadTalk: threads + comments + reactions + search (Supabase-backed)

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.warn(
      "[ThreadTalk] Supabase client not found on window.HM.supabase; ThreadTalk disabled."
    );
    return;
  }

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

  // ThreadTalk-only search (optional input in HTML)
  const searchInput = document.getElementById("threadSearch");

  // ---------- Constants ----------
  const STORAGE_BUCKET = "threadtalk-media"; // Supabase Storage bucket

  const CATEGORY_LABELS = {
    "showcase": "Showcase",
    "tailoring": "Tailoring",
    "stitch-school": "Stitch School",
    "fabric-sos": "Fabric SOS",
    "before-after": "Before & After",
    "pattern-hacks": "Pattern Hacks",
    "stash-confessions": "Stash Confessions",
    "loose-threads": "Loose Threads"
  };

  const CATEGORY_LINKS = {
    "showcase": "showcase.html",
    "tailoring": "tailoring.html",
    "stitch-school": "stitch-school.html",
    "fabric-sos": "fabric-sos.html",
    "before-after": "before-after.html",
    "pattern-hacks": "pattern-hacks.html",
    "stash-confessions": "stash-confessions.html",
    "loose-threads": "loose-threads.html"
  };

  const REACTION_TYPES = [
    { key: "like",  emoji: "👍" },
    { key: "love",  emoji: "❤️" },
    { key: "laugh", emoji: "😂" },
    { key: "wow",   emoji: "😮" },
    { key: "cry",   emoji: "😢" }
  ];

  const MAX_VISIBLE_COMMENTS = 2; // show last 2 replies unless expanded

  // ---------- State ----------
  let currentUser = null;               // auth.users row
  const profilesCache = {};             // userId -> profile
  let allThreads = [];                  // full list from DB
  let threads = [];                     // filtered list (search)
  let commentsByThread = {};            // threadId -> [comments]
  let reactionsByThread = {};           // threadId -> [reactions]
  let commentReactionsByComment = {};   // commentId -> [reactions]

  const expandedCommentsThreads = new Set(); // threads with all replies shown

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    injectCompactStyles();
    await refreshCurrentUser();
    wireComposer();
    wireMediaInputs();
    wireCardDelegates();
    wireSearch();
    await loadThreads();
  }

  // ---------- Auth / Profile helpers ----------
  async function refreshCurrentUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.warn("[ThreadTalk] getUser error", error);
        currentUser = null;
        return;
      }
      currentUser = data?.user || null;

      if (currentUser && !profilesCache[currentUser.id]) {
        await loadProfiles([currentUser.id]);
      }
    } catch (err) {
      console.error("[ThreadTalk] refreshCurrentUser threw", err);
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
      const { data, error } = await supabase
        .from("profiles")
        .select("id, store_name, first_name, last_name")
        .in("id", ids);

      if (error) {
        console.warn("[ThreadTalk] loadProfiles error", error);
        return;
      }
      (data || []).forEach((p) => {
        profilesCache[p.id] = p;
      });
    } catch (err) {
      console.error("[ThreadTalk] loadProfiles threw", err);
    }
  }

  function displayNameForUserId(userId) {
    const profile = profilesCache[userId];
    if (profile) {
      if (profile.store_name && profile.store_name.trim()) {
        return profile.store_name.trim();
      }
      const first = (profile.first_name || "").trim();
      const last = (profile.last_name || "").trim();
      if (first || last) {
        const lastInitial = last ? `${last[0].toUpperCase()}.` : "";
        const combo = `${first} ${lastInitial}`.trim();
        if (combo) return combo;
      }
    }
    return "Unknown member";
  }

  // ---------- Loading data ----------
  async function loadThreads() {
    try {
      const { data: threadRows, error: threadErr } = await supabase
        .from("threadtalk_threads")
        .select("id, author_id, category, title, body, media_url, media_type, created_at, is_deleted")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(100);

      if (threadErr) {
        console.error("[ThreadTalk] loadThreads error", threadErr);
        showToast("Could not load threads.");
        return;
      }

      allThreads = threadRows || [];
      if (!allThreads.length) {
        threads = [];
        cardsEl.innerHTML = "";
        if (emptyStateEl) emptyStateEl.style.display = "block";
        return;
      }

      const threadIds = allThreads.map((t) => t.id);
      const authorIds = allThreads.map((t) => t.author_id).filter(Boolean);

      // Load comments
      const { data: commentRows, error: commentErr } = await supabase
        .from("threadtalk_comments")
        .select("id, thread_id, author_id, body, created_at, is_deleted")
        .in("thread_id", threadIds);

      if (commentErr) {
        console.warn("[ThreadTalk] comments load error", commentErr);
      }

      commentsByThread = {};
      const commentIds = [];

      (commentRows || [])
        .filter((c) => !c.is_deleted)
        .forEach((c) => {
          if (!commentsByThread[c.thread_id]) commentsByThread[c.thread_id] = [];
          commentsByThread[c.thread_id].push(c);
          commentIds.push(c.id);
          if (c.author_id) authorIds.push(c.author_id);
        });

      // Load comment reactions
      commentReactionsByComment = {};
      if (commentIds.length) {
        const { data: cReactRows, error: cReactErr } = await supabase
          .from("threadtalk_comment_reactions")
          .select("comment_id, user_id, reaction_type")
          .in("comment_id", commentIds);

        if (cReactErr) {
          console.warn("[ThreadTalk] comment reactions load error", cReactErr);
        }

        (cReactRows || []).forEach((r) => {
          if (!commentReactionsByComment[r.comment_id]) {
            commentReactionsByComment[r.comment_id] = [];
          }
          commentReactionsByComment[r.comment_id].push(r);
          authorIds.push(r.user_id);
        });
      }

      // Load thread reactions
      const { data: reactionRows, error: reactErr } = await supabase
        .from("threadtalk_reactions")
        .select("thread_id, user_id, reaction_type")
        .in("thread_id", threadIds);

      if (reactErr) {
        console.warn("[ThreadTalk] reactions load error", reactErr);
      }

      reactionsByThread = {};
      (reactionRows || []).forEach((r) => {
        if (!reactionsByThread[r.thread_id]) reactionsByThread[r.thread_id] = [];
        reactionsByThread[r.thread_id].push(r);
        authorIds.push(r.user_id);
      });

      // Load any missing profiles for authors/commenters/reactors
      await loadProfiles(authorIds);

      applySearchFilter(); // sets threads + renders
    } catch (err) {
      console.error("[ThreadTalk] loadThreads exception", err);
      showToast("Could not load threads.");
    }
  }

  // ---------- Search ----------
  function wireSearch() {
    if (!searchInput) return;
    searchInput.addEventListener("input", () => {
      applySearchFilter();
    });
  }

  function applySearchFilter() {
    const q = (searchInput?.value || "").trim().toLowerCase();
    if (!q) {
      threads = allThreads.slice();
    } else {
      threads = allThreads.filter((t) => {
        const title = (t.title || "").toLowerCase();
        const body = (t.body || "").toLowerCase();
        return title.includes(q) || body.includes(q);
      });
    }
    renderThreads();
  }

  // ---------- Rendering ----------
  function renderThreads() {
    cardsEl.innerHTML = "";
    if (emptyStateEl) emptyStateEl.style.display = threads.length ? "none" : "block";

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

      const { counts: threadCounts, mine: threadMine } = computeReactionState(
        reactionsByThread[thread.id] || []
      );
      const totalThreadReacts = Object.values(threadCounts).reduce((a, b) => a + b, 0);
      const myThreadType = REACTION_TYPES.find((r) => threadMine[r.key])?.key || null;
      const myThreadEmoji =
        REACTION_TYPES.find((r) => r.key === myThreadType)?.emoji || "🙂";

      const comments = commentsByThread[thread.id] || [];
      const mediaHtml = renderMedia(thread);

      // Comments to render (collapsed / expanded)
      let commentsToRender = comments;
      let hiddenCount = 0;
      if (!expandedCommentsThreads.has(thread.id) && comments.length > MAX_VISIBLE_COMMENTS) {
        hiddenCount = comments.length - MAX_VISIBLE_COMMENTS;
        commentsToRender = comments.slice(-MAX_VISIBLE_COMMENTS);
      }

      const commentsHtml = commentsToRender
        .map((c) => renderCommentHtml(c))
        .join("");

      const isMine = currentUser && thread.author_id === currentUser.id;

      const menuHtml = isMine
        ? `
          <div class="tt-menu">
            <button class="tt-menu-btn" type="button" data-tt-role="menu">
              ···
            </button>
            <div class="tt-menu-pop" data-tt-role="menu-pop" hidden>
              <button class="tt-menu-item" data-tt-role="edit-thread" type="button">Edit</button>
              <button class="tt-menu-item danger" data-tt-role="delete-thread" type="button">Delete</button>
            </div>
          </div>
        `
        : "";

      const hiddenHtml = hiddenCount
        ? `
        <button class="tt-more-comments"
                type="button"
                data-tt-role="show-all-comments">
          View ${hiddenCount} more repl${hiddenCount === 1 ? "y" : "ies"}…
        </button>
      `
        : "";

      card.innerHTML = `
        <div class="tt-head">
          <div class="tt-line1">
            <a class="cat" href="${catLink}">${escapeHtml(catLabel)}</a>
            ${title ? `<span class="tt-title">“${escapeHtml(title)}”</span>` : ""}
          </div>
          <div class="tt-line2">
            <div class="tt-line2-main">
              <span class="author">${escapeHtml(authorName)}</span>
              <span>•</span>
              <span>${when}</span>
            </div>
            ${menuHtml}
          </div>
        </div>

        <div class="preview">${escapeHtml(thread.body)}</div>
        ${mediaHtml}

        <div class="tt-actions-row">
          <button class="tt-like-main"
                  type="button"
                  data-tt-role="thread-like">
            <span class="tt-like-emoji">${myThreadEmoji}</span>
            <span class="tt-like-label">${myThreadType ? "You reacted" : "React"}</span>
            <span class="tt-like-count">${totalThreadReacts || ""}</span>
          </button>
          <button class="tt-reply-link"
                  type="button"
                  data-tt-role="respond">
            Reply
          </button>
        </div>

        <div class="tt-react-picker"
             data-tt-role="thread-picker"
             hidden>
          ${REACTION_TYPES.map((r) => {
            const active = r.key === myThreadType ? " tt-react-active" : "";
            const count = threadCounts[r.key] || 0;
            return `
              <button class="tt-react-pill${active}"
                      type="button"
                      data-tt-role="thread-react"
                     // scripts/threadtalk.js
// ThreadTalk: threads + comments + reactions + search (Supabase-backed)

(function () {
  const HM = window.HM || {};
  const supabase = HM.supabase;

  if (!supabase) {
    console.warn(
      "[ThreadTalk] Supabase client not found on window.HM.supabase; ThreadTalk disabled."
    );
    return;
  }

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

  // ThreadTalk-only search (optional input in HTML)
  const searchInput = document.getElementById("threadSearch");

  // ---------- Constants ----------
  const STORAGE_BUCKET = "threadtalk-media"; // Supabase Storage bucket

  const CATEGORY_LABELS = {
    "showcase": "Showcase",
    "tailoring": "Tailoring",
    "stitch-school": "Stitch School",
    "fabric-sos": "Fabric SOS",
    "before-after": "Before & After",
    "pattern-hacks": "Pattern Hacks",
    "stash-confessions": "Stash Confessions",
    "loose-threads": "Loose Threads"
  };

  const CATEGORY_LINKS = {
    "showcase": "showcase.html",
    "tailoring": "tailoring.html",
    "stitch-school": "stitch-school.html",
    "fabric-sos": "fabric-sos.html",
    "before-after": "before-after.html",
    "pattern-hacks": "pattern-hacks.html",
    "stash-confessions": "stash-confessions.html",
    "loose-threads": "loose-threads.html"
  };

  const REACTION_TYPES = [
    { key: "like",  emoji: "👍" },
    { key: "love",  emoji: "❤️" },
    { key: "laugh", emoji: "😂" },
    { key: "wow",   emoji: "😮" },
    { key: "cry",   emoji: "😢" }
  ];

  const MAX_VISIBLE_COMMENTS = 2; // show last 2 replies unless expanded

  // ---------- State ----------
  let currentUser = null;               // auth.users row
  const profilesCache = {};             // userId -> profile
  let allThreads = [];                  // full list from DB
  let threads = [];                     // filtered list (search)
  let commentsByThread = {};            // threadId -> [comments]
  let reactionsByThread = {};           // threadId -> [reactions]
  let commentReactionsByComment = {};   // commentId -> [reactions]

  const expandedCommentsThreads = new Set(); // threads with all replies shown

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    injectCompactStyles();
    await refreshCurrentUser();
    wireComposer();
    wireMediaInputs();
    wireCardDelegates();
    wireSearch();
    await loadThreads();
  }

  // ---------- Auth / Profile helpers ----------
  async function refreshCurrentUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        console.warn("[ThreadTalk] getUser error", error);
        currentUser = null;
        return;
      }
      currentUser = data?.user || null;

      if (currentUser && !profilesCache[currentUser.id]) {
        await loadProfiles([currentUser.id]);
      }
    } catch (err) {
      console.error("[ThreadTalk] refreshCurrentUser threw", err);
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
      const { data, error } = await supabase
        .from("profiles")
        .select("id, store_name, first_name, last_name")
        .in("id", ids);

      if (error) {
        console.warn("[ThreadTalk] loadProfiles error", error);
        return;
      }
      (data || []).forEach((p) => {
        profilesCache[p.id] = p;
      });
    } catch (err) {
      console.error("[ThreadTalk] loadProfiles threw", err);
    }
  }

  function displayNameForUserId(userId) {
    const profile = profilesCache[userId];
    if (profile) {
      if (profile.store_name && profile.store_name.trim()) {
        return profile.store_name.trim();
      }
      const first = (profile.first_name || "").trim();
      const last = (profile.last_name || "").trim();
      if (first || last) {
        const lastInitial = last ? `${last[0].toUpperCase()}.` : "";
        const combo = `${first} ${lastInitial}`.trim();
        if (combo) return combo;
      }
    }
    return "Unknown member";
  }

  // ---------- Loading data ----------
  async function loadThreads() {
    try {
      const { data: threadRows, error: threadErr } = await supabase
        .from("threadtalk_threads")
        .select("id, author_id, category, title, body, media_url, media_type, created_at, is_deleted")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(100);

      if (threadErr) {
        console.error("[ThreadTalk] loadThreads error", threadErr);
        showToast("Could not load threads.");
        return;
      }

      allThreads = threadRows || [];
      if (!allThreads.length) {
        threads = [];
        cardsEl.innerHTML = "";
        if (emptyStateEl) emptyStateEl.style.display = "block";
        return;
      }

      const threadIds = allThreads.map((t) => t.id);
      const authorIds = allThreads.map((t) => t.author_id).filter(Boolean);

      // Load comments
      const { data: commentRows, error: commentErr } = await supabase
        .from("threadtalk_comments")
        .select("id, thread_id, author_id, body, created_at, is_deleted")
        .in("thread_id", threadIds);

      if (commentErr) {
        console.warn("[ThreadTalk] comments load error", commentErr);
      }

      commentsByThread = {};
      const commentIds = [];

      (commentRows || [])
        .filter((c) => !c.is_deleted)
        .forEach((c) => {
          if (!commentsByThread[c.thread_id]) commentsByThread[c.thread_id] = [];
          commentsByThread[c.thread_id].push(c);
          commentIds.push(c.id);
          if (c.author_id) authorIds.push(c.author_id);
        });

      // Load comment reactions
      commentReactionsByComment = {};
      if (commentIds.length) {
        const { data: cReactRows, error: cReactErr } = await supabase
          .from("threadtalk_comment_reactions")
          .select("comment_id, user_id, reaction_type")
          .in("comment_id", commentIds);

        if (cReactErr) {
          console.warn("[ThreadTalk] comment reactions load error", cReactErr);
        }

        (cReactRows || []).forEach((r) => {
          if (!commentReactionsByComment[r.comment_id]) {
            commentReactionsByComment[r.comment_id] = [];
          }
          commentReactionsByComment[r.comment_id].push(r);
          authorIds.push(r.user_id);
        });
      }

      // Load thread reactions
      const { data: reactionRows, error: reactErr } = await supabase
        .from("threadtalk_reactions")
        .select("thread_id, user_id, reaction_type")
        .in("thread_id", threadIds);

      if (reactErr) {
        console.warn("[ThreadTalk] reactions load error", reactErr);
      }

      reactionsByThread = {};
      (reactionRows || []).forEach((r) => {
        if (!reactionsByThread[r.thread_id]) reactionsByThread[r.thread_id] = [];
        reactionsByThread[r.thread_id].push(r);
        authorIds.push(r.user_id);
      });

      // Load any missing profiles for authors/commenters/reactors
      await loadProfiles(authorIds);

      applySearchFilter(); // sets threads + renders
    } catch (err) {
      console.error("[ThreadTalk] loadThreads exception", err);
      showToast("Could not load threads.");
    }
  }

  // ---------- Search ----------
  function wireSearch() {
    if (!searchInput) return;
    searchInput.addEventListener("input", () => {
      applySearchFilter();
    });
  }

  function applySearchFilter() {
    const q = (searchInput?.value || "").trim().toLowerCase();
    if (!q) {
      threads = allThreads.slice();
    } else {
      threads = allThreads.filter((t) => {
        const title = (t.title || "").toLowerCase();
        const body = (t.body || "").toLowerCase();
        return title.includes(q) || body.includes(q);
      });
    }
    renderThreads();
  }

  // ---------- Rendering ----------
  function renderThreads() {
    cardsEl.innerHTML = "";
    if (emptyStateEl) emptyStateEl.style.display = threads.length ? "none" : "block";

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

      const { counts: threadCounts, mine: threadMine } = computeReactionState(
        reactionsByThread[thread.id] || []
      );
      const totalThreadReacts = Object.values(threadCounts).reduce((a, b) => a + b, 0);
      const myThreadType = REACTION_TYPES.find((r) => threadMine[r.key])?.key || null;
      const myThreadEmoji =
        REACTION_TYPES.find((r) => r.key === myThreadType)?.emoji || "🙂";

      const comments = commentsByThread[thread.id] || [];
      const mediaHtml = renderMedia(thread);

      // Comments to render (collapsed / expanded)
      let commentsToRender = comments;
      let hiddenCount = 0;
      if (!expandedCommentsThreads.has(thread.id) && comments.length > MAX_VISIBLE_COMMENTS) {
        hiddenCount = comments.length - MAX_VISIBLE_COMMENTS;
        commentsToRender = comments.slice(-MAX_VISIBLE_COMMENTS);
      }

      const commentsHtml = commentsToRender
        .map((c) => renderCommentHtml(c))
        .join("");

      const isMine = currentUser && thread.author_id === currentUser.id;

      const menuHtml = isMine
        ? `
          <div class="tt-menu">
            <button class="tt-menu-btn" type="button" data-tt-role="menu">
              ···
            </button>
            <div class="tt-menu-pop" data-tt-role="menu-pop" hidden>
              <button class="tt-menu-item" data-tt-role="edit-thread" type="button">Edit</button>
              <button class="tt-menu-item danger" data-tt-role="delete-thread" type="button">Delete</button>
            </div>
          </div>
        `
        : "";

      const hiddenHtml = hiddenCount
        ? `
        <button class="tt-more-comments"
                type="button"
                data-tt-role="show-all-comments">
          View ${hiddenCount} more repl${hiddenCount === 1 ? "y" : "ies"}…
        </button>
      `
        : "";

      card.innerHTML = `
        <div class="tt-head">
          <div class="tt-line1">
            <a class="cat" href="${catLink}">${escapeHtml(catLabel)}</a>
            ${title ? `<span class="tt-title">“${escapeHtml(title)}”</span>` : ""}
          </div>
          <div class="tt-line2">
            <div class="tt-line2-main">
              <span class="author">${escapeHtml(authorName)}</span>
              <span>•</span>
              <span>${when}</span>
            </div>
            ${menuHtml}
          </div>
        </div>

        <div class="preview">${escapeHtml(thread.body)}</div>
        ${mediaHtml}

        <div class="tt-actions-row">
          <button class="tt-like-main"
                  type="button"
                  data-tt-role="thread-like">
            <span class="tt-like-emoji">${myThreadEmoji}</span>
            <span class="tt-like-label">${myThreadType ? "You reacted" : "React"}</span>
            <span class="tt-like-count">${totalThreadReacts || ""}</span>
          </button>
          <button class="tt-reply-link"
                  type="button"
                  data-tt-role="respond">
            Reply
          </button>
        </div>

        <div class="tt-react-picker"
             data-tt-role="thread-picker"
             hidden>
          ${REACTION_TYPES.map((r) => {
            const active = r.key === myThreadType ? " tt-react-active" : "";
            const count = threadCounts[r.key] || 0;
            return `
              <button class="tt-react-pill${active}"
                      type="button"
                      data-tt-role="thread-react"
                      data-reaction="${r.key}">
                <span>${r.emoji}</span>
                <span class="tt-react-pill-count">${count || ""}</span>
              </button>
            `;
          }).join("")}
        </div>

        <div class="tt-comments" data-thread="${thread.id}">
          <div class="tt-comments-list">
            ${hiddenHtml}
            ${commentsHtml}
          </div>
          <div class="tt-comment-new">
            <input class="tt-comment-input"
                   type="text"
                   maxlength="500"
                   placeholder="Write a comment…"/>
            <button class="tt-comment-send"
                    type="button"
                    data-tt-role="send-comment">
              Send
            </button>
          </div>
        </div>
      `;

      cardsEl.appendChild(card);
    });
  }

  function renderMedia(thread) {
    if (!thread.media_url || !thread.media_type) return "";
    const url = escapeAttr(thread.media_url);
    if (thread.media_type === "image") {
      return `
        <div class="tt-media-wrap">
          <img class="post-img"
               src="${url}"
               alt="Post image"
               data-tt-role="zoom-media"/>
        </div>
      `;
    }
    if (thread.media_type === "video") {
      return `
        <div class="tt-media-wrap">
          <video class="post-video"
                 controls
                 src="${url}">
          </video>
        </div>
      `;
    }
    return "";
  }

  function renderCommentHtml(comment) {
    const name = displayNameForUserId(comment.author_id);
    const ts = timeAgo(comment.created_at);
    const isMine = currentUser && comment.author_id === currentUser.id;

    const { counts, mine } = computeReactionState(
      commentReactionsByComment[comment.id] || []
    );
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const myType = REACTION_TYPES.find((r) => mine[r.key])?.key || null;
    const myEmoji =
      REACTION_TYPES.find((r) => r.key === myType)?.emoji || "🙂";

    return `
      <div class="tt-comment" data-comment-id="${comment.id}">
        <div class="tt-comment-body-wrap">
          <div class="tt-comment-head">${escapeHtml(name)} • ${ts}</div>
          <div class="tt-comment-body">${escapeHtml(comment.body)}</div>
        </div>
        <div class="tt-comment-actions">
          <button class="tt-comment-like"
                  type="button"
                  data-tt-role="comment-like">
            <span class="tt-comment-like-emoji">${myEmoji}</span>
            <span class="tt-comment-like-count">${total || ""}</span>
          </button>
          <button class="tt-comment-reply"
                  type="button"
                  data-tt-role="respond">
            Reply
          </button>
          ${
            isMine
              ? `<button class="tt-comment-delete"
                         type="button"
                         data-tt-role="delete-comment">
                   Delete
                 </button>`
              : ""
          }
        </div>
        <div class="tt-comment-picker"
             data-tt-role="comment-picker"
             hidden>
          ${REACTION_TYPES.map((r) => {
            const active = r.key === myType ? " tt-react-active" : "";
            const count = counts[r.key] || 0;
            return `
              <button class="tt-react-pill${active}"
                      type="button"
                      data-tt-role="comment-react"
                      data-reaction="${r.key}">
                <span>${r.emoji}</span>
                <span class="tt-react-pill-count">${count || ""}</span>
              </button>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

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

  // ---------- Composer ----------
  function wireComposer() {
    if (!composerForm) return;

    composerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      let body = (textArea.value || "").trim();
      let title = ((titleInput && titleInput.value) || "").trim();
      let cat = (categorySelect?.value || "").trim();
      if (!cat) cat = "loose-threads";

      const hasMedia = !!(photoInput?.files?.[0] || videoInput?.files?.[0]);

      if (!title) {
        if (titleInput) titleInput.focus();
        showToast("Add a post title.");
        return;
      }

      if (!body && !hasMedia) {
        textArea.focus();
        return;
      }

      const ok = await ensureLoggedInFor("post in ThreadTalk");
      if (!ok) return;

      postBtn.disabled = true;

      try {
        const mediaInfo = await maybeUploadComposerMedia();
        if (!body && hasMedia) {
          body = "image attached";
        }

        const payload = {
          author_id: currentUser.id,
          category: cat,
          title,
          body,
          media_url: mediaInfo.media_url,
          media_type: mediaInfo.media_type
        };

        const { data, error } = await supabase
          .from("threadtalk_threads")
          .insert(payload)
          .select()
          .single();

        if (error) {
          console.error("[ThreadTalk] insert error", error);
          showToast("Could not post. Please try again.");
          return;
        }

        textArea.value = "";
        if (titleInput) titleInput.value = "";
        clearMediaPreview();

        allThreads.unshift(data);
        expandedCommentsThreads.delete(data.id);
        applySearchFilter();
        showToast("Posted");
      } catch (err) {
        console.error("[ThreadTalk] post exception", err);
        showToast("Could not post.");
      } finally {
        postBtn.disabled = false;
      }
    });
  }

  // Upload image/video from composer to Supabase storage
  async function maybeUploadComposerMedia() {
    if (!currentUser) return { media_url: null, media_type: null };
    const file =
      (photoInput && photoInput.files && photoInput.files[0]) ||
      (videoInput && videoInput.files && videoInput.files[0]);
    if (!file) return { media_url: null, media_type: null };

    const isImage = !!(photoInput && photoInput.files && photoInput.files[0]);
    const media_type = isImage ? "image" : "video";

    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase();
      const path = `${currentUser.id}/thread-${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type
        });

      if (error) {
        console.warn("[ThreadTalk] media upload error", error);
        showToast("Could not upload attachment.");
        return { media_url: null, media_type: null };
      }

      const { data: pub } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(data.path);

      const url = pub?.publicUrl || null;
      return { media_url: url, media_type };
    } catch (err) {
      console.error("[ThreadTalk] maybeUploadComposerMedia exception", err);
      showToast("Could not upload attachment.");
      return { media_url: null, media_type: null };
    }
  }

  // ---------- Media preview (local only) ----------
  function wireMediaInputs() {
    if (!photoInput || !videoInput || !mediaPreview) return;

    photoInput.addEventListener("change", () => {
      if (photoInput.files && photoInput.files[0]) {
        videoInput.value = "";
        showPreview(photoInput.files[0], "image");
      }
    });

    videoInput.addEventListener("change", () => {
      if (videoInput.files && videoInput.files[0]) {
        photoInput.value = "";
        showPreview(videoInput.files[0], "video");
      }
    });
  }

  function showPreview(file, kind) {
    const url = URL.createObjectURL(file);
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = "";
    if (kind === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "Preview image";
      img.style.maxWidth = "280px";
      img.style.height = "auto";
      mediaPreview.appendChild(img);
    } else {
      const vid = document.createElement("video");
      vid.controls = true;
      vid.src = url;
      vid.style.maxWidth = "280px";
      mediaPreview.appendChild(vid);
    }
  }

  function clearMediaPreview() {
    if (!mediaPreview) return;
    mediaPreview.hidden = true;
    mediaPreview.innerHTML = "";
    if (photoInput) photoInput.value = "";
    if (videoInput) videoInput.value = "";
  }

  // ---------- Card interactions ----------
  function wireCardDelegates() {
    if (!cardsEl) return;

    cardsEl.addEventListener("click", async (e) => {
      const target = e.target;
      if (!target) return;

      const role =
        target.dataset.ttRole ||
        target.closest("[data-tt-role]")?.dataset.ttRole;
      if (!role) return;

      const card = target.closest(".card");
      const threadId = card ? Number(card.dataset.threadId) : null;

      switch (role) {
        case "zoom-media": {
          const src = target.src;
          if (src) window.open(src, "_blank", "noopener");
          break;
        }
        case "thread-like":
          toggleThreadPicker(card);
          break;
        case "thread-react": {
          const type = target.dataset.reaction;
          if (threadId && type) await handleThreadReaction(threadId, type);
          break;
        }
        case "comment-like": {
          const commentEl = target.closest(".tt-comment");
          if (!commentEl) return;
          toggleCommentPicker(commentEl);
          break;
        }
        case "comment-react": {
          const commentEl = target.closest(".tt-comment");
          if (!commentEl) return;
          const commentId = Number(commentEl.dataset.commentId);
          const type = target.dataset.reaction;
          if (commentId && type) await handleCommentReaction(commentId, type);
          break;
        }
        case "send-comment":
          if (threadId) await handleSendComment(card, threadId);
          break;
        case "menu":
          toggleMenu(card);
          break;
        case "edit-thread":
          if (threadId) await handleEditThread(card, threadId);
          break;
        case "delete-thread":
          if (threadId) await handleDeleteThread(threadId);
          break;
        case "delete-comment": {
          const commentEl = target.closest(".tt-comment");
          if (!commentEl) return;
          const commentId = Number(commentEl.dataset.commentId);
          if (commentId) await handleDeleteComment(commentId);
          break;
        }
        case "respond":
          focusCommentBox(card);
          break;
        case "show-all-comments":
          if (threadId != null) {
            expandedCommentsThreads.add(threadId);
            renderThreads();
          }
          break;
        default:
          break;
      }
    });
  }

  function toggleThreadPicker(card) {
    if (!card) return;
    const picker = card.querySelector('[data-tt-role="thread-picker"]');
    if (!picker) return;
    const hidden = picker.hasAttribute("hidden");
    // close all others
    cardsEl
      .querySelectorAll('[data-tt-role="thread-picker"]')
      .forEach((el) => el.setAttribute("hidden", "true"));
    if (hidden) picker.removeAttribute("hidden");
  }

  function toggleCommentPicker(commentEl) {
    if (!commentEl) return;
    const picker = commentEl.querySelector('[data-tt-role="comment-picker"]');
    if (!picker) return;
    const hidden = picker.hasAttribute("hidden");
    // close siblings inside same card
    const list = commentEl.closest(".tt-comments-list");
    if (list) {
      list
        .querySelectorAll('[data-tt-role="comment-picker"]')
        .forEach((el) => el.setAttribute("hidden", "true"));
    }
    if (hidden) picker.removeAttribute("hidden");
  }

  // Thread reactions (one per user per thread)
  async function handleThreadReaction(threadId, type) {
    const ok = await ensureLoggedInFor("react");
    if (!ok) return;
    const rows = reactionsByThread[threadId] || [];
    const existing = rows.filter((r) => r.user_id === currentUser.id);

    try {
      if (existing.length === 1 && existing[0].reaction_type === type) {
        // Same reaction -> clear
        const { error } = await supabase
          .from("threadtalk_reactions")
          .delete()
          .match({
            thread_id: threadId,
            user_id: currentUser.id,
            reaction_type: type
          });
        if (error) {
          console.warn("[ThreadTalk] thread reaction delete error", error);
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
              user_id: currentUser.id
            });
          if (delErr) {
            console.warn("[ThreadTalk] thread reaction switch delete error", delErr);
            showToast("Could not update reaction.");
            return;
          }
        }
        const { error: insErr } = await supabase
          .from("threadtalk_reactions")
          .insert({
            thread_id: threadId,
            user_id: currentUser.id,
            reaction_type: type
          });
        if (insErr) {
          console.warn("[ThreadTalk] thread reaction insert error", insErr);
          showToast("Could not update reaction.");
          return;
        }
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleThreadReaction exception", err);
      showToast("Could not update reaction.");
    }
  }

  // Comment reactions (one per user per comment)
  async function handleCommentReaction(commentId, type) {
    const ok = await ensureLoggedInFor("react");
    if (!ok) return;

    const rows = commentReactionsByComment[commentId] || [];
    const existing = rows.filter((r) => r.user_id === currentUser.id);

    try {
      if (existing.length === 1 && existing[0].reaction_type === type) {
        const { error } = await supabase
          .from("threadtalk_comment_reactions")
          .delete()
          .match({
            comment_id: commentId,
            user_id: currentUser.id,
            reaction_type: type
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
              user_id: currentUser.id
            });
          if (delErr) {
            console.warn("[ThreadTalk] comment reaction switch delete error", delErr);
            showToast("Could not update reaction.");
            return;
          }
        }
        const { error: insErr } = await supabase
          .from("threadtalk_comment_reactions")
          .insert({
            comment_id: commentId,
            user_id: currentUser.id,
            reaction_type: type
          });
        if (insErr) {
          console.warn("[ThreadTalk] comment reaction insert error", insErr);
          showToast("Could not update reaction.");
          return;
        }
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleCommentReaction exception", err);
      showToast("Could not update reaction.");
    }
  }

  async function handleSendComment(card, threadId) {
    const input = card.querySelector(".tt-comment-input");
    if (!input) return;
    const body = (input.value || "").trim();
    if (!body) {
      input.focus();
      return;
    }

    const ok = await ensureLoggedInFor("comment");
    if (!ok) return;

    try {
      const { error } = await supabase.from("threadtalk_comments").insert({
        thread_id: threadId,
        author_id: currentUser.id,
        body
      });

      if (error) {
        console.error("[ThreadTalk] comment insert error", error);
        showToast("Could not post comment.");
        return;
      }

      input.value = "";
      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleSendComment exception", err);
      showToast("Could not post comment.");
    }
  }

  function focusCommentBox(card) {
    if (!card) return;
    const input = card.querySelector(".tt-comment-input");
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  }

  function toggleMenu(card) {
    const pop = card.querySelector('[data-tt-role="menu-pop"]');
    if (!pop) return;
    const hidden = pop.hasAttribute("hidden");
    // close any open menus
    cardsEl
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

    const original = thread.body;
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
      previewEl.textContent = original;
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
            updated_at: new Date().toISOString()
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
    const thread = allThreads.find((t) => t.id === threadId);
    if (!thread) return;
    if (!currentUser || thread.author_id !== currentUser.id) {
      showToast("You can only delete your own posts.");
      return;
    }

    const ok = confirm("Delete this thread?");
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("threadtalk_threads")
        .update({
          is_deleted: true,
          updated_at: new Date().toISOString()
        })
        .eq("id", threadId)
        .eq("author_id", currentUser.id);

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
    const okLoggedIn = await ensureLoggedInFor("delete your comment");
    if (!okLoggedIn) return;

    const ok = confirm("Delete this comment?");
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("threadtalk_comments")
        .delete()
        .eq("id", commentId)
        .eq("author_id", currentUser.id);

      if (error) {
        console.error("[ThreadTalk] delete comment error", error);
        showToast("Could not delete comment.");
        return;
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleDeleteComment exception", err);
      showToast("Could not delete comment.");
    }
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

  function timeAgo(iso) {
    if (!iso) return "";
    const then = new Date(iso);
    const now = new Date();
    const diff = (now - then) / 1000;

    if (diff < 60) return "just now";
    if (diff < 3600) {
      const m = Math.round(diff / 60);
      return `${m} min${m === 1 ? "" : "s"} ago`;
    }
    if (diff < 86400) {
      const h = Math.round(diff / 3600);
      return `${h} hour${h === 1 ? "" : "s"} ago`;
    }

    return then.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  // Inject CSS overrides to keep things compact and centered
  function injectCompactStyles() {
    const css = `
      .card{
        padding:12px 14px;
        margin:8px auto;
        max-width:720px;
      }
      .preview{
        margin-bottom:4px;
        font-size:14px;
      }
      .tt-head{display:flex;flex-direction:column;gap:2px;margin-bottom:4px;}
      .tt-line1{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;font-size:14px;}
      .tt-line2{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted);}
      .tt-line2-main{display:flex;align-items:center;gap:4px;}
      .tt-title{font-weight:600;color:#3f2f2a;}
      .tt-media-wrap{margin:4px 0;display:flex;justify-content:center;}
      .post-img,.post-video{
        max-width:480px;
        width:100%;
        height:auto;
        margin:4px auto;
      }
      .post-img{cursor:zoom-in;}
      .tt-actions-row{
        display:flex;
        align-items:center;
        gap:8px;
        margin-top:4px;
        font-size:13px;
      }
      .tt-like-main{
        display:inline-flex;
        align-items:center;
        gap:4px;
        border:none;
        background:transparent;
        padding:2px 4px;
        border-radius:999px;
        cursor:pointer;
      }
      .tt-like-main:hover{
        background:rgba(0,0,0,0.02);
      }
      .tt-like-emoji{font-size:16px;}
      .tt-like-count{min-width:10px;text-align:left;font-weight:500;}
      .tt-reply-link{
        border:none;
        background:transparent;
        padding:2px 4px;
        cursor:pointer;
        font-size:13px;
        color:var(--muted);
      }
      .tt-react-picker{
        display:flex;
        gap:4px;
        margin-top:4px;
      }
      .tt-react-pill{
        display:inline-flex;
        align-items:center;
        gap:2px;
        padding:2px 6px;
        font-size:12px;
        border-radius:999px;
        border:1px solid var(--border);
        background:#fff;
        cursor:pointer;
      }
      .tt-react-pill-count{min-width:8px;}
      .tt-react-active{
        border-color:#f97373;
        background:#fff7f7;
      }

      .tt-comments{margin-top:6px;gap:6px;}
      .tt-comments-list{display:flex;flex-direction:column;gap:4px;}
      .tt-comment{
        padding:6px 8px;
        border-radius:8px;
        background:#fff;
      }
      .tt-comment-body-wrap{margin-bottom:2px;}
      .tt-comment-head{font-size:11px;color:var(--muted);margin-bottom:2px;}
      .tt-comment-body{font-size:13px;}
      .tt-comment-actions{
        display:flex;
        align-items:center;
        gap:8px;
        font-size:12px;
        margin-top:2px;
      }
      .tt-comment-actions button{
        border:none;
        background:transparent;
        padding:0;
        cursor:pointer;
        color:var(--muted);
      }
      .tt-comment-like-emoji{font-size:14px;}
      .tt-comment-picker{
        display:flex;
        gap:4px;
        margin-top:4px;
      }

      .tt-comment-input{padding:6px 8px;font-size:13px;}
      .tt-comment-send{padding:6px 12px;font-size:13px;}
      .tt-more-comments{
        align-self:flex-start;
        border:none;
        background:transparent;
        padding:0 0 2px 0;
        margin-bottom:2px;
        font-size:12px;
        color:var(--muted);
        cursor:pointer;
      }

      .tt-menu-btn{padding:2px 6px;font-size:14px;}
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
