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

  const MAX_VISIBLE_COMMENTS = 2;

  // ---------- State ----------
  let currentUser = null;
  const profilesCache = {};
  let allThreads = [];
  let threads = [];
  let commentsByThread = {};
  let reactionsByThread = {};
  let commentReactionsByComment = {};
  const expandedCommentsThreads = new Set();

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
    } catch (_) {}
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

      if (THREAD_CATEGORY_FILTER) {
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
        .select("id, thread_id, author_id, body, created_at, is_deleted")
        .in("thread_id", threadIds);

      commentsByThread = {};
      const commentIds = [];

      (commentRows || [])
        .filter((c) => !c.is_deleted)
        .forEach((c) => {
          if (!commentsByThread[c.thread_id])
            commentsByThread[c.thread_id] = [];
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
          if (!commentReactionsByComment[r.comment_id])
            commentReactionsByComment[r.comment_id] = [];
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
        if (!reactionsByThread[r.thread_id])
          reactionsByThread[r.thread_id] = [];
        reactionsByThread[r.thread_id].push(r);
        authorIds.push(r.user_id);
      });

      await loadProfiles(authorIds);
      applySearchFilter();
    } catch (err) {
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
    threads = !q
      ? allThreads.slice()
      : allThreads.filter((t) => {
          const title = (t.title || "").toLowerCase();
          const body = (t.body || "").toLowerCase();
          return title.includes(q) || body.includes(q);
        });
    renderThreads();
  }

  // ---------- Rendering ----------
  function renderThreads() {
    if (!cardsEl) return;
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

      const threadRows = reactionsByThread[thread.id] || [];
      const { counts: threadCounts, mine: threadMine } =
        computeReactionState(threadRows);
      const myType =
        REACTION_TYPES.find((r) => threadMine[r.key])?.key || null;

      const comments = commentsByThread[thread.id] || [];
      const mediaHtml = renderMedia(thread);

      let commentsToRender = comments;
      let hiddenCount = 0;
      if (
        !expandedCommentsThreads.has(thread.id) &&
        comments.length > MAX_VISIBLE_COMMENTS
      ) {
        hiddenCount = comments.length - MAX_VISIBLE_COMMENTS;
        commentsToRender = comments.slice(-MAX_VISIBLE_COMMENTS);
      }

      const commentsHtml = commentsToRender.map(renderCommentHtml).join("");

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

      const hiddenHtml = hiddenCount
        ? `<button class="tt-more-comments" type="button" data-tt-role="show-all-comments">
             View ${hiddenCount} more repl${hiddenCount === 1 ? "y" : "ies"}…
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

          <button class="tt-share-link" type="button" data-tt-role="share-thread">
            Share
          </button>
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
                   placeholder="Reply…"/>
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
  function renderCommentHtml(c) {
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

    return `
      <div class="tt-comment"
           data-comment-id="${c.id}"
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
          showToast("Could not post.");
          return;
        }

        textArea.value = "";
        titleInput.value = "";
        clearMediaPreview();

        allThreads.unshift(data);
        applySearchFilter();
        showToast("Posted");
      } catch (err) {
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
    } catch (_) {
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
          const mention = commentEl?.dataset.authorName || "";
          focusCommentBox(card, mention);
          break;
        }

        case "show-all-comments":
          expandedCommentsThreads.add(threadId);
          renderThreads();
          break;

        case "send-comment":
          if (threadId) await handleSendComment(card, threadId);
          break;

        case "comment-like-toggle": {
          const ok = await ensureLoggedInFor("react");
          if (!ok) return;
          const wrapper = roleEl.closest(".tt-like-wrapper");
          const isOpen = wrapper.classList.contains("tt-picker-open");
          closeAllPickers();
          if (!isOpen) wrapper.classList.add("tt-picker-open");
          break;
        }

        case "comment-react": {
          const commentId = Number(roleEl.dataset.commentId);
          const type = roleEl.dataset.reaction;
          if (commentId && type) {
            closeAllPickers();
            await handleCommentReaction(commentId, type);
          }
          break;
        }

        case "comment-menu": {
          const pop = roleEl
            .closest(".tt-menu")
            ?.querySelector('[data-tt-role="comment-menu-pop"]');
          const hidden = pop.hasAttribute("hidden");
          document
            .querySelectorAll('[data-tt-role="comment-menu-pop"]')
            .forEach((el) => el.setAttribute("hidden", "true"));
          if (hidden) pop.removeAttribute("hidden");
          break;
        }

        case "delete-comment": {
          const commentId = Number(roleEl.dataset.commentId);
          if (commentId) await handleDeleteComment(commentId);
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
          return;
        }
      }

      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleCommentReaction exception", err);
      showToast("Could not update reaction.");
    }
  }

  // ---------- Comments ----------
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
        body,
      });

      if (error) {
        console.error("[ThreadTalk] comment insert error", error);
        showToast("Could not post reply.");
        return;
      }

      input.value = "";
      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleSendComment exception", err);
      showToast("Could not post reply.");
    }
  }

  function focusCommentBox(card, mentionName) {
    const input = card.querySelector(".tt-comment-input");
    if (!input) return;

    if (mentionName) {
      const firstWord = mentionName.split(" ")[0] || mentionName;
      const mention = "@" + firstWord.replace(/[^\w.@-]/g, "");
      if (!input.value.trim()) {
        input.value = mention + " ";
      } else if (!input.value.startsWith(mention)) {
        input.value = mention + " " + input.value;
      }
    }

    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  }

  // ---------- Thread menus / edit / delete ----------
  function toggleMenu(card) {
    const pop = card.querySelector('[data-tt-role="menu-pop"]');
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
    const thread = allThreads.find((t) => t.id === threadId) || null;

    // Build a simple, copy-friendly URL that always points to the main ThreadTalk page.
    const baseOrigin = window.location.origin.replace(/\/$/, "");
    const url = `${baseOrigin}/threadtalk.html?thread=${encodeURIComponent(
      threadId
    )}`;

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
        } catch (_) {}
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

  // ---------- Styles injection ----------
  function injectCompactStyles() {
    const css = `
      .card{padding:12px 14px;margin-bottom:8px;border-radius:14px;}
      .preview{margin-bottom:4px;font-size:14px;}
      .tt-head{display:flex;flex-direction:column;gap:2px;margin-bottom:4px;}
      .tt-line1{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;font-size:14px;}
      .tt-line2{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted);}
      .tt-line2-main{display:flex;align-items:center;gap:4px;}
      .tt-title{font-weight:600;color:#3f2f2a;}
      .post-media-wrap{margin:4px 0;max-width:460px;}
      .post-img,.post-video{width:100%;height:auto;border-radius:10px;display:block;}
      .tt-actions-row{display:flex;align-items:center;gap:12px;margin-top:4px;margin-bottom:2px;font-size:13px;}
      .tt-like-wrapper{position:relative;display:inline-flex;align-items:center;}
      .tt-like-btn{border:none;background:none;color:#6b7280;font-size:13px;padding:4px 8px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;}
      .tt-like-btn.tt-like-active{color:#2563eb;font-weight:500;}
      .tt-react-picker{position:absolute;bottom:100%;left:0;display:flex;gap:6px;background:#fff;border-radius:999px;box-shadow:0 10px 30px rgba(15,23,42,.18);padding:4px 6px;margin-bottom:4px;opacity:0;pointer-events:none;transform:translateY(4px);transition:opacity .12s ease,transform .12s ease;}
      .tt-like-wrapper.tt-picker-open .tt-react-picker{opacity:1;pointer-events:auto;transform:translateY(0);}
      .tt-react-pill{border:none;background:none;font-size:18px;cursor:pointer;padding:2px;}
      .tt-react-summary{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#6b7280;margin-top:2px;flex-wrap:wrap;}
      .tt-react-chip{display:inline-flex;align-items:center;gap:2px;margin-right:4px;}
      .tt-react-emoji{font-size:14px;line-height:1;}
      .tt-react-count{font-size:11px;line-height:1;}
      .tt-comments{margin-top:4px;}
      .tt-comments-list{display:flex;flex-direction:column;gap:2px;}
      .tt-comment{padding:4px 0;border-top:1px solid #f3f4f6;}
      .tt-comment-head-row{display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:2px;}
      .tt-comment-meta{display:flex;align-items:center;gap:4px;}
      .tt-comment-author{font-weight:500;}
      .tt-comment-body{font-size:13px;margin-bottom:2px;}
      .tt-comment-actions{display:flex;align-items:center;gap:8px;font-size:12px;}
      .tt-comment-new{display:flex;align-items:center;gap:6px;margin-top:4px;}
      .tt-comment-input{flex:1;padding:6px 8px;border-radius:999px;border:1px solid var(--border);font-size:13px;}
      .tt-comment-input::placeholder{color:#9ca3af;}
      .tt-comment-send{padding:6px 12px;font-size:13px;border-radius:999px;border:none;background:#111827;color:#fff;cursor:pointer;}
      .tt-more-comments{border:none;background:none;color:#6b7280;font-size:12px;padding:0;margin-bottom:2px;cursor:pointer;}
      .tt-menu{position:relative;}
      .tt-menu-btn{padding:2px 6px;font-size:14px;border-radius:999px;border:1px solid var(--border);background:#fff;cursor:pointer;}
      .tt-menu-pop{position:absolute;margin-top:4px;right:0;background:#fff;border-radius:8px;box-shadow:0 10px 30px rgba(15,23,42,.15);padding:4px;z-index:20;display:grid;}
      .tt-menu-pop[hidden]{display:none !important;}
      .tt-menu-item{display:block;width:100%;text-align:left;border:none;background:none;padding:6px 10px;font-size:13px;border-radius:6px;cursor:pointer;}
      .tt-menu-item:hover{background:#f3f4f6;}
      .tt-menu-item.danger{color:#b91c1c;}
      .tt-react-summary-comment{margin-top:0;}
      #tt-zoom-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:60;}
      #tt-zoom-modal.show{opacity:1;pointer-events:auto;}
      .tt-zoom-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.55);}
      .tt-zoom-inner{position:relative;z-index:1;max-width:90vw;max-height:90vh;display:flex;flex-direction:column;}
      .tt-zoom-img{max-width:90vw;max-height:90vh;border-radius:12px;object-fit:contain;background:#fff;}
      .tt-zoom-close{position:absolute;top:-32px;right:0;border:none;background:none;color:#f9fafb;font-size:24px;cursor:pointer;}
      .tt-edit-area{width:100%;min-height:80px;border-radius:10px;border:1px solid var(--border);padding:8px;font-size:13px;}
      .tt-edit-actions{display:flex;gap:8px;margin-top:4px;}
      .tt-edit-save,.tt-edit-cancel{border-radius:999px;border:none;padding:4px 10px;font-size:12px;cursor:pointer;}
      .tt-edit-save{background:#111827;color:#fff;}
      .tt-edit-cancel{background:#e5e7eb;color:#111827;}
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
