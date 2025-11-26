// scripts/threadtalk.js
(function () {
  const supabase = window.supabase;
  if (!supabase) {
    console.error("Supabase client not found on window.");
    return;
  }

  // DOM elements
  const composerForm = document.getElementById("composer");
  const catSelect = document.getElementById("composeCategory");
  const textArea = document.getElementById("composeText");
  const photoInput = document.getElementById("photoInput");
  const videoInput = document.getElementById("videoInput");
  const previewWrap = document.getElementById("mediaPreview");
  const cardsEl = document.getElementById("cards");
  const emptyState = document.getElementById("emptyState");
  const toastEl = document.getElementById("toast");

  // Category slugs -> labels & links
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

  // Reactions we support (one per user per thread)
  const REACTION_TYPES = [
    { key: "heart", emoji: "❤️", label: "Love" },
    { key: "fire",  emoji: "🔥", label: "Fire" },
    { key: "tear",  emoji: "😭", label: "Crying" }
  ];

  // Auth + profiles
  let currentUser = null;
  const profileCache = new Map(); // user_id -> profile row

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2000);
  }

  function requireLogin() {
    showToast("Sign in to post and react in ThreadTalk.");
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return diffMin + " min ago";
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + " hr" + (diffHr > 1 ? "s" : "") + " ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function normalizeCategory(value) {
    const v = (value || "").trim().toLowerCase();
    if (!v) return "loose-threads";
    if (CATEGORY_LABELS[v]) return v;
    return "loose-threads";
  }

  async function loadCurrentUser() {
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data || !data.user) {
        currentUser = null;
        // Gate composer if logged out
        if (composerForm && textArea && catSelect) {
          textArea.placeholder = "Sign in to post in ThreadTalk.";
          textArea.disabled = true;
          catSelect.disabled = true;
          const postBtn = document.getElementById("postBtn");
          if (postBtn) postBtn.disabled = true;
        }
        return;
      }

      currentUser = data.user;

      // Composer enabled for logged in users
      if (textArea && catSelect) {
        textArea.disabled = false;
        catSelect.disabled = false;
        const postBtn = document.getElementById("postBtn");
        if (postBtn) postBtn.disabled = false;
      }
    } catch (e) {
      console.error("Error loading current user", e);
      currentUser = null;
    }
  }

  async function loadProfiles(userIds) {
    const missing = userIds.filter(
      (id) => id && !profileCache.has(id)
    );
    if (!missing.length) return;

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, store_name, first_name, last_name")
        .in("id", missing);

      if (error) {
        console.error("Error loading profiles", error);
        return;
      }
      if (!data) return;

      data.forEach((row) => {
        profileCache.set(row.id, row);
      });
    } catch (e) {
      console.error("Exception loading profiles", e);
    }
  }

  function displayNameFor(userId) {
    const row = profileCache.get(userId);
    if (!row) return "Unknown member";

    const storeName = (row.store_name || "").trim();
    if (storeName) return storeName;

    const first = (row.first_name || "").trim();
    const last = (row.last_name || "").trim();
    if (first) {
      const initial = last ? (last[0].toUpperCase() + ".") : "";
      return (first + (initial ? " " + initial : "")).trim();
    }

    return "Unknown member";
  }

  function categoryMeta(catSlug) {
    const slug = normalizeCategory(catSlug);
    return {
      slug,
      label: CATEGORY_LABELS[slug] || "Loose Threads",
      href: CATEGORY_LINKS[slug] || "loose-threads.html"
    };
  }

  function clearPreview() {
    if (!previewWrap) return;
    previewWrap.innerHTML = "";
    previewWrap.hidden = true;
  }

  function showPreview(file, kind) {
    if (!previewWrap || !file) return;
    const url = URL.createObjectURL(file);
    previewWrap.hidden = false;
    previewWrap.innerHTML = "";
    if (kind === "image") {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "preview image";
      previewWrap.appendChild(img);
    } else {
      const vid = document.createElement("video");
      vid.controls = true;
      vid.src = url;
      previewWrap.appendChild(vid);
    }
  }

  function wireMediaInputs() {
    if (photoInput) {
      photoInput.addEventListener("change", function () {
        if (this.files && this.files[0]) {
          if (videoInput) videoInput.value = "";
          showPreview(this.files[0], "image");
        }
      });
    }
    if (videoInput) {
      videoInput.addEventListener("change", function () {
        if (this.files && this.files[0]) {
          if (photoInput) photoInput.value = "";
          showPreview(this.files[0], "video");
        }
      });
    }
  }

  async function handleComposerSubmit(evt) {
    evt.preventDefault();
    if (!currentUser) {
      requireLogin();
      return;
    }
    if (!textArea || !catSelect) return;

    const body = (textArea.value || "").trim();
    if (!body) {
      textArea.focus();
      return;
    }

    const catSlug = normalizeCategory(catSelect.value);

    // NOTE: media upload is NOT yet wired to Supabase storage.
    // For now, we ignore attachments for persistence and only keep local preview.
    let mediaType = null;
    let mediaUrl = null;
    if (photoInput && photoInput.files && photoInput.files[0]) {
      mediaType = "image";
      mediaUrl = null;
    } else if (videoInput && videoInput.files && videoInput.files[0]) {
      mediaType = "video";
      mediaUrl = null;
    }

    try {
      const { data, error } = await supabase
        .from("tt_threads")
        .insert({
          user_id: currentUser.id,
          category: catSlug,
          body: body,
          media_type: mediaType,
          media_url: mediaUrl
        })
        .select("id, user_id, category, body, created_at")
        .single();

      if (error) {
        console.error("Error inserting thread", error);
        showToast("Could not post. Please try again.");
        return;
      }

      textArea.value = "";
      if (catSelect.value === "") {
        // keep it blank in UI if user left it blank
      }
      if (photoInput) photoInput.value = "";
      if (videoInput) videoInput.value = "";
      clearPreview();

      showToast("Posted");
      await loadFeed(); // refresh list so it appears under Latest Threads (and category pages via shared table)
    } catch (e) {
      console.error("Exception inserting thread", e);
      showToast("Could not post. Please try again.");
    }
  }

  function buildReactionCounts(rawReactions) {
    const counts = { heart: 0, fire: 0, tear: 0 };
    rawReactions.forEach((r) => {
      if (r.reaction === "heart") counts.heart++;
      else if (r.reaction === "fire") counts.fire++;
      else if (r.reaction === "tear") counts.tear++;
    });
    return counts;
  }

  function renderThreadCard(thread, reactionsForThread, myReaction) {
    const meta = categoryMeta(thread.category);
    const name = displayNameFor(thread.user_id);
    const timeLabel = formatTime(thread.created_at);

    const counts = buildReactionCounts(reactionsForThread || []);

    const card = document.createElement("article");
    card.className = "card";
    card.dataset.threadId = thread.id;

    let html = "";
    html += '<div class="meta">';
    // avatar is hidden via CSS; we just keep DOM simple and not render initials at all
    html += "<span>" + name + "</span>";
    if (timeLabel) {
      html += " • <span>" + timeLabel + "</span>";
    }
    html += "</div>";

    html += '<div class="title">';
    html +=
      '<a class="cat" href="' +
      meta.href +
      '">[' +
      meta.label +
      "]</a>";
    html += "</div>";

    // No persisted media yet – you can add later from media_type/media_url
    html += '<div class="preview">' + escapeHtml(thread.body) + "</div>";

    // Reactions + flag
    html += '<div class="actions">';
    html += '<div class="tt-react-row">';

    REACTION_TYPES.forEach((rt) => {
      const isActive = myReaction === rt.key;
      html +=
        '<button type="button" class="tt-react" data-react="' +
        rt.key +
        '"' +
        (isActive ? ' data-active="true"' : "") +
        ">";
      html += rt.emoji + ' <span>' + (counts[rt.key] || 0) + "</span>";
      html += "</button>";
    });

    html += "</div>"; // .tt-react-row

    html +=
      '<button type="button" class="tt-flag-btn" style="border:1px solid var(--border);background:#fff;border-radius:999px;padding:6px 10px;font-size:13px;cursor:pointer;margin-left:auto;">Flag</button>';

    html += "</div>"; // .actions

    card.innerHTML = html;
    cardsEl.appendChild(card);
  }

  function escapeHtml(str) {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  async function loadFeed() {
    if (!cardsEl || !emptyState) return;

    try {
      const { data: threads, error } = await supabase
        .from("tt_threads")
        .select("id, user_id, category, body, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error("Error loading threads", error);
        return;
      }

      cardsEl.innerHTML = "";

      if (!threads || !threads.length) {
        emptyState.style.display = "block";
        return;
      }

      emptyState.style.display = "none";

      // Load profiles for all authors
      const userIds = Array.from(
        new Set(threads.map((t) => t.user_id).filter(Boolean))
      );
      await loadProfiles(userIds);

      // Load reactions for these threads
      const threadIds = threads.map((t) => t.id);
      let reactions = [];
      if (threadIds.length) {
        const { data: rxData, error: rxError } = await supabase
          .from("tt_reactions")
          .select("thread_id, user_id, reaction")
          .in("thread_id", threadIds);
        if (rxError) {
          console.error("Error loading reactions", rxError);
        } else if (rxData) {
          reactions = rxData;
        }
      }

      // Index reactions by thread and track the current user reaction
      const reactionsByThread = {};
      const myReactionByThread = {};

      reactions.forEach((r) => {
        if (!reactionsByThread[r.thread_id]) {
          reactionsByThread[r.thread_id] = [];
        }
        reactionsByThread[r.thread_id].push(r);

        if (currentUser && r.user_id === currentUser.id) {
          myReactionByThread[r.thread_id] = r.reaction;
        }
      });

      threads.forEach((thread) => {
        renderThreadCard(
          thread,
          reactionsByThread[thread.id] || [],
          myReactionByThread[thread.id] || null
        );
      });

      wireCardEvents();
    } catch (e) {
      console.error("Exception loading feed", e);
    }
  }

  function wireCardEvents() {
    if (!cardsEl) return;

    cardsEl.querySelectorAll(".tt-react").forEach((btn) => {
      btn.addEventListener("click", async function () {
        if (!currentUser) {
          requireLogin();
          return;
        }

        const card = this.closest(".card");
        if (!card) return;
        const threadId = card.dataset.threadId;
        const reactionKey = this.getAttribute("data-react");
        if (!threadId || !reactionKey) return;

        // Determine current reaction for this thread in DOM
        let currentReaction = null;
        card.querySelectorAll(".tt-react").forEach((b) => {
          if (b.getAttribute("data-active") === "true") {
            currentReaction = b.getAttribute("data-react");
          }
        });

        try {
          if (currentReaction === reactionKey) {
            // Clicking the same reaction removes it
            await supabase
              .from("tt_reactions")
              .delete()
              .eq("thread_id", threadId)
              .eq("user_id", currentUser.id);
          } else {
            // Upsert exactly one reaction per (thread, user)
            await supabase
              .from("tt_reactions")
              .upsert(
                {
                  thread_id: threadId,
                  user_id: currentUser.id,
                  reaction: reactionKey
                },
                { onConflict: "thread_id,user_id" }
              );
          }
          await loadFeed(); // refresh counts + active state
        } catch (e) {
          console.error("Error toggling reaction", e);
          showToast("Could not update reaction.");
        }
      });
    });

    cardsEl.querySelectorAll(".tt-flag-btn").forEach((btn) => {
      btn.addEventListener("click", async function () {
        if (!currentUser) {
          requireLogin();
          return;
        }
        const card = this.closest(".card");
        if (!card) return;
        const threadId = card.dataset.threadId;
        if (!threadId) return;

        const ok = window.confirm(
          "Flag this post for review by the Hemline Market team?"
        );
        if (!ok) return;

        try {
          await supabase.from("tt_flags").insert({
            thread_id: threadId,
            user_id: currentUser.id,
            reason: null
          });
          showToast("Flagged for review.");
        } catch (e) {
          console.error("Error flagging thread", e);
          showToast("Could not flag. Please try again.");
        }
      });
    });
  }

  async function init() {
    wireMediaInputs();
    await loadCurrentUser();
    if (composerForm) {
      composerForm.addEventListener("submit", handleComposerSubmit);
    }
    await loadFeed();
  }

  // Kick things off once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
