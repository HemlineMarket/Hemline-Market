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

  // NEW: thread id from URL (?thread=123)
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

      const { data: threadRows } = await query;
      allThreads = threadRows || [];

      if (!allThreads.length) {
        threads = [];
        if (cardsEl) cardsEl.innerHTML = "";
        if (emptyStateEl) emptyStateEl.style.display = "block";
        return;
      }

      const threadIds = allThreads.map((t) => t.id);
      const authorIds = allThreads.map((t) => t.author_id).filter(Boolean);

      // Load comments
      const { data: commentRows } = await supabase
        .from("threadtalk_comments")
        .select(
          "id, thread_id, author_id, body, media_url, media_type, created_at, is_deleted"
        )
        .in("thread_id", threadIds);

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
          if (c.author_id) authorIds.push(c.author_id);
        });

      // Load comment reactions
      commentReactionsByComment = {};
      if (commentIds.length) {
        const { data: cReactRows } = await supabase
          .from("threadtalk_comment_reactions")
          .select("comment_id, user_id, reaction_type")
          .in("comment_id", commentIds);

        (cReactRows || []).forEach((r) => {
          if (!commentReactionsByComment[r.comment_id]) {
            commentReactionsByComment[r.comment_id] = [];
          }
          commentReactionsByComment[r.comment_id].push(r);
          authorIds.push(r.user_id);
        });
      }

      // Thread reactions
      const { data: reactionRows } = await supabase
        .from("threadtalk_reactions")
        .select("thread_id, user_id, reaction_type")
        .in("thread_id", threadIds);

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

      // Replies collapsed by default; show only after user clicks "View replies"
      let commentsToRender = [];
      const isExpanded = expandedCommentsThreads.has(thread.id);
      if (isExpanded) {
        commentsToRender = comments;
      }

      const commentsHtml = commentsToRender
        .map((c) => renderCommentHtml(thread.id, c))
        .join("");

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
              <span class="author">${escapeHtml(authorName)}</span>
              <span>•</span>
              <span>${when}</span>
            </div>
            ${menuHtml}
          </div>
        </div>

        <div class="preview">${linkify(thread.body)}</div>
        ${mediaHtml}
        ${reactionSummaryHtml}

        <div class="tt-actions-row">
          <div class="tt-like-wrapper">
            <button class="tt-like-btn tt-like-main${
              myType ? " tt-like-active" : ""
            }" type="button" data-tt-role="thread-like-toggle">
              <span class="tt-like-label">Like</span>
            </button>
            ${pickerHtml}
          </div>

          <button class="tt-reply-link" type="button" data-tt-role="respond">
            Reply
          </button>
        </div>

        <div class="tt-comments" data-thread="${thread.id}">
          <div class="tt-comments-list">
            ${hiddenHtml}
            ${commentsHtml}
          </div>

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

      cardsEl.appendChild(card);
    });
  }

  // ---------- Render each comment ----------
  function renderCommentHtml(threadId, c) {
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

    return `
      <div class="tt-comment"
           data-comment-id="${c.id}"
           data-thread-id="${threadId}"
           data-author-name="${escapeAttr(name)}">

         <div class="tt-comment-head-row">
           <div class="tt-comment-meta">
             <span class="tt-comment-author">${escapeHtml(name)}</span>
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

         <div class="tt-comment-reply-box" data-parent-comment-id="${c.id}" hidden>
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

        textArea.value = "";
        titleInput.value = "";
        clearMediaPreview();

        allThreads.unshift(data);
        // New post should show its replies immediately once people start replying
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
      photoInput?.files?.[0] ||
      videoInput?.files?.[0];
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
          if (input) {
            input.focus();
          }
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
          if (hidden2) pop.removeAttribute("hidden");
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
          return
