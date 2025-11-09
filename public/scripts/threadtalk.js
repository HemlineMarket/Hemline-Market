/* ThreadTalk – front-end logic
   NOTE: Do NOT edit ThreadTalk.html for this fix. This script:
   - Keeps the layout exactly as you have it
   - Lets you post (defaults to “Loose Threads” if category is blank)
   - Saves to/loads from localStorage
   - Shows your name (no initials)
   - Adds discreet Edit/Delete via a kebab (…)
   - Adds quick reactions (👍 ❤️ 😮 😢)
   - PREVENTS category tiles from changing the composer — tiles simply navigate
*/

(function () {
  // ---------- Utilities ----------
  const LS_KEY_POSTS = "tt_posts";
  const LS_KEY_USER = "tt_user";

  // Ensure a display name exists (you asked to show your name on comments)
  try {
    if (!localStorage.getItem(LS_KEY_USER)) {
      localStorage.setItem(LS_KEY_USER, "Afroza");
    }
  } catch (_) {}

  const $ = (sel) => document.querySelector(sel);

  // Elements from your existing HTML (do not change IDs/classes in HTML)
  const cardsEl = $("#cards");
  const emptyState = $("#emptyState");
  const form = $("#composer");
  const sel = $("#composeCategory");
  const txt = $("#composeText");
  const photoInput = $("#photoInput");
  const videoInput = $("#videoInput");
  const previewWrap = $("#mediaPreview");
  const postBtn = $("#postBtn");

  // Map category name -> category page path (used for the bracket link)
  function categoryFile(cat) {
    const k = (cat || "").toLowerCase();
    if (k === "showcase") return "showcase.html";
    if (k === "tailoring") return "tailoring.html";
    if (k === "stitch school") return "stitch-school.html";
    if (k === "fabric sos") return "fabric-sos.html";
    if (k === "before & after" || k === "before and after" || k === "before-after")
      return "before-after.html";
    if (k === "pattern hacks") return "pattern-hacks.html";
    if (k === "stash confessions") return "stash-confessions.html";
    return "loose-threads.html";
  }

  function nowLabel(ts) {
    // Simple relative label; everything new is "just now"
    if (!ts) return "just now";
    return "just now";
  }

  function loadPosts() {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_KEY_POSTS) || "[]");
      if (arr.length) {
        emptyState && (emptyState.style.display = "none");
        arr.forEach((p) => renderCard(p, false));
      }
    } catch (_) {}
  }

  function savePosts(arr) {
    try {
      localStorage.setItem(LS_KEY_POSTS, JSON.stringify(arr));
    } catch (_) {}
  }

  function addPostToStorage(post) {
    try {
      const arr = JSON.parse(localStorage.getItem(LS_KEY_POSTS) || "[]");
      arr.unshift(post);
      savePosts(arr);
    } catch (_) {}
  }

  function removePostFromStorage(id) {
    try {
      let arr = JSON.parse(localStorage.getItem(LS_KEY_POSTS) || "[]");
      arr = arr.filter((p) => p.id !== id);
      savePosts(arr);
    } catch (_) {}
  }

  function updatePostInStorage(updated) {
    try {
      let arr = JSON.parse(localStorage.getItem(LS_KEY_POSTS) || "[]");
      const idx = arr.findIndex((p) => p.id === updated.id);
      if (idx !== -1) {
        arr[idx] = updated;
        savePosts(arr);
      }
    } catch (_) {}
  }

  // ---------- Media preview (single file: image OR video) ----------
  function clearPreview() {
    if (!previewWrap) return;
    previewWrap.innerHTML = "";
    previewWrap.hidden = true;
  }

  function showPreview(file, kind) {
    if (!previewWrap || !file) return;
    const url = URL.createObjectURL(file);
    previewWrap.hidden = false;
    if (kind === "image") {
      previewWrap.innerHTML = `<img alt="preview image" src="${url}" style="max-width:140px;max-height:120px;border-radius:10px;border:1px solid #e8e0d9"/>`;
    } else {
      previewWrap.innerHTML = `<video controls src="${url}" style="max-width:140px;max-height:120px;border-radius:10px;border:1px solid #e8e0d9"></video>`;
    }
  }

  photoInput && photoInput.addEventListener("change", function () {
    if (this.files && this.files[0]) {
      if (videoInput) {
        videoInput.value = "";
      }
      showPreview(this.files[0], "image");
    } else {
      clearPreview();
    }
  });

  videoInput && videoInput.addEventListener("change", function () {
    if (this.files && this.files[0]) {
      if (photoInput) {
        photoInput.value = "";
      }
      showPreview(this.files[0], "video");
    } else {
      clearPreview();
    }
  });

  // ---------- Composer submit ----------
  function clearComposer() {
    if (sel) sel.value = "";
    if (txt) txt.value = "";
    if (photoInput) photoInput.value = "";
    if (videoInput) videoInput.value = "";
    clearPreview();
    txt && txt.focus();
  }

  function submitPost(e) {
    e && e.preventDefault();

    const category =
      (sel && sel.value && sel.value.trim()) ? sel.value.trim() : "Loose Threads";
    const text = (txt && txt.value ? txt.value : "").trim();
    if (!text) {
      txt && txt.focus();
      return;
    }

    // Prepare media if present
    let media = null;
    if (photoInput && photoInput.files && photoInput.files[0]) {
      media = { type: "image", url: URL.createObjectURL(photoInput.files[0]) };
    } else if (videoInput && videoInput.files && videoInput.files[0]) {
      media = { type: "video", url: URL.createObjectURL(videoInput.files[0]) };
    }

    const user = (function () {
      try {
        return localStorage.getItem(LS_KEY_USER) || "You";
      } catch (_) {
        return "You";
      }
    })();

    const post = {
      id: "p_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      category,
      text,
      media, // {type,url} or null
      user,
      ts: Date.now(),
      reactions: { like: 0, love: 0, wow: 0, sad: 0 }
    };

    emptyState && (emptyState.style.display = "none");
    renderCard(post, true);
    addPostToStorage(post);
    clearComposer();

    // scroll to feed
    const feed = document.getElementById("feed");
    feed && feed.scrollIntoView({ behavior: "smooth" });
  }

  if (form) {
    form.addEventListener("submit", submitPost);
  }
  if (postBtn) {
    postBtn.addEventListener("click", submitPost);
  }

  // ---------- Render ----------
  function renderCard(post, toTop) {
    if (!cardsEl) return;

    const el = document.createElement("article");
    el.className = "card";
    el.setAttribute("data-id", post.id);

    const mediaHTML = (function () {
      if (!post.media) return "";
      if (post.media.type === "image") {
        return `<img class="post-img" src="${post.media.url}" alt="post image"/>`;
      }
      if (post.media.type === "video") {
        return `<video class="post-video" controls src="${post.media.url}"></video>`;
      }
      return "";
    })();

    // Kebab menu (discreet)
    const kebab = `
      <div style="margin-left:auto; position:relative">
        <button class="tt-kebab" aria-label="More options" style="background:#fff;border:1px solid #e8e0d9;border-radius:8px;padding:2px 8px;cursor:pointer">…</button>
        <div class="tt-menu" hidden style="position:absolute;right:0;top:28px;background:#fff;border:1px solid #e8e0d9;border-radius:10px;box-shadow:0 10px 20px rgba(0,0,0,.08);padding:6px;z-index:5">
          <button class="tt-edit" style="display:block;width:100%;text-align:left;background:none;border:0;padding:6px 8px;cursor:pointer">Edit</button>
          <button class="tt-delete" style="display:block;width:100%;text-align:left;background:none;border:0;padding:6px 8px;color:#991b1b;cursor:pointer">Delete</button>
        </div>
      </div>
    `;

    el.innerHTML = `
      <div class="meta" style="display:flex;align-items:center;gap:8px;margin-bottom:6px;color:#7a6e68;font-size:13px">
        <span style="font-weight:600">${post.user}</span>
        <span>•</span>
        <span>${nowLabel(post.ts)}</span>
        ${kebab}
      </div>
      <div class="title" style="margin:4px 0 8px;line-height:1.35">
        <a class="cat" href="${categoryFile(post.category)}" style="font-weight:800;margin-right:.35rem;text-decoration:none;color:#991b1b">[${post.category}]</a>
      </div>
      ${mediaHTML}
      <div class="preview" style="color:#5e544d;font-size:14px;margin-bottom:8px;white-space:pre-wrap">${escapeHTML(post.text)}</div>
      <div class="tt-reactions" style="display:flex;gap:10px;align-items:center;font-size:13px;color:#7e6f66;margin-top:8px">
        <button class="rx rx-like" data-rx="like" aria-label="Like" style="border:1px solid #e8e0d9;background:#fff;border-radius:999px;padding:4px 8px;cursor:pointer">👍 <span>${post.reactions.like}</span></button>
        <button class="rx rx-love" data-rx="love" aria-label="Love" style="border:1px solid #e8e0d9;background:#fff;border-radius:999px;padding:4px 8px;cursor:pointer">❤️ <span>${post.reactions.love}</span></button>
        <button class="rx rx-wow" data-rx="wow" aria-label="Wow" style="border:1px solid #e8e0d9;background:#fff;border-radius:999px;padding:4px 8px;cursor:pointer">😮 <span>${post.reactions.wow}</span></button>
        <button class="rx rx-sad" data-rx="sad" aria-label="Sad" style="border:1px solid #e8e0d9;background:#fff;border-radius:999px;padding:4px 8px;cursor:pointer">😢 <span>${post.reactions.sad}</span></button>
      </div>
    `;

    // Bind kebab actions
    const kebabBtn = el.querySelector(".tt-kebab");
    const menu = el.querySelector(".tt-menu");
    kebabBtn &&
      kebabBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!menu) return;
        menu.hidden = !menu.hidden;
      });
    document.addEventListener("click", () => {
      if (menu && !menu.hidden) menu.hidden = true;
    });

    // Edit
    const editBtn = el.querySelector(".tt-edit");
    editBtn &&
      editBtn.addEventListener("click", () => {
        if (!menu) return;
        menu.hidden = true;
        startInlineEdit(el, post);
      });

    // Delete
    const delBtn = el.querySelector(".tt-delete");
    delBtn &&
      delBtn.addEventListener("click", () => {
        if (!menu) return;
        menu.hidden = true;
        el.remove();
        removePostFromStorage(post.id);
        // If nothing left, show empty state again
        if (!cardsEl.children.length && emptyState) {
          emptyState.style.display = "";
        }
      });

    // Reactions
    el.querySelectorAll(".rx").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-rx");
        if (!key) return;

        // Update numbers in UI
        const span = btn.querySelector("span");
        const newVal = (parseInt(span.textContent || "0", 10) || 0) + 1;
        span.textContent = String(newVal);

        // Update storage
        try {
          let arr = JSON.parse(localStorage.getItem(LS_KEY_POSTS) || "[]");
          const idx = arr.findIndex((p) => p.id === post.id);
          if (idx !== -1) {
            arr[idx].reactions = arr[idx].reactions || {};
            arr[idx].reactions[key] = (arr[idx].reactions[key] || 0) + 1;
            savePosts(arr);
          }
        } catch (_) {}
      });
    });

    if (toTop && cardsEl.firstChild) {
      cardsEl.insertBefore(el, cardsEl.firstChild);
    } else {
      cardsEl.appendChild(el);
    }
  }

  function startInlineEdit(cardEl, post) {
    const preview = cardEl.querySelector(".preview");
    if (!preview) return;

    // Create textarea + actions
    const original = post.text;
    const ta = document.createElement("textarea");
    ta.value = original;
    ta.style.width = "100%";
    ta.style.minHeight = "90px";
    ta.style.border = "1px solid #e8e0d9";
    ta.style.borderRadius = "10px";
    ta.style.padding = "10px 12px";
    ta.style.font = "inherit";
    ta.style.marginTop = "8px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.marginTop = "8px";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.style.border = "1px solid #2d2d2d";
    saveBtn.style.background = "#2d2d2d";
    saveBtn.style.color = "#fff";
    saveBtn.style.borderRadius = "10px";
    saveBtn.style.padding = "6px 12px";
    saveBtn.style.cursor = "pointer";

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.border = "1px solid #e8e0d9";
    cancelBtn.style.background = "#fff";
    cancelBtn.style.borderRadius = "10px";
    cancelBtn.style.padding = "6px 12px";
    cancelBtn.style.cursor = "pointer";

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    // Replace preview with editor temporarily
    const container = document.createElement("div");
    container.appendChild(ta);
    container.appendChild(actions);
    preview.replaceWith(container);
    ta.focus();

    cancelBtn.addEventListener("click", () => {
      // Restore preview
      container.replaceWith(preview);
    });

    saveBtn.addEventListener("click", () => {
      const newText = ta.value.trim();
      if (!newText) {
        ta.focus();
        return;
      }
      post.text = newText;
      updatePostInStorage(post);

      // Update UI
      const updated = document.createElement("div");
      updated.className = "preview";
      updated.style.color = "#5e544d";
      updated.style.fontSize = "14px";
      updated.style.marginBottom = "8px";
      updated.style.whiteSpace = "pre-wrap";
      updated.textContent = newText;
      container.replaceWith(updated);
    });
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------- IMPORTANT: DO NOT hijack topic tiles ----------
  // Earlier versions attached listeners to `.topic` and changed the select.
  // That caused your tiles to alter the composer instead of navigating.
  // We intentionally DO NOTHING here, so your <a class="topic" href="...">
  // links keep their native navigation behavior.

  // ---------- Kick off ----------
  loadPosts();
})();
