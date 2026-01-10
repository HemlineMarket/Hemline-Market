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

  // Admin emails - can edit/delete any post
  const ADMIN_EMAILS = [
    "roza.amin@gmail.com",
    "roza@hemlinemarket.com",
    "hello@hemlinemarket.com"
  ];

  function isAdmin() {
    return currentUser && currentUser.email && ADMIN_EMAILS.includes(currentUser.email.toLowerCase());
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
    cosplay: "Cosplay",
    "stitch-school": "Stitch School",
    "fabric-sos": "Fabric SOS",
    "before-after": "Before & After",
    "pattern-hacks": "Pattern Hacks",
    tailoring: "Tailoring",
    "loose-threads": "Loose Threads",
  };

  const CATEGORY_LINKS = {
    showcase: "showcase.html",
    cosplay: "cosplay.html",
    "stitch-school": "stitch-school.html",
    "fabric-sos": "fabric-sos.html",
    "before-after": "before-after.html",
    "pattern-hacks": "pattern-hacks.html",
    tailoring: "tailoring.html",
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
        .select("id, store_name, first_name, last_name, avatar_url, is_founder, is_early_seller, seller_number, stripe_account_id")
        .in("id", ids);

      (data || []).forEach((p) => (profilesCache[p.id] = p));
    } catch (_) {
      // ignore
    }
  }

  // Generate badge HTML for a user
  function getBadgeHtml(userId) {
    const p = profilesCache[userId];
    if (!p) return "";
    
    // Only show badges for verified sellers (has stripe_account_id)
    if (!p.stripe_account_id) return "";
    
    let badges = "";
    
    // Founder badge (red with star) - highest priority
    if (p.is_founder) {
      badges += '<span class="badge-founder badge-sm">Founder</span>';
    }
    // OG Seller badge (gold with crown) - first 300 verified sellers
    else if (p.is_early_seller) {
      badges += '<span class="badge-og-seller badge-sm">OG Seller</span>';
    }
    // Verified badge (green) - all other verified sellers
    else {
      badges += '<span class="badge-verified badge-sm">Verified</span>';
    }
    
    return badges ? `<span class="seller-badges-inline">${badges}</span>` : "";
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

      // Always include current user so founder/edit checks work
      if (currentUser?.id) {
        authorIds.push(currentUser.id);
      }

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
      const isFounder = currentUser && profilesCache[currentUser.id]?.is_founder;
      const canEdit = isMine || isFounder;

      const menuHtml = canEdit
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
      const badgeHtml = getBadgeHtml(thread.author_id);
      const authorHtml = thread.author_id
        ? `<a class="card-author" href="atelier.html?u=${encodeURIComponent(thread.author_id)}">${escapeHtml(authorName)}</a>${badgeHtml}`
        : `<span class="card-author">${escapeHtml(authorName)}</span>`;

      // Get user avatar (photo or initials)
      const avatarHtml = getAvatarHtml(thread.author_id);
      const currentUserAvatar = getCurrentUserAvatarHtml();
      
      // Avatar link to atelier
      const avatarLink = thread.author_id 
        ? `<a href="atelier.html?u=${encodeURIComponent(thread.author_id)}" class="card-avatar-link">${avatarHtml}</a>`
        : avatarHtml;

      card.innerHTML = `
        <div class="card-header">
          <div class="card-avatar">${avatarLink}</div>
          <div class="card-meta">
            ${authorHtml}
            <div class="card-info">
              <span>${when}</span> · <a href="${catLink}">${escapeHtml(catLabel)}</a>
            </div>
            ${title ? `<div class="card-title">${escapeHtml(title)}</div>` : ""}
          </div>
          ${canEdit ? `
            <div class="tt-menu">
              <button class="tt-menu-btn" type="button" data-tt-role="menu">···</button>
              <div class="tt-menu-pop" data-tt-role="menu-pop" hidden>
                <button class="tt-menu-item" type="button" data-tt-role="edit-thread">Edit</button>
                <button class="tt-menu-item danger" type="button" data-tt-role="delete-thread">Delete</button>
              </div>
            </div>` : ""}
        </div>

        <div class="card-body">${linkify(thread.body || "")}</div>
        ${mediaHtml ? `<div class="card-media">${mediaHtml}</div>` : ""}

        ${reactionSummaryHtml ? `<div class="card-reactions">${reactionSummaryHtml}</div>` : ""}

        <div class="card-actions">
          <div class="tt-like-wrapper">
            <button class="card-action${myType ? " active" : ""}" type="button" data-tt-role="thread-like-toggle">
              <svg viewBox="0 0 24 24"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
              Like
            </button>
            <div class="tt-react-picker">
              <button type="button" data-tt-role="thread-react" data-reaction="like" title="Like">👍</button>
              <button type="button" data-tt-role="thread-react" data-reaction="love" title="Love">❤️</button>
              <button type="button" data-tt-role="thread-react" data-reaction="laugh" title="Haha">😂</button>
              <button type="button" data-tt-role="thread-react" data-reaction="wow" title="Wow">😮</button>
              <button type="button" data-tt-role="thread-react" data-reaction="cry" title="Sad">😢</button>
            </div>
          </div>
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

    const isMine = currentUser && c.author_id === currentUser.id;
    const isFounder = currentUser && profilesCache[currentUser.id]?.is_founder;
    const canEdit = isMine || isFounder;

    const deleteHtml = canEdit
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
    const commentBadgeHtml = getBadgeHtml(c.author_id);
    const authorHtml = c.author_id
      ? `<a class="comment-author" href="atelier.html?u=${encodeURIComponent(c.author_id)}">${escapeHtml(name)}</a>${commentBadgeHtml}`
      : `<span class="comment-author">${escapeHtml(name)}</span>`;

    // Get user avatar (photo or initials)
    const commentAvatarHtml = getAvatarHtml(c.author_id);
    
    // Avatar link to atelier
    const commentAvatarLink = c.author_id
      ? `<a href="atelier.html?u=${encodeURIComponent(c.author_id)}" class="comment-avatar-link">${commentAvatarHtml}</a>`
      : commentAvatarHtml;

    // Get current user avatar for reply box
    const replyAvatarHtml = getCurrentUserAvatarHtml();

    return `
      <div class="tt-comment comment${d > 0 ? ' nested' : ''}${d > 1 ? ' nested-deep' : ''}" data-comment-id="${c.id}" data-thread-id="${threadId}" data-depth="${d}">
        <div class="comment-avatar">${commentAvatarLink}</div>
        <div class="comment-content">
          <div class="comment-bubble-row">
            <div class="comment-bubble">
              ${authorHtml}
              <div class="comment-text">${linkify(c.body)}</div>
            </div>
            ${deleteHtml}
          </div>
          ${mediaHtml}
          <div class="comment-meta">
            <div class="tt-like-wrapper comment-like-wrapper">
              <button type="button" class="${myType ? 'active' : ''}" data-tt-role="comment-like-toggle" data-comment-id="${c.id}">Like</button>
              <div class="tt-react-picker comment-react-picker">
                <button type="button" data-tt-role="comment-react" data-comment-id="${c.id}" data-reaction="like" title="Like">👍</button>
                <button type="button" data-tt-role="comment-react" data-comment-id="${c.id}" data-reaction="love" title="Love">❤️</button>
                <button type="button" data-tt-role="comment-react" data-comment-id="${c.id}" data-reaction="laugh" title="Haha">😂</button>
                <button type="button" data-tt-role="comment-react" data-comment-id="${c.id}" data-reaction="wow" title="Wow">😮</button>
                <button type="button" data-tt-role="comment-react" data-comment-id="${c.id}" data-reaction="cry" title="Sad">😢</button>
              </div>
            </div>
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
          if (!wrapper) {
            // Fallback: just toggle like if no wrapper
            if (threadId) await handleThreadReaction(threadId, "like");
            return;
          }
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
          console.log("[ThreadTalk] respond clicked, card:", card);
          focusCommentBox(card);
          break;

        case "focus-comment-input":
          console.log("[ThreadTalk] focus-comment-input clicked, card:", card);
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
          const commentId = Number(roleEl.dataset.commentId);
          if (commentId) {
            // Open picker to select reaction
            const wrapper = roleEl.closest(".tt-like-wrapper");
            if (!wrapper) {
              // Fallback: just toggle like if no wrapper
              await handleCommentReaction(commentId, "like");
              return;
            }
            const isOpen = wrapper.classList.contains("tt-picker-open");
            closeAllPickers();
            if (!isOpen) wrapper.classList.add("tt-picker-open");
          }
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
    // Check reply box first, then main comment input row
    let container =
      row.closest(".tt-comment-reply-box") ||
      row.closest(".comment-input-row") ||
      row.closest(".tt-comment-new");
    if (!container) {
      console.warn("[ThreadTalk] handleSendComment: no container found");
      return;
    }

    // Try multiple input selectors
    const input = container.querySelector(".tt-comment-input") || 
                  container.querySelector(".comment-input");
    const fileInput = container.querySelector(".tt-comment-photo") ||
                      container.querySelector("[data-tt-role='comment-photo']");

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
    if (!card) {
      console.warn("[ThreadTalk] focusCommentBox: no card");
      return;
    }
    // Try multiple selectors for the comment input
    const input = card.querySelector(".comment-input-row .comment-input") || 
                  card.querySelector(".comment-input") ||
                  card.querySelector("input[placeholder*='comment']");
    if (!input) {
      console.warn("[ThreadTalk] focusCommentBox: no input found in card");
      return;
    }

    // Scroll and focus
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => input.focus(), 300); // Small delay for scroll to complete
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

    // Allow edit if user is author OR admin
    if (!currentUser || (thread.author_id !== currentUser.id && !isAdmin())) {
      showToast("You can only edit your own posts.");
      return;
    }

    // Get card elements
    const cardBody = card.querySelector(".card-body");
    const cardMedia = card.querySelector(".card-media");
    const cardReactions = card.querySelector(".card-reactions");
    const linkPreview = card.querySelector(".tt-link-preview-wrap, .tt-youtube-embed, .tt-tiktok-embed");
    
    if (!cardBody) return;

    // Get original data from the thread object (not from DOM which may be hidden)
    const originalBody = thread.body || "";
    const originalMediaUrl = thread.media_url;
    const originalMediaType = thread.media_type;

    // Track edit state
    let newMediaFile = null;
    let newMediaType = null; 
    let keepOriginalMedia = !!(originalMediaUrl && originalMediaType);
    let removeLinkPreview = false;

    // Check if there's a link in the body (for link preview)
    const hasLinkInBody = /https?:\/\/[^\s]+/.test(originalBody);

    // Build the edit UI
    let editHtml = `
      <div class="tt-edit-container">
        <textarea class="tt-edit-area" placeholder="What's on your mind?">${escapeHtml(originalBody)}</textarea>
    `;

    // Show current uploaded media if exists
    if (originalMediaUrl && originalMediaType) {
      if (originalMediaType === "video") {
        editHtml += `
          <div class="tt-edit-current-media" data-has-media="true">
            <div class="tt-edit-media-item">
              <video src="${escapeAttr(originalMediaUrl)}" controls></video>
              <button type="button" class="tt-edit-remove-media" title="Remove">✕</button>
            </div>
          </div>
        `;
      } else {
        // image or images
        let urls = [];
        try {
          urls = originalMediaType === "images" ? JSON.parse(originalMediaUrl) : [originalMediaUrl];
        } catch {
          urls = [originalMediaUrl];
        }
        editHtml += `
          <div class="tt-edit-current-media" data-has-media="true">
            ${urls.map((u, i) => `
              <div class="tt-edit-media-item">
                <img src="${escapeAttr(u)}" alt="Image ${i + 1}" />
                <button type="button" class="tt-edit-remove-media" title="Remove">✕</button>
              </div>
            `).join("")}
          </div>
        `;
      }
    }

    // Show link preview notice if there's a link in the body
    if (hasLinkInBody) {
      editHtml += `
        <div class="tt-edit-link-preview-notice">
          <span>📎 Link preview attached</span>
          <button type="button" class="tt-edit-remove-link-preview">Remove link</button>
        </div>
      `;
    }

    // New media upload section
    editHtml += `
        <div class="tt-edit-new-media">
          <div class="tt-edit-new-media-preview"></div>
        </div>
        
        <div class="tt-edit-toolbar">
          <div class="tt-edit-add-media">
            <label class="tt-edit-add-btn" title="Add photo">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
              <input type="file" accept="image/*" class="tt-edit-photo-input" hidden />
            </label>
            <label class="tt-edit-add-btn" title="Add video">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              <input type="file" accept="video/*" class="tt-edit-video-input" hidden />
            </label>
          </div>
          <div class="tt-edit-buttons">
            <button type="button" class="tt-edit-cancel-btn">Cancel</button>
            <button type="button" class="tt-edit-save-btn">Save</button>
          </div>
        </div>
      </div>
    `;

    // Hide other card elements while editing
    if (cardMedia) cardMedia.style.display = "none";
    if (linkPreview) linkPreview.style.display = "none";
    if (cardReactions) cardReactions.style.display = "none";

    // Make card-body visible and show edit UI
    cardBody.style.display = "";
    cardBody.innerHTML = editHtml;

    // Get references
    const textarea = cardBody.querySelector(".tt-edit-area");
    const saveBtn = cardBody.querySelector(".tt-edit-save-btn");
    const cancelBtn = cardBody.querySelector(".tt-edit-cancel-btn");
    const currentMediaContainer = cardBody.querySelector(".tt-edit-current-media");
    const removeMediaBtns = cardBody.querySelectorAll(".tt-edit-remove-media");
    const removeLinkPreviewBtn = cardBody.querySelector(".tt-edit-remove-link-preview");
    const linkPreviewNotice = cardBody.querySelector(".tt-edit-link-preview-notice");
    const newMediaPreview = cardBody.querySelector(".tt-edit-new-media-preview");
    const photoInput = cardBody.querySelector(".tt-edit-photo-input");
    const videoInput = cardBody.querySelector(".tt-edit-video-input");

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // Remove uploaded media
    removeMediaBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        keepOriginalMedia = false;
        if (currentMediaContainer) currentMediaContainer.style.display = "none";
      });
    });

    // Remove link preview (removes URL from text)
    if (removeLinkPreviewBtn) {
      removeLinkPreviewBtn.addEventListener("click", () => {
        removeLinkPreview = true;
        // Remove URLs from textarea
        textarea.value = textarea.value.replace(/https?:\/\/[^\s]+/g, "").trim();
        if (linkPreviewNotice) linkPreviewNotice.style.display = "none";
      });
    }

    // Add new photo
    photoInput.addEventListener("change", () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      
      newMediaFile = file;
      newMediaType = "image";
      keepOriginalMedia = false;
      if (currentMediaContainer) currentMediaContainer.style.display = "none";

      const url = URL.createObjectURL(file);
      newMediaPreview.innerHTML = `
        <div class="tt-edit-media-item">
          <img src="${url}" alt="New image" />
          <button type="button" class="tt-edit-remove-new-media" title="Remove">✕</button>
        </div>
      `;
      newMediaPreview.querySelector(".tt-edit-remove-new-media").addEventListener("click", () => {
        newMediaFile = null;
        newMediaType = null;
        newMediaPreview.innerHTML = "";
        photoInput.value = "";
      });
    });

    // Add new video
    videoInput.addEventListener("change", () => {
      const file = videoInput.files?.[0];
      if (!file) return;
      
      newMediaFile = file;
      newMediaType = "video";
      keepOriginalMedia = false;
      if (currentMediaContainer) currentMediaContainer.style.display = "none";

      const url = URL.createObjectURL(file);
      newMediaPreview.innerHTML = `
        <div class="tt-edit-media-item">
          <video src="${url}" controls></video>
          <button type="button" class="tt-edit-remove-new-media" title="Remove">✕</button>
        </div>
      `;
      newMediaPreview.querySelector(".tt-edit-remove-new-media").addEventListener("click", () => {
        newMediaFile = null;
        newMediaType = null;
        newMediaPreview.innerHTML = "";
        videoInput.value = "";
      });
    });

    // Cancel - reload threads to restore original state
    cancelBtn.addEventListener("click", async () => {
      await loadThreads();
    });

    // Save
    saveBtn.addEventListener("click", async () => {
      let body = (textarea.value || "").trim();

      // Validate - need either text or media
      const willHaveMedia = newMediaFile || keepOriginalMedia;
      if (!body && !willHaveMedia) {
        showToast("Post cannot be empty");
        textarea.focus();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      try {
        let finalMediaUrl = keepOriginalMedia ? originalMediaUrl : null;
        let finalMediaType = keepOriginalMedia ? originalMediaType : null;

        // Upload new media if selected
        if (newMediaFile) {
          const ext = newMediaFile.name.split(".").pop().toLowerCase();
          const path = `${currentUser.id}/thread-${Date.now()}.${ext}`;

          const { data, error: uploadErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(path, newMediaFile, {
              cacheControl: "3600",
              upsert: false,
              contentType: newMediaFile.type,
            });

          if (uploadErr) {
            console.error("[ThreadTalk] upload error", uploadErr);
            showToast("Upload failed");
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
            return;
          }

          const { data: pub } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(data.path);

          finalMediaUrl = pub?.publicUrl || null;
          finalMediaType = newMediaType;
        }

        // Build update query - admins can edit any post
        let updateQuery = supabase
          .from("threadtalk_threads")
          .update({
            body,
            media_url: finalMediaUrl,
            media_type: finalMediaType,
            updated_at: new Date().toISOString(),
          })
          .eq("id", threadId);
        
        // Only add author filter if not admin (RLS will handle it, but this is extra safety)
        if (!isAdmin()) {
          updateQuery = updateQuery.eq("author_id", currentUser.id);
        }

        const { error } = await updateQuery;

        if (error) {
          console.error("[ThreadTalk] update error", error);
          showToast("Could not save");
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
          return;
        }

        showToast("Saved!");
        await loadThreads();
      } catch (err) {
        console.error("[ThreadTalk] save exception", err);
        showToast("Could not save");
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
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

  // ---------- Link previews (YouTube embeds + website cards) ----------
  async function attachLinkPreview(card, thread) {
    const body = thread.body || "";
    const urlMatch = body.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) return;

    const url = urlMatch[0];
    
    const actionsRow = card.querySelector(".card-actions");
    if (!actionsRow) {
      return;
    }

    // Check if this is a YouTube URL - if so, embed the video
    if (isYoutubeUrl(url)) {
      const videoId = extractYoutubeId(url);
      if (videoId) {
        const container = document.createElement("div");
        container.className = "tt-youtube-embed";
        container.innerHTML = `
          <iframe 
            src="https://www.youtube.com/embed/${videoId}" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen>
          </iframe>
        `;
        card.insertBefore(container, actionsRow);
        
        // Hide the raw URL in the card body
        const cardBody = card.querySelector(".card-body");
        if (cardBody) {
          cardBody.innerHTML = cardBody.innerHTML.replace(
            /<a[^>]*href="[^"]*"[^>]*>[^<]*<\/a>/gi,
            ''
          ).trim();
          // If body is now empty or just whitespace, hide it
          if (!cardBody.textContent.trim()) {
            cardBody.style.display = 'none';
          }
        }
        return;
      }
    }

    // Check if this is a TikTok URL - if so, embed the video (only works for /video/ posts, not /photo/)
    if (isTiktokUrl(url)) {
      const tiktokInfo = extractTiktokInfo(url);
      
      // Only embed actual videos, not photo slideshows
      if (tiktokInfo.type === "video" && tiktokInfo.id) {
        const container = document.createElement("div");
        container.className = "tt-tiktok-embed";
        
        // Use iframe embed which is more reliable than blockquote method
        container.innerHTML = `
          <iframe
            src="https://www.tiktok.com/embed/v2/${escapeAttr(tiktokInfo.id)}"
            frameborder="0"
            allow="autoplay; encrypted-media"
            allowfullscreen>
          </iframe>
        `;
        card.insertBefore(container, actionsRow);
        
        // Hide the raw URL in the card body
        const cardBody = card.querySelector(".card-body");
        if (cardBody) {
          cardBody.innerHTML = cardBody.innerHTML.replace(
            /<a[^>]*href="[^"]*"[^>]*>[^<]*<\/a>/gi,
            ''
          ).trim();
          // If body is now empty or just whitespace, hide it
          if (!cardBody.textContent.trim()) {
            cardBody.style.display = 'none';
          }
        }
        return;
      }
      
      // For photo posts, short URLs, or other TikTok content, show a nice preview card
      if (tiktokInfo.type === "photo" || tiktokInfo.type === "short" || tiktokInfo.id) {
        const container = document.createElement("div");
        container.className = "tt-link-preview-wrap";
        
        container.innerHTML = `
          <a class="tt-link-card tt-tiktok-card"
             href="${escapeAttr(url)}"
             target="_blank"
             rel="noopener noreferrer">
            <div class="tt-link-thumb tt-tiktok-thumb">
              <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M34.1451 16.3362C33.1954 16.3362 32.2948 16.0987 31.5 15.6766V24.8571C31.5 29.0667 28.0667 32.5 23.8571 32.5C19.6476 32.5 16.2143 29.0667 16.2143 24.8571C16.2143 20.6476 19.6476 17.2143 23.8571 17.2143C24.1879 17.2143 24.5118 17.2398 24.8286 17.2857V20.7857C24.5118 20.7398 24.1879 20.7143 23.8571 20.7143C21.5699 20.7143 19.7143 22.5699 19.7143 24.8571C19.7143 27.1444 21.5699 29 23.8571 29C26.1444 29 28 27.1444 28 24.8571V8H31.5C31.5 11.0376 33.9624 13.5 37 13.5V17C35.9572 17 34.9731 16.7649 34.1451 16.3362Z" fill="currentColor"/>
              </svg>
            </div>
            <div class="tt-link-meta">
              <div class="tt-link-title">View on TikTok</div>
              <div class="tt-link-host">tiktok.com${tiktokInfo.type === "photo" ? " • Photo" : ""}</div>
            </div>
          </a>
        `;
        
        card.insertBefore(container, actionsRow);
        
        // Hide the raw URL in the card body
        const cardBody = card.querySelector(".card-body");
        if (cardBody) {
          cardBody.innerHTML = cardBody.innerHTML.replace(
            /<a[^>]*href="[^"]*"[^>]*>[^<]*<\/a>/gi,
            ''
          ).trim();
          if (!cardBody.textContent.trim()) {
            cardBody.style.display = 'none';
          }
        }
        return;
      }
    }

    // For non-YouTube URLs, fetch metadata and show preview card
    let previewData = null;
    try {
      previewData = await fetchLinkMetadata(url);
    } catch (_) {
      previewData = null;
    }

    const rawTitle =
      (previewData && (previewData.title || previewData.ogTitle)) || "";
    let title = rawTitle;
    // Decode HTML entities like &#x20;
    if (title) {
      const txt = document.createElement('textarea');
      txt.innerHTML = title;
      title = txt.value;
    }
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

    // Only show preview card if we have useful metadata
    if (title || thumb) {
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
            ${title ? `<div class="tt-link-title">${escapeHtml(title)}</div>` : ""}
            ${
              host
                ? `<div class="tt-link-host">${escapeHtml(host)}</div>`
                : ""
            }
          </div>
        </a>
      `;

      card.insertBefore(container, actionsRow);
      
      // Hide the raw URL in the card body since we have a nice preview
      const cardBody = card.querySelector(".card-body");
      if (cardBody) {
        cardBody.innerHTML = cardBody.innerHTML.replace(
          /<a[^>]*href="[^"]*"[^>]*>[^<]*<\/a>/gi,
          ''
        ).trim();
        // If body is now empty or just whitespace, hide it
        if (!cardBody.textContent.trim()) {
          cardBody.style.display = 'none';
        }
      }
    }
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

  function isTiktokUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      return (
        host === "tiktok.com" ||
        host === "m.tiktok.com" ||
        host === "vm.tiktok.com" ||
        host === "vt.tiktok.com"
      );
    } catch (_) {
      return false;
    }
  }

  function extractTiktokInfo(url) {
    try {
      const u = new URL(url);
      const path = u.pathname;
      
      // Handle various TikTok URL formats:
      // https://www.tiktok.com/@username/video/1234567890
      // https://www.tiktok.com/@username/photo/1234567890
      // https://www.tiktok.com/t/ZP8ytAnkg/ (short URL on main domain)
      // https://vm.tiktok.com/ABC123/
      
      // Check for video format: /@username/video/VIDEO_ID
      const videoMatch = path.match(/\/video\/(\d+)/);
      if (videoMatch) {
        return { type: "video", id: videoMatch[1] };
      }
      
      // Check for photo format: /@username/photo/PHOTO_ID
      const photoMatch = path.match(/\/photo\/(\d+)/);
      if (photoMatch) {
        return { type: "photo", id: photoMatch[1] };
      }
      
      // Short URL formats (can't tell type without fetching, show preview card)
      const host = u.hostname.replace(/^www\./, "").toLowerCase();
      
      // Handle /t/SHORTCODE format on main tiktok.com domain
      const shortTMatch = path.match(/^\/t\/([A-Za-z0-9_-]+)/);
      if (shortTMatch) {
        return { type: "short", id: shortTMatch[1] };
      }
      
      // Handle vm.tiktok.com and vt.tiktok.com short URLs
      if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
        const shortCode = path.replace(/^\//, "").replace(/\/$/, "");
        return { type: "short", id: shortCode };
      }
      
      return { type: null, id: null };
    } catch (_) {
      return { type: null, id: null };
    }
  }

  // Keep old function for backwards compatibility but have it use new one
  function extractTiktokId(url) {
    const info = extractTiktokInfo(url);
    return info.id || "";
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
