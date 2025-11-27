// scripts/threadtalk.js
// ThreadTalk: threads + comments + reactions (Supabase-backed)

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
    { key: "like", emoji: "👍" },
    { key: "love", emoji: "❤️" },
    { key: "laugh", emoji: "😂" },
    { key: "wow", emoji: "😮" },
    { key: "cry", emoji: "😢" }
  ];

  // ---------- State ----------
  let currentUser = null;             // auth.users row (id, email, etc.)
  const profilesCache = {};           // userId -> profile
  let threads = [];                   // array of thread rows
  let commentsByThread = {};          // threadId -> [comments]
  let reactionsByThread = {};         // threadId -> [reactions]
  let commentReactionsByComment = {}; // commentId -> [reactions]
  let currentSearchQuery = "";        // reserved for future search UI

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    injectCompactStyles();
    await refreshCurrentUser();
    wireComposer();
    wireMediaInputs();
    wireCardDelegates();
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
    // Do NOT fall back to auth full_name to avoid government names.
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
        .limit(50);

      if (threadErr) {
        console.error("[ThreadTalk] loadThreads error", threadErr);
        showToast("Could not load threads.");
        return;
      }

      threads = threadRows || [];
      if (!threads.length) {
        cardsEl.innerHTML = "";
        if (emptyStateEl) emptyStateEl.style.display = "block";
        return;
      }

      const threadIds = threads.map((t) => t.id);
      const authorIds = threads.map((t) => t.author_id).filter(Boolean);

      // Load comments
      const { data: commentRows, error: commentErr } = await supabase
        .from("threadtalk_comments")
        .select("id, thread_id, author_id, body, created_at, is_deleted")
        .in("thread_id", threadIds);

      if (commentErr) {
        console.warn("[ThreadTalk] comments load error", commentErr);
      }

      commentsByThread = {};
      const aliveComments = (commentRows || []).filter((c) => !c.is_deleted);

      aliveComments.forEach((c) => {
        if (!commentsByThread[c.thread_id]) commentsByThread[c.thread_id] = [];
        commentsByThread[c.thread_id].push(c);
        if (c.author_id) authorIds.push(c.author_id);
      });

      const commentIds = aliveComments.map((c) => c.id);

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

      // Load comment reactions
      commentReactionsByComment = {};
      if (commentIds.length) {
        const { data: commentReactRows, error: crErr } = await supabase
          .from("threadtalk_comment_reactions")
          .select("comment_id, user_id, reaction_type")
          .in("comment_id", commentIds);

        if (crErr) {
          console.warn("[ThreadTalk] comment reactions load error", crErr);
        } else {
          (commentReactRows || []).forEach((r) => {
            if (!commentReactionsByComment[r.comment_id]) {
              commentReactionsByComment[r.comment_id] = [];
            }
            commentReactionsByComment[r.comment_id].push(r);
            authorIds.push(r.user_id);
          });
        }
      }

      // Load any missing profiles for authors/commenters/reactors
      await loadProfiles(authorIds);

      renderThreads();
    } catch (err) {
      console.error("[ThreadTalk] loadThreads exception", err);
      showToast("Could not load threads.");
    }
  }

  // ---------- Reaction state helpers ----------
  function computeReactionCounts(rows) {
    const counts = { like: 0, love: 0, laugh: 0, wow: 0, cry: 0 };
    const mine = { like: false, love: false, laugh: false, wow: false, cry: false };
    let total = 0;

    (rows || []).forEach((r) => {
      if (counts[r.reaction_type] != null) {
        counts[r.reaction_type] += 1;
        total += 1;
      }
      if (currentUser && r.user_id === currentUser.id) {
        mine[r.reaction_type] = true;
      }
    });

    const hasMine = Object.values(mine).some(Boolean);
    return { counts, mine, total, hasMine };
  }

  function getThreadReactionState(threadId) {
    const rows = reactionsByThread[threadId] || [];
    return computeReactionCounts(rows);
  }

  function getCommentReactionState(commentId) {
    const rows = commentReactionsByComment[commentId] || [];
    return computeReactionCounts(rows);
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

      const reactState = getThreadReactionState(thread.id);
      const comments = commentsByThread[thread.id] || [];
      const mediaHtml = renderMedia(thread);

      const likeActiveClass = reactState.hasMine ? " tt-like-active" : "";
      const likeCountHtml =
        reactState.total > 0 ? `<span class="tt-like-count">${reactState.total}</span>` : "";

      const reactBarHtml = `
        <div class="tt-react-bar" data-tt-role="react-bar" hidden>
          ${REACTION_TYPES.map(
            (r) => `
            <button class="tt-react-pick"
                    type="button"
                    data-tt-role="react"
                    data-reaction="${r.key}">
              ${r.emoji}
            </button>
          `
          ).join("")}
        </div>
      `;

      const commentsHtml = renderComments(thread.id, comments);

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
          <button class="tt-like-btn${likeActiveClass}"
                  type="button"
                  data-tt-role="toggle-react-bar">
            🙂 ${likeCountHtml}
          </button>
          <button class="tt-respond-link"
                  type="button"
                  data-tt-role="respond">
            Reply
          </button>
        </div>
        ${reactBarHtml}

        <div class="tt-comments" data-thread="${thread.id}">
          <div class="tt-comments-list">
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

  function renderComments(threadId, comments) {
    if (!comments.length) return "";

    const maxVisible = 2;
    const pieces = [];

    comments.forEach((c, idx) => {
      const name = displayNameForUserId(c.author_id);
      const ts = timeAgo(c.created_at);
      const isMine = currentUser && c.author_id === currentUser.id;
      const reactState = getCommentReactionState(c.id);

      const likeActiveClass = reactState.hasMine ? " tt-like-active" : "";
      const likeCountHtml =
        reactState.total > 0 ? `<span class="tt-like-count">${reactState.total}</span>` : "";

      const hiddenClass = idx >= maxVisible ? " tt-comment-hidden" : "";

      const commentReactBar = `
        <div class="tt-comment-react-bar" data-tt-role="comment-react-bar" hidden>
          ${REACTION_TYPES.map(
            (r) => `
            <button class="tt-react-pick"
                    type="button"
                    data-tt-role="comment-react"
                    data-reaction="${r.key}">
              ${r.emoji}
            </button>
          `
          ).join("")}
        </div>
      `;

      pieces.push(`
        <div class="tt-comment${hiddenClass}" data-comment-id="${c.id}">
          <div class="tt-comment-head">${escapeHtml(name)} • ${ts}</div>
          <div class="tt-comment-body">${escapeHtml(c.body)}</div>
          <div class="tt-comment-foot">
            <button class="tt-like-btn tt-like-sm${likeActiveClass}"
                    type="button"
                    data-tt-role="comment-toggle-react-bar">
              🙂 ${likeCountHtml}
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
          ${commentReactBar}
        </div>
      `);
    });

    const hiddenCount = Math.max(0, comments.length - maxVisible);
    if (hiddenCount > 0) {
      pieces.splice(
        maxVisible,
        0,
        `<button class="tt-more-replies"
                 type="button"
                 data-tt-role="show-more-comments">
           View ${hiddenCount} more repl${hiddenCount === 1 ? "y" : "ies"}
         </button>`
      );
    }

    return pieces.join("");
  }

  function renderMedia(thread) {
    if (!thread.media_url || !thread.media_type) return "";
    if (thread.media_type === "image") {
      return `<img class="post-img" src="${escapeAttr(thread.media_url)}" alt="Post image"/>`;
    }
    if (thread.media_type === "video") {
      return `<video class="post-video" controls src="${escapeAttr(thread.media_url)}"></video>`;
    }
    return "";
  }

  // ---------- Composer ----------
  function wireComposer() {
    if (!composerForm) return;

    composerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      let body = (textArea.value || "").trim();
      let title = (titleInput && titleInput.value || "").trim();
      let cat = (categorySelect && categorySelect.value || "").trim();
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
          body = "image attached"; // fallback text when post is only media
        }

        const payload = {
          author_id: currentUser.id,
          category: cat,
          title: title,
          body: body,
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

        // Clear composer
        textArea.value = "";
        if (titleInput) titleInput.value = "";
        clearMediaPreview();

        // Prepend new thread and reload related data (reactions/comments)
        threads.unshift(data);
        await loadThreads();
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
      mediaPreview.appendChild(img);
    } else {
      const vid = document.createElement("video");
      vid.controls = true;
      vid.src = url;
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

  // ---------- Card interactions (reactions / comments / menu / zoom) ----------
  function wireCardDelegates() {
    if (!cardsEl) return;

    cardsEl.addEventListener("click", async (e) => {
      const target = e.target;
      if (!target) return;

      // Image zoom
      const img = target.closest(".post-img");
      if (img) {
        openLightbox(img.src);
        return;
      }

      const role =
        target.dataset.ttRole ||
        target.closest("[data-tt-role]")?.dataset.ttRole;
      if (!role) return;

      const card = target.closest(".card");
      const threadId = card ? Number(card.dataset.threadId) : null;

      switch (role) {
        case "toggle-react-bar":
          toggleThreadReactBar(card);
          break;
        case "react": {
          if (!threadId) return;
          const btn = target.closest("[data-reaction]");
          if (!btn) return;
          const type = btn.dataset.reaction;
          await handleThreadReaction(threadId, type, card);
          break;
        }
        case "comment-toggle-react-bar": {
          const commentEl = target.closest(".tt-comment");
          if (!commentEl) return;
          toggleCommentReactBar(commentEl);
          break;
        }
        case "comment-react": {
          const commentEl = target.closest(".tt-comment");
          if (!commentEl) return;
          const commentId = Number(commentEl.dataset.commentId);
          const btn = target.closest("[data-reaction]");
          if (!btn) return;
          const type = btn.dataset.reaction;
          await handleCommentReaction(commentId, type, commentEl);
          break;
        }
        case "send-comment":
          if (!threadId || !card) return;
          await handleSendComment(card, threadId);
          break;
        case "menu":
          if (!card) return;
          toggleMenu(card);
          break;
        case "edit-thread":
          if (!card || !threadId) return;
          await handleEditThread(card, threadId);
          break;
        case "delete-thread":
          if (!threadId) return;
          await handleDeleteThread(threadId);
          break;
        case "delete-comment": {
          const commentEl = target.closest(".tt-comment");
          if (!commentEl) return;
          const commentId = Number(commentEl.dataset.commentId);
          await handleDeleteComment(commentId);
          break;
        }
        case "respond":
          if (!card) return;
          focusCommentBox(card);
          break;
        case "show-more-comments":
          if (!card) return;
          revealMoreComments(card, target);
          break;
        default:
          break;
      }
    });
  }

  function toggleThreadReactBar(card) {
    if (!card) return;
    const bar = card.querySelector('[data-tt-role="react-bar"]');
    if (!bar) return;
    const hidden = bar.hasAttribute("hidden");
    if (hidden) bar.removeAttribute("hidden");
    else bar.setAttribute("hidden", "true");
  }

  function toggleCommentReactBar(commentEl) {
    if (!commentEl) return;
    const bar = commentEl.querySelector('[data-tt-role="comment-react-bar"]');
    if (!bar) return;
    const hidden = bar.hasAttribute("hidden");
    if (hidden) bar.removeAttribute("hidden");
    else bar.setAttribute("hidden", "true");
  }

  function revealMoreComments(card, buttonEl) {
    const list = card.querySelector(".tt-comments-list");
    if (!list) return;
    list.querySelectorAll(".tt-comment-hidden").forEach((el) => {
      el.classList.remove("tt-comment-hidden");
    });
    if (buttonEl) buttonEl.remove();
  }

  // Thread reactions (one per user per thread)
  async function handleThreadReaction(threadId, type, card) {
    if (!REACTION_TYPES.find((r) => r.key === type)) return;
    const ok = await ensureLoggedInFor("react");
    if (!ok) return;

    const existing = (reactionsByThread[threadId] || []).filter(
      (r) => r.user_id === currentUser.id
    );

    try {
      if (existing.length === 1 && existing[0].reaction_type === type) {
        // Clicking the same emoji again removes your reaction.
        const { error } = await supabase
          .from("threadtalk_reactions")
          .delete()
          .match({
            thread_id: threadId,
            user_id: currentUser.id,
            reaction_type: type
          });
        if (error) {
          console.warn("[ThreadTalk] reaction delete error", error);
          showToast("Could not update reaction.");
          return;
        }
      } else {
        // Switch reaction: delete all old ones for this thread/user, then insert the new type.
        if (existing.length) {
          const { error: delErr } = await supabase
            .from("threadtalk_reactions")
            .delete()
            .match({
              thread_id: threadId,
              user_id: currentUser.id
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
            reaction_type: type
          });

        if (insErr) {
          console.warn("[ThreadTalk] reaction insert error", insErr);
          showToast("Could not update reaction.");
          return;
        }
      }

      // Hide the picker and refresh card state
      if (card) {
        const bar = card.querySelector('[data-tt-role="react-bar"]');
        if (bar) bar.setAttribute("hidden", "true");
      }
      await loadThreads();
    } catch (err) {
      console.error("[ThreadTalk] handleThreadReaction exception", err);
      showToast("Could not update reaction.");
    }
  }

  // Comment reactions (one per user per comment)
  async function handleCommentReaction(commentId, type, commentEl) {
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

      if (commentEl) {
        const bar = commentEl.querySelector('[data-tt-role="comment-react-bar"]');
        if (bar) bar.setAttribute("hidden", "true");
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
      const { error } = await supabase
        .from("threadtalk_comments")
        .insert({
          thread_id: threadId,
          author_id: currentUser.id,
          body: body
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
    const input = card.querySelector(".tt-comment-input");
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus();
  }

  function toggleMenu(card) {
    const pop = card.querySelector('[data-tt-role="menu-pop"]');
    if (!pop) return;
    const hidden = pop.hasAttribute("hidden");
    if (hidden) pop.removeAttribute("hidden");
    else pop.setAttribute("hidden", "true");
  }

  async function handleEditThread(card, threadId) {
    const thread = threads.find((t) => t.id === threadId);
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
            body: body,
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
    const thread = threads.find((t) => t.id === threadId);
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
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
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
    let targetComment = null;
    let targetThreadId = null;

    Object.keys(commentsByThread).forEach((tid) => {
      const list = commentsByThread[tid] || [];
      list.forEach((c) => {
        if (c.id === commentId) {
          targetComment = c;
          targetThreadId = Number(tid);
        }
      });
    });

    if (!targetComment) return;
    if (!currentUser || targetComment.author_id !== currentUser.id) {
      showToast("You can only delete your own comments.");
      return;
    }

    const ok = confirm("Delete this comment?");
    if (!ok) return;

    try {
      const { error } = await supabase
        .from("threadtalk_comments")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
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

  // ---------- Lightbox (image zoom) ----------
  let lightboxEl = null;
  function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    const overlay = document.createElement("div");
    overlay.id = "tt-lightbox";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.7)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";
    overlay.style.cursor = "zoom-out";
    overlay.hidden = true;

    const img = document.createElement("img");
    img.style.maxWidth = "92vw";
    img.style.maxHeight = "92vh";
    img.style.boxShadow = "0 18px 40px rgba(0,0,0,0.45)";
    img.style.borderRadius = "14px";
    overlay.appendChild(img);

    overlay.addEventListener("click", () => {
      overlay.hidden = true;
    });

    document.body.appendChild(overlay);
    lightboxEl = overlay;
    return overlay;
  }

  function openLightbox(src) {
    const overlay = ensureLightbox();
    const img = overlay.querySelector("img");
    img.src = src;
    overlay.hidden = false;
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

    // e.g. "Nov 26, 2025, 8:47 PM"
    return then.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  // Inject small CSS overrides to keep posts compact
  function injectCompactStyles() {
    const css = `
      .card{padding:12px 14px;margin-bottom:10px;}
      .preview{margin-bottom:4px;font-size:14px;}
      .tt-head{display:flex;flex-direction:column;gap:2px;margin-bottom:4px;}
      .tt-line1{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;font-size:14px;}
      .tt-line2{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--muted);}
      .tt-line2-main{display:flex;align-items:center;gap:4px;}
      .tt-title{font-weight:600;color:#3f2f2a;}
      .tt-actions-row{display:flex;align-items:center;gap:12px;margin-top:4px;font-size:13px;}
      .tt-like-btn{border:none;background:transparent;padding:0 4px;border-radius:999px;display:inline-flex;align-items:center;gap:4px;color:var(--muted);cursor:pointer;}
      .tt-like-sm{font-size:12px;}
      .tt-like-active{color:#b91c1c;font-weight:600;}
      .tt-like-count{font-size:11px;background:#fee2e2;color:#991b1b;border-radius:999px;padding:0 6px;line-height:16px;}
      .tt-respond-link,.tt-comment-reply{border:none;background:transparent;padding:0;color:var(--muted);cursor:pointer;font-size:12px;}
      .tt-react-bar,.tt-comment-react-bar{display:flex;gap:4px;margin-top:4px;}
      .tt-react-pick{border:none;background:#fff;border-radius:999px;padding:2px 6px;font-size:13px;cursor:pointer;box-shadow:0 0 0 1px var(--border);}
      .tt-comments{margin-top:6px;gap:6px;}
      .tt-comments-list{display:flex;flex-direction:column;gap:4px;}
      .tt-comment{padding:6px 8px;border-radius:8px;background:#fdfaf8;}
      .tt-comment-head{font-size:12px;color:var(--muted);margin-bottom:2px;}
      .tt-comment-body{font-size:13px;margin-bottom:2px;}
      .tt-comment-foot{display:flex;align-items:center;gap:8px;}
      .tt-comment-delete{border:none;background:transparent;padding:0;color:#b91c1c;font-size:11px;cursor:pointer;}
      .tt-comment-hidden{display:none;}
      .tt-more-replies{border:none;background:transparent;color:var(--muted);font-size:12px;padding:0 4px;margin:2px 0;cursor:pointer;}
      .post-img,.post-video{margin-top:4px;margin-bottom:4px;max-height:260px;border-radius:10px;cursor:pointer;}
      .tt-menu-btn{padding:2px 6px;font-size:14px;}
    `;
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
