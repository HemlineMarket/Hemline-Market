/* ThreadTalk client: posts, reactions, edit/delete, comments (localStorage)
   Assumptions:
   - Page already provides the composer elements with the same ids as before:
     composeCategory, composeText, photoInput, videoInput, postBtn, cards, emptyState
   - Category tiles are anchor links to category pages (so we don't touch them here).
   - Display name is taken from localStorage 'tt_user' (fallback 'Afroza').
*/

(function () {
  // ---------------------------
  // Helpers & state
  // ---------------------------
  const LS_KEY = "tt_posts";
  const userName = (localStorage.getItem("tt_user") || "Afroza").trim() || "Afroza";

  const $ = (id) => document.getElementById(id);
  const cardsEl = $("cards");
  const emptyState = $("emptyState");

  const sel = $("composeCategory");
  const txt = $("composeText");
  const photoInput = $("photoInput");
  const videoInput = $("videoInput");
  const postBtn = $("postBtn");
  const mediaPreview = $("mediaPreview");

  function uuid() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function nowLabel(ts) {
    return ts ? "just now" : "just now";
  }

  function readStore() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function writeStore(posts) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(posts));
    } catch {}
  }

  let posts = readStore();

  // ---------------------------
  // Rendering
  // ---------------------------
  function categoryHref(cat) {
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

  function mediaHTML(media) {
    if (!media) return "";
    if (media.type === "image") {
      return `<img class="post-img" src="${media.url}" alt="post image">`;
    }
    if (media.type === "video") {
      return `<video class="post-video" controls src="${media.url}"></video>`;
    }
    return "";
  }

  function reactionBarHTML(p) {
    const r = p.reactions || { like: 0, love: 0, laugh: 0, wow: 0 };
    return `
      <div class="tt-react-row" role="group" aria-label="Reactions">
        <button class="tt-react" data-act="react" data-emoji="like"   data-id="${p.id}" title="Like">👍 <span>${r.like||0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="love"   data-id="${p.id}" title="Love">❤️ <span>${r.love||0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="laugh"  data-id="${p.id}" title="Funny">😂 <span>${r.laugh||0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="wow"    data-id="${p.id}" title="Wow">😮 <span>${r.wow||0}</span></button>
      </div>
    `;
  }

  function menuHTML(p) {
    return `
      <div class="tt-menu">
        <button class="tt-menu-btn" aria-label="More" data-id="${p.id}" data-act="menu">⋯</button>
        <div class="tt-menu-pop" data-pop="${p.id}" hidden>
          <button class="tt-menu-item" data-act="edit" data-id="${p.id}">Edit</button>
          <button class="tt-menu-item danger" data-act="delete" data-id="${p.id}">Delete</button>
        </div>
      </div>
    `;
  }

  function commentsHTML(p) {
    const c = p.comments || [];
    const items = c
      .map(
        (cm) => `
      <div class="tt-comment" data-cid="${cm.id}">
        <div class="tt-comment-head"><strong>${cm.user}</strong> · <span>just now</span></div>
        <div class="tt-comment-body">${escapeHTML(cm.text)}</div>
      </div>`
      )
      .join("");
    return `
      <div class="tt-comments">
        ${items || ""}
        <div class="tt-comment-new">
          <input type="text" class="tt-comment-input" placeholder="Write a comment…" data-id="${p.id}">
          <button class="tt-comment-send" data-act="comment" data-id="${p.id}">Send</button>
        </div>
      </div>
    `;
  }

  function cardHTML(p) {
    return `
      <article class="card" data-id="${p.id}">
        <div class="meta" style="justify-content:space-between;">
          <div style="display:flex;gap:8px;align-items:center;">
            <span><strong>${p.user}</strong></span>
            <span>•</span>
            <span>${nowLabel(p.ts)}</span>
            <span>•</span>
            <a class="cat" href="${categoryHref(p.category)}">[${p.category}]</a>
          </div>
          ${menuHTML(p)}
        </div>

        ${mediaHTML(p.media)}
        <div class="preview" data-role="text">${escapeHTML(p.text)}</div>

        ${reactionBarHTML(p)}
        ${commentsHTML(p)}
      </article>
    `;
  }

  function renderAll() {
    cardsEl.innerHTML = posts.map(cardHTML).join("");
    emptyState.style.display = posts.length ? "none" : "";
  }

  function prependPost(p) {
    const el = document.createElement("div");
    el.innerHTML = cardHTML(p);
    const card = el.firstElementChild;
    if (cardsEl.firstChild) cardsEl.insertBefore(card, cardsEl.firstChild);
    else cardsEl.appendChild(card);
    emptyState.style.display = "none";
  }

  // ---------------------------
  // Composer (unchanged UI)
  // ---------------------------
  function clearComposer() {
    sel.value = "";
    txt.value = "";
    photoInput.value = "";
    videoInput.value = "";
    mediaPreview && (mediaPreview.hidden = true, (mediaPreview.innerHTML = ""));
    txt.focus();
  }

  function showPreview(file, kind) {
    if (!mediaPreview) return;
    const url = URL.createObjectURL(file);
    mediaPreview.hidden = false;
    mediaPreview.innerHTML =
      kind === "image"
        ? `<img alt="preview image" src="${url}">`
        : `<video controls src="${url}"></video>`;
  }

  if (photoInput) {
    photoInput.addEventListener("change", function () {
      if (this.files && this.files[0]) {
        videoInput.value = "";
        showPreview(this.files[0], "image");
      }
    });
  }
  if (videoInput) {
    videoInput.addEventListener("change", function () {
      if (this.files && this.files[0]) {
        photoInput.value = "";
        showPreview(this.files[0], "video");
      }
    });
  }

  function submitPost(e) {
    if (e) e.preventDefault();
    const category = (sel && sel.value.trim()) || "Loose Threads";
    const text = (txt && txt.value.trim()) || "";
    if (!text) {
      if (txt) txt.focus();
      return;
    }
    let media = null;
    if (photoInput && photoInput.files && photoInput.files[0]) {
      media = { type: "image", url: URL.createObjectURL(photoInput.files[0]) };
    } else if (videoInput && videoInput.files && videoInput.files[0]) {
      media = { type: "video", url: URL.createObjectURL(videoInput.files[0]) };
    }

    const p = {
      id: uuid(),
      user: userName,
      category,
      text,
      media,
      reactions: { like: 0, love: 0, laugh: 0, wow: 0 },
      comments: [],
      ts: Date.now()
    };
    posts.unshift(p);
    writeStore(posts);
    prependPost(p);
    clearComposer();
    // Jump to feed
    const feed = document.getElementById("feed");
    if (feed) feed.scrollIntoView({ behavior: "smooth" });
  }

  if (postBtn) postBtn.addEventListener("click", submitPost);
  const form = document.getElementById("composer");
  if (form) form.addEventListener("submit", submitPost);

  // ---------------------------
  // Interactions (delegated)
  // ---------------------------
  function findPost(id) {
    return posts.find((x) => x.id === id);
  }
  function updateAndRerenderRow(id) {
    // Re-render only that card for simplicity
    const idx = posts.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const old = document.querySelector(`.card[data-id="${id}"]`);
    if (!old) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = cardHTML(posts[idx]);
    old.replaceWith(wrapper.firstElementChild);
    writeStore(posts);
  }

  document.addEventListener("click", function (e) {
    const t = e.target;

    // open/close ⋯ menu
    if (t.matches(".tt-menu-btn")) {
      const id = t.getAttribute("data-id");
      const pop = document.querySelector(`.tt-menu-pop[data-pop="${id}"]`);
      if (pop) pop.hidden = !pop.hidden;
      return;
    }
    // click outside closes any open menu
    if (!t.closest(".tt-menu")) {
      document.querySelectorAll(".tt-menu-pop").forEach((p) => (p.hidden = true));
    }

    // Delete
    if (t.matches('[data-act="delete"]')) {
      const id = t.getAttribute("data-id");
      posts = posts.filter((x) => x.id !== id);
      writeStore(posts);
      const card = document.querySelector(`.card[data-id="${id}"]`);
      if (card) card.remove();
      emptyState.style.display = posts.length ? "none" : "";
      return;
    }

    // Edit (turn text into textarea inline)
    if (t.matches('[data-act="edit"]')) {
      const id = t.getAttribute("data-id");
      const p = findPost(id);
      if (!p) return;

      const card = document.querySelector(`.card[data-id="${id}"]`);
      const textDiv = card && card.querySelector('[data-role="text"]');
      if (!textDiv) return;

      const current = p.text;
      textDiv.innerHTML = `
        <textarea class="tt-edit-area">${escapeHTML(current)}</textarea>
        <div class="tt-edit-actions">
          <button class="tt-edit-save" data-act="save" data-id="${id}">Save</button>
          <button class="tt-edit-cancel" data-act="cancel" data-id="${id}">Cancel</button>
        </div>
      `;
      return;
    }

    // Save edit
    if (t.matches('[data-act="save"]')) {
      const id = t.getAttribute("data-id");
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const area = card && card.querySelector(".tt-edit-area");
      if (!area) return;
      const val = area.value.trim();
      const p = findPost(id);
      if (!p) return;
      p.text = val || p.text;
      updateAndRerenderRow(id);
      return;
    }

    // Cancel edit
    if (t.matches('[data-act="cancel"]')) {
      const id = t.getAttribute("data-id");
      updateAndRerenderRow(id);
      return;
    }

    // Reactions
    if (t.matches('[data-act="react"]')) {
      const id = t.getAttribute("data-id");
      const emoji = t.getAttribute("data-emoji");
      const p = findPost(id);
      if (!p) return;
      p.reactions = p.reactions || { like: 0, love: 0, laugh: 0, wow: 0 };
      p.reactions[emoji] = (p.reactions[emoji] || 0) + 1;
      updateAndRerenderRow(id);
      return;
    }

    // Comment send
    if (t.matches('[data-act="comment"]')) {
      const id = t.getAttribute("data-id");
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const input = card && card.querySelector(".tt-comment-input");
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      const p = findPost(id);
      if (!p) return;
      p.comments = p.comments || [];
      p.comments.push({ id: uuid(), user: userName, text, ts: Date.now() });
      updateAndRerenderRow(id);
      return;
    }
  });

  // ---------------------------
  // Util
  // ---------------------------
  function escapeHTML(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ---------------------------
  // Initial render
  // ---------------------------
  renderAll();
})();
