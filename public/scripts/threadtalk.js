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
        .select("id, store_name, first_name, last_name")
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
        ? `<a class="author tt-author-link"
               href="atelier.html?u=${encodeURIComponent(
                 thread.author_id
               )}">
             ${escapeHtml(authorName)}
           </a>`
        : `<span class="author">${escapeHtml(authorName)}</span>`;

      card.innerHTML = `
        <div class="tt-head">
          <div class="tt-line1">
            <a class="cat" href="${catLink}">${escapeHtml(catLabel)}</a>
            ${
              title
                ? `<span class="tt-title">“${escapeHtml(title)}”</span>`
                : ""
            }
            <button class="tt-share-chip"
                    type="button"
                    data-tt-role="share-thread">
              Share
            </button>
          </div>
          <div class="tt-line2">
            <div class="tt-line2-main">
              ${authorHtml}
              <span>•</span>
              <span>${when}</span>
            </div>
            ${menuHtml}
          </div>
        </div>

        <div class="preview">${linkify(thread.body || "")}</div>
        ${mediaHtml}

        <div class="tt-actions-row">
          <div class="tt-like-wrapper">
            <button class="tt-like-btn tt-like-main${
              myType ? " tt-like-active" : ""
            }"
                    type="button"
                    data-tt-role="thread-like-toggle">
              <span class="tt-like-label">Like</span>
            </button>
            ${pickerHtml}
          </div>

          <button class="tt-reply-link"
                  type="button"
                  data-tt-role="respond">
            Reply
          </button>
        </div>

        ${reactionSummaryHtml}

        <div class="tt-comments">
          <div class="tt-comments-list">
            ${commentsHtml}
          </div>
          ${hiddenHtml}
          <div class="tt-comment-new">
            <input class="tt-comment-photo"
                   type="file"
                   accept="image/*"
                   data-tt-role="comment-photo"/>
            <input class="tt-comment-input"
                   type="text"
                   maxlength="500"
                   placeholder="Write a reply…"/>
            <button class="tt-comment-send"
                    type="button"
                    data-tt-role="send-comment">
              Send
            </button>
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
      ? `<a class="tt-comment-author tt-author-link"
             href="atelier.html?u=${encodeURIComponent(
               c.author_id
             )}">${escapeHtml(name)}</a>`
      : `<span class="tt-comment-author">${escapeHtml(name)}</span>`;

    return `
      <div class="tt-comment${
        d > 0 ? " tt-comment-child" : ""
      }" data-comment-id="${c.id}"
           data-thread-id="${threadId}"
           data-author-name="${escapeAttr(name)}"
           data-depth="${d}">

         <div class="tt-comment-head-row">
           <div class="tt-comment-meta">
             ${authorHtml}
             <span class="tt-comment-dot">•</span>
             <span class="tt-comment-time">${ts}</span>
           </div>
           ${deleteHtml}
         </div>

         <div class="tt-comment-body">${linkify(c.body)}</div>
         ${mediaHtml}
         ${summaryHtml}

         <div class="tt-comment-actions">
           <div class="tt-like-wrapper tt-like-wrapper-comment">
             <button class="tt-like-btn tt-like-main${
               myType ? " tt-like-active" : ""
             }"
                     type="button"
                     data-tt-role="comment-like-toggle"
                     data-comment-id="${c.id}">
               <span class="tt-like-label">Like</span>
             </button>
             ${pickerHtml}
           </div>

           <button class="tt-reply-link"
                   type="button"
                   data-tt-role="respond-comment"
                   data-comment-id="${c.id}">
             Reply
           </button>
         </div>

         <div class="tt-comment-reply-box"
              data-parent-comment-id="${c.id}"
              hidden>
           <input class="tt-comment-photo"
                  type="file"
                  accept="image/*"
                  data-tt-role="comment-photo"/>
           <input class="tt-comment-input"
                  type="text"
                  maxlength="500"
                  placeholder="Reply to ${escapeAttr(name)}…"/>
           <button class="tt-comment-send"
                   type="button"
                   data-tt-role="send-comment-reply"
                   data-comment-id="${c.id}">
             Send
           </button>
         </div>

      </div>`;
  }

  // ---------- Media rendering ----------
  function renderMedia(thread) {
    if (!thread.media_url || !thread.media_type) return "";
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
      const href = `/ThreadTalk.html?thread=${threadId}`;

      const { error } = await supabase.from("notifications").insert({
        user_id: recipientId,          // recipient
        actor_id: currentUser.id,      // actor / sender
        type,                          // "thread_reaction", "comment_reply", etc.
        kind: "threadtalk",            // used by notifications.html as pill label
        title: message,                // main line in notifications list
        body: message,                 // secondary line (same text for now)
        href,                          // notifications.html prefers href / link
        link: href,
        thread_id: threadId,
        comment_id: commentId,
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

    const file =
      photoInput?.files?.[0] || videoInput?.files?.[0];
    if (!file) return { media_url: null, media_type: null };

    const isImage = !!photoInput?.files?.[0];
    const media_type = isImage ? "image" : "video";

    try {
      const ext = file.name.split(".").pop().toLowerCase();
      const path = `${currentUser.id}/thread-${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
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
        media_type,
      };
    } catch (err) {
      console.error("[ThreadTalk] upload exception", err);
      showToast("Upload failed.");
      return { media_url: null, media_type: null };
    }
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
      if (photoInput.files?.[0]) {
        videoInput.value = "";
        showPreview(photoInput.files[0], "image");
      }
    });

    videoInput.addEventListener("change", () => {
      if (videoInput.files?.[0]) {
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
          if (threadId) await handleShareThread(threadId);
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

  // ---------- Share ----------
  async function handleShareThread(threadId) {
    // Build link from CURRENT page path, so it works on /ThreadTalk, /ThreadTalk.html, etc.
    const baseUrl =
      window.location.origin + window.location.pathname.replace(/\/$/, "");
    const url = `${baseUrl}?thread=${encodeURIComponent(threadId)}`;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast("Link copied");
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
        showToast("Link copied");
      }
    } catch (err) {
      console.warn("[ThreadTalk] handleShareThread error", err);
      showToast("Could not copy link.");
    }
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
      minute: "2-digit",
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

  // ---------- Styles injection ----------
  function injectCompactStyles() {
    const css = `
      /* ===== FACEBOOK-STYLE THREADTALK ===== */
      
      /* Cards - clean, minimal shadow */
      .card{
        padding:10px 14px;
        margin-bottom:8px;
        border-radius:8px;
        background:#ffffff;
        border:1px solid #dddfe2;
        box-shadow:0 1px 2px rgba(0,0,0,0.05);
      }
      
      /* Post header */
      .tt-head{
        display:flex;
        flex-direction:column;
        gap:2px;
        margin-bottom:8px;
      }
      .tt-line1{
        display:flex;
        flex-wrap:wrap;
        gap:8px;
        align-items:center;
        font-size:13px;
      }
      .tt-line2{
        display:flex;
        align-items:center;
        justify-content:space-between;
      }
      .tt-line2-main{
        display:flex;
        align-items:center;
        gap:6px;
        font-size:13px;
        color:#65676b;
      }
      
      /* Author name - FB style */
      .tt-author-link{
        font-weight:600;
        color:#050505;
        text-decoration:none;
      }
      .tt-author-link:hover{
        text-decoration:underline;
      }
      
      /* Category badge - subtle */
      .cat{
        font-size:11px;
        font-weight:600;
        color:#991b1b;
        text-transform:uppercase;
        letter-spacing:.03em;
        text-decoration:none;
      }
      .cat:hover{
        text-decoration:underline;
      }
      
      /* Post title */
      .tt-title{
        font-weight:600;
        color:#050505;
        font-size:14px;
      }
      
      /* Share button - subtle */
      .tt-share-chip{
        margin-left:auto;
        border:none;
        background:transparent;
        color:#65676b;
        font-size:12px;
        padding:4px 8px;
        border-radius:6px;
        cursor:pointer;
      }
      .tt-share-chip:hover{
        background:#f0f2f5;
      }
      
      /* Post body text */
      .preview{
        font-size:14px;
        line-height:1.35;
        color:#050505;
        margin-bottom:6px;
        word-wrap:break-word;
      }
      .preview:empty{
        display:none;
        margin:0;
      }
      .preview a{
        color:#216fdb;
        text-decoration:none;
      }
      .preview a:hover{
        text-decoration:underline;
      }
      
      /* Media */
      .post-media-wrap{
        margin:8px 0;
        max-width:500px;
      }
      .post-img,
      .post-video{
        width:100%;
        height:auto;
        border-radius:8px;
        display:block;
      }

      /* Actions row - FB style divider */
      .tt-actions-row{
        display:flex;
        align-items:center;
        gap:4px;
        padding-top:8px;
        margin-top:8px;
        border-top:1px solid #e4e6eb;
      }
      
      /* Like button wrapper */
      .tt-like-wrapper{
        position:relative;
        display:inline-flex;
        align-items:center;
      }
      .tt-like-btn{
        border:none;
        background:none;
        color:#65676b;
        font-size:14px;
        font-weight:600;
        padding:6px 12px;
        border-radius:4px;
        cursor:pointer;
        display:inline-flex;
        align-items:center;
        gap:6px;
      }
      .tt-like-btn:hover{
        background:#f0f2f5;
      }
      .tt-like-btn.tt-like-active{
        color:#991b1b;
      }
      
      /* Reply button */
      .tt-reply-link{
        border:none;
        background:none;
        color:#65676b;
        font-size:14px;
        font-weight:600;
        padding:6px 12px;
        border-radius:4px;
        cursor:pointer;
      }
      .tt-reply-link:hover{
        background:#f0f2f5;
      }

      /* Reaction picker popup */
      .tt-react-picker{
        position:absolute;
        bottom:100%;
        left:0;
        display:flex;
        gap:2px;
        background:#fff;
        border-radius:20px;
        box-shadow:0 2px 12px rgba(0,0,0,0.15);
        padding:4px 8px;
        margin-bottom:6px;
        opacity:0;
        pointer-events:none;
        transform:translateY(4px) scale(0.95);
        transition:all .15s ease;
      }
      .tt-like-wrapper.tt-picker-open .tt-react-picker{
        opacity:1;
        pointer-events:auto;
        transform:translateY(0) scale(1);
      }
      .tt-react-pill{
        border:none;
        background:none;
        font-size:20px;
        cursor:pointer;
        padding:4px;
        border-radius:50%;
        transition:transform .1s;
      }
      .tt-react-pill:hover{
        transform:scale(1.2);
      }

      /* Reaction summary - compact */
      .tt-react-summary{
        display:inline-flex;
        align-items:center;
        gap:2px;
        font-size:13px;
        color:#65676b;
        margin-top:4px;
      }
      .tt-react-chip{
        display:inline-flex;
        align-items:center;
      }
      .tt-react-emoji{
        font-size:16px;
        line-height:1;
      }
      .tt-react-count{
        font-size:13px;
        margin-left:2px;
        color:#65676b;
      }

      /* Comments section */
      .tt-comments{
        margin-top:8px;
      }
      .tt-comments-list{
        display:flex;
        flex-direction:column;
        gap:4px;
      }
      .tt-comments-list::before{
        display:none;
      }

      /* Individual comment - FB bubble style */
      .tt-comment{
        position:relative;
        padding:6px 12px;
        border-radius:18px;
        background:#f0f2f5;
        border:none;
        margin-left:0;
        display:inline-block;
        max-width:85%;
      }
      .tt-comment[data-depth="1"]{
        margin-left:24px;
      }
      .tt-comment[data-depth="2"]{
        margin-left:48px;
      }
      .tt-comment[data-depth="3"]{
        margin-left:72px;
      }

      .tt-comment-children{
        margin-top:4px;
      }

      .tt-comment-head-row{
        display:flex;
        align-items:center;
        justify-content:space-between;
        margin-bottom:2px;
      }
      .tt-comment-meta{
        display:flex;
        align-items:center;
        gap:6px;
        font-size:13px;
      }
      .tt-comment-author{
        font-weight:600;
        color:#050505;
      }
      .tt-comment-time{
        color:#65676b;
        font-size:12px;
      }

      .tt-comment-body{
        font-size:14px;
        color:#050505;
        line-height:1.3;
      }
      .tt-comment-body a{
        color:#216fdb;
      }

      .tt-comment-media{
        margin:6px 0;
        max-width:280px;
      }
      .tt-comment-media .post-img,
      .tt-comment-media .post-video{
        width:100%;
        height:auto;
        border-radius:8px;
        display:block;
      }

      .tt-comment-actions{
        display:flex;
        align-items:center;
        gap:12px;
        font-size:12px;
        font-weight:600;
        margin-top:2px;
        margin-left:12px;
        color:#65676b;
      }
      .tt-comment-actions button{
        background:none;
        border:none;
        color:#65676b;
        font-size:12px;
        font-weight:600;
        cursor:pointer;
        padding:0;
      }
      .tt-comment-actions button:hover{
        text-decoration:underline;
      }
      .tt-comment-actions button.tt-like-active{
        color:#991b1b;
      }

      /* Comment input - FB style */
      .tt-comment-new{
        display:flex;
        align-items:center;
        gap:8px;
        margin-top:8px;
      }
      .tt-comment-input{
        flex:1;
        padding:8px 12px;
        border-radius:20px;
        border:none;
        font-size:15px;
        background:#f0f2f5;
        outline:none;
      }
      .tt-comment-input:focus{
        background:#e4e6eb;
      }
      .tt-comment-input::placeholder{
        color:#65676b;
      }

      .tt-comment-photo{
        font-size:0;
        width:auto;
      }
      .tt-comment-photo::file-selector-button{
        border-radius:6px;
        border:1px solid #dddfe2;
        background:#fff;
        padding:6px 10px;
        font-size:13px;
        cursor:pointer;
        color:#65676b;
      }
      .tt-comment-photo::file-selector-button:hover{
        background:#f0f2f5;
      }
      .tt-comment-send{
        padding:8px 16px;
        font-size:14px;
        font-weight:600;
        border-radius:6px;
        border:none;
        background:#991b1b;
        color:#fff;
        cursor:pointer;
      }
      .tt-comment-send:hover{
        background:#7f1d1d;
      }

      .tt-comment-reply-box{
        display:flex;
        align-items:center;
        gap:8px;
        margin-top:4px;
        margin-left:24px;
      }
      .tt-comment-reply-box[hidden]{
        display:none;
      }

      .tt-more-comments{
        border:none;
        background:none;
        color:#65676b;
        font-size:13px;
        font-weight:600;
        padding:4px 0;
        cursor:pointer;
        text-align:left;
      }
      .tt-more-comments:hover{
        text-decoration:underline;
      }

      /* Menu */
      .tt-menu{
        position:relative;
      }
      .tt-menu-btn{
        width:32px;
        height:32px;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:16px;
        border-radius:50%;
        border:none;
        background:transparent;
        cursor:pointer;
        color:#65676b;
      }
      .tt-menu-btn:hover{
        background:#f0f2f5;
      }
      .tt-menu-pop{
        position:absolute;
        margin-top:4px;
        right:0;
        background:#fff;
        border-radius:8px;
        box-shadow:0 2px 12px rgba(0,0,0,0.15);
        padding:8px;
        z-index:20;
        min-width:120px;
      }
      .tt-menu-pop[hidden]{
        display:none !important;
      }
      .tt-menu-item{
        display:block;
        width:100%;
        text-align:left;
        border:none;
        background:none;
        padding:8px 12px;
        font-size:15px;
        border-radius:6px;
        cursor:pointer;
      }
      .tt-menu-item:hover{
        background:#f0f2f5;
      }
      .tt-menu-item.danger{
        color:#dc2626;
      }

      .tt-react-summary-comment{
        margin-top:2px;
        margin-left:12px;
      }

      /* Zoom modal */
      #tt-zoom-modal{
        position:fixed;
        inset:0;
        display:flex;
        align-items:center;
        justify-content:center;
        opacity:0;
        pointer-events:none;
        transition:opacity .2s ease;
        z-index:60;
      }
      #tt-zoom-modal.show{
        opacity:1;
        pointer-events:auto;
      }
      .tt-zoom-backdrop{
        position:absolute;
        inset:0;
        background:rgba(0,0,0,0.8);
      }
      .tt-zoom-inner{
        position:relative;
        z-index:1;
        max-width:90vw;
        max-height:90vh;
      }
      .tt-zoom-img{
        max-width:90vw;
        max-height:90vh;
        border-radius:8px;
        object-fit:contain;
      }
      .tt-zoom-close{
        position:absolute;
        top:-40px;
        right:0;
        border:none;
        background:none;
        color:#fff;
        font-size:28px;
        cursor:pointer;
      }

      /* Edit mode */
      .tt-edit-area{
        width:100%;
        min-height:80px;
        font-size:15px;
        padding:10px 12px;
        border-radius:8px;
        border:1px solid #dddfe2;
        background:#fff;
        outline:none;
        resize:vertical;
      }
      .tt-edit-area:focus{
        border-color:#991b1b;
      }
      .tt-edit-actions{
        margin-top:8px;
        display:flex;
        gap:8px;
      }
      .tt-edit-save,
      .tt-edit-cancel{
        padding:8px 16px;
        font-size:14px;
        font-weight:600;
        border-radius:6px;
        border:none;
        cursor:pointer;
      }
      .tt-edit-save{
        background:#991b1b;
        color:#fff;
      }
      .tt-edit-save:hover{
        background:#7f1d1d;
      }
      .tt-edit-cancel{
        background:#e4e6eb;
        color:#050505;
      }
      .tt-edit-cancel:hover{
        background:#d8dadf;
      }

      /* Link previews */
      .tt-link-preview-wrap{
        margin:8px 0;
        max-width:500px;
      }
      .tt-link-card{
        display:flex;
        text-decoration:none;
        border-radius:8px;
        border:1px solid #dddfe2;
        background:#f0f2f5;
        overflow:hidden;
        transition:background .15s;
      }
      .tt-link-card:hover{
        background:#e4e6eb;
      }
      .tt-link-thumb{
        flex:0 0 120px;
        min-height:80px;
        background-size:cover;
        background-position:center;
        background-color:#e4e6eb;
      }
      .tt-link-meta{
        padding:10px 12px;
        display:flex;
        flex-direction:column;
        justify-content:center;
        gap:4px;
      }
      .tt-link-title{
        font-size:14px;
        font-weight:600;
        color:#050505;
        display:-webkit-box;
        -webkit-line-clamp:2;
        -webkit-box-orient:vertical;
        overflow:hidden;
      }
      .tt-link-host{
        font-size:12px;
        color:#65676b;
        text-transform:uppercase;
      }

      /* Mobile */
      @media (max-width:640px){
        .card{
          padding:12px;
          border-radius:0;
          border-left:none;
          border-right:none;
          margin-bottom:0;
          border-bottom:8px solid #f0f2f5;
        }
        .tt-comment{
          max-width:95%;
        }
        .tt-comment[data-depth="1"]{
          margin-left:16px;
        }
        .tt-comment[data-depth="2"]{
          margin-left:32px;
        }
        .tt-link-preview-wrap{
          max-width:100%;
        }
        .tt-link-thumb{
          flex:0 0 80px;
        }
      }
    `;
    const tag = document.createElement("style");
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
