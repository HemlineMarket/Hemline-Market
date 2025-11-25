// public/scripts/threadtalk.js
// ThreadTalk client: localStorage feed only (no page-level auth UI)

(function () {
  if (window.__TT_THREADTALK_INITED__) return;
  window.__TT_THREADTALK_INITED__ = true;

  // We no longer do Supabase auth in this file.
  // Universal auth/session is handled by hm-shell + supabase-client.
  const LS_KEY = "tt_posts";

  const $ = (id) => document.getElementById(id);

  const cardsEl      = $("cards"),
        emptyState   = $("emptyState"),
        sel          = $("composeCategory"),
        txt          = $("composeText"),
        photoInput   = $("photoInput"),
        videoInput   = $("videoInput"),
        postBtn      = $("postBtn"),
        mediaPreview = $("mediaPreview"),
        form         = $("composer");

  // Name label: try to reuse anything your shell might expose; fall back to "Afroza"
  let displayName =
    (window.HM && window.HM.currentUserName) ||
    (window.HM && window.HM.profileName) ||
    "Afroza";

  const uuid = () =>
    "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const nowLabel = () => "just now";

  const readStore = () => {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    } catch {
      return [];
    }
  };

  const writeStore = (p) => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(p));
    } catch {}
  };

  let posts = readStore();

  const categoryHref = (c) => {
    const k = (c || "").toLowerCase();
    const map = {
      "showcase": "showcase.html",
      "tailoring": "tailoring.html",
      "stitch school": "stitch-school.html",
      "fabric sos": "fabric-sos.html",
      "before & after": "before-after.html",
      "pattern hacks": "pattern-hacks.html",
      "stash confessions": "stash-confessions.html",
      "loose threads": "loose-threads.html",
    };
    return map[k] || "loose-threads.html";
  };

  const mediaHTML = (m) =>
    !m
      ? ""
      : m.type === "image"
      ? `<img class="post-img" src="${m.url}" alt="post image">`
      : `<video class="post-video" controls src="${m.url}"></video>`;

  const reactionBarHTML = (p) => {
    const r = p.reactions || { like: 0, love: 0, laugh: 0, wow: 0 };
    return `
      <div class="tt-react-row">
        <button class="tt-react" data-act="react" data-emoji="like" data-id="${p.id}">👍 <span>${r.like}</span></button>
        <button class="tt-react" data-act="react" data-emoji="love" data-id="${p.id}">❤️ <span>${r.love}</span></button>
        <button class="tt-react" data-act="react" data-emoji="laugh" data-id="${p.id}">😂 <span>${r.laugh}</span></button>
        <button class="tt-react" data-act="react" data-emoji="wow" data-id="${p.id}">😮 <span>${r.wow}</span></button>
      </div>`;
  };

  const menuHTML = (p) => `
    <div class="tt-menu">
      <button class="tt-menu-btn" data-id="${p.id}" data-act="menu" type="button">⋯</button>
      <div class="tt-menu-pop" data-pop="${p.id}" hidden>
        <button class="tt-menu-item" data-act="edit" data-id="${p.id}" type="button">Edit</button>
        <button class="tt-menu-item danger" data-act="delete" data-id="${p.id}" type="button">Delete</button>
      </div>
    </div>`;

  const commentsHTML = (p) => {
    const c = p.comments || [];
    const items = c
      .map(
        (cm) => `
      <div class="tt-comment" data-cid="${cm.id}">
        <div class="tt-comment-head"><strong>${cm.user}</strong> · just now</div>
        <div class="tt-comment-body">${escapeHTML(cm.text)}</div>
      </div>`
      )
      .join("");
    return `
      <div class="tt-comments">
        ${items}
        <div class="tt-comment-new">
          <input type="text" class="tt-comment-input" placeholder="Write a comment…" data-id="${p.id}">
          <button class="tt-comment-send" data-act="comment" data-id="${p.id}" type="button">Send</button>
        </div>
      </div>`;
  };

  const cardHTML = (p) => `
    <article class="card" data-id="${p.id}">
      <div class="meta" style="justify-content:space-between;">
        <div style="display:flex;gap:8px;align-items:center;">
          <span><strong>${p.user}</strong></span>
          <span>•</span><span>${nowLabel(p.ts)}</span>
          <span>•</span><a class="cat" href="${categoryHref(p.category)}">[${p.category}]</a>
        </div>${menuHTML(p)}
      </div>
      ${mediaHTML(p.media)}
      <div class="preview" data-role="text">${escapeHTML(p.text)}</div>
      ${reactionBarHTML(p)}
      ${commentsHTML(p)}
    </article>`;

  const renderAll = () => {
    if (!cardsEl || !emptyState) return;
    cardsEl.innerHTML = posts.map(cardHTML).join("");
    emptyState.style.display = posts.length ? "none" : "";
  };

  // ---------- Composer (no auth gate here) ----------

  const clearComposer = () => {
    if (txt) txt.value = "";
    if (sel) sel.value = "";
    if (photoInput) photoInput.value = "";
    if (videoInput) videoInput.value = "";
    if (mediaPreview) {
      mediaPreview.hidden = true;
      mediaPreview.innerHTML = "";
    }
  };

  const showPreview = (file, kind) => {
    if (!mediaPreview) return;
    const url = URL.createObjectURL(file);
    mediaPreview.hidden = false;
    mediaPreview.innerHTML =
      kind === "image"
        ? `<img src="${url}" alt="">`
        : `<video src="${url}" controls></video>`;
  };

  if (photoInput)
    photoInput.onchange = () => {
      if (photoInput.files && photoInput.files[0]) {
        if (videoInput) videoInput.value = "";
        showPreview(photoInput.files[0], "image");
      }
    };

  if (videoInput)
    videoInput.onchange = () => {
      if (videoInput.files && videoInput.files[0]) {
        if (photoInput) photoInput.value = "";
        showPreview(videoInput.files[0], "video");
      }
    };

  function submitPost(e) {
    if (e) e.preventDefault();

    // We no longer block on currentUser; header/auth handles session separately.
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
      user: displayName || "Afroza",
      category,
      text,
      media,
      reactions: { like: 0, love: 0, laugh: 0, wow: 0 },
      comments: [],
      ts: Date.now(),
    };

    posts.unshift(p);
    writeStore(posts);

    if (cardsEl) cardsEl.insertAdjacentHTML("afterbegin", cardHTML(p));
    if (emptyState) emptyState.style.display = "none";

    clearComposer();
  }

  if (postBtn) postBtn.onclick = submitPost;
  if (form) form.onsubmit = submitPost;

  // ---------- Row Interactions ----------

  const findPost = (id) => posts.find((p) => p.id === id);

  const updateRow = (id) => {
    const idx = posts.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const el = document.querySelector(`.card[data-id="${id}"]`);
    if (!el) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = cardHTML(posts[idx]);
    el.replaceWith(wrap.firstElementChild);
    writeStore(posts);
  };

  document.addEventListener("click", (e) => {
    const t = e.target;

    if (t.matches(".tt-menu-btn")) {
      const id = t.getAttribute("data-id");
      const pop = document.querySelector(`.tt-menu-pop[data-pop="${id}"]`);
      if (pop) pop.hidden = !pop.hidden;
      return;
    }

    if (!t.closest(".tt-menu"))
      document
        .querySelectorAll(".tt-menu-pop")
        .forEach((p) => (p.hidden = true));

    if (t.dataset.act === "delete") {
      const id = t.dataset.id;
      posts = posts.filter((p) => p.id !== id);
      writeStore(posts);
      document.querySelector(`.card[data-id="${id}"]`)?.remove();
      if (emptyState) emptyState.style.display = posts.length ? "none" : "";
    }

    if (t.dataset.act === "edit") {
      const id = t.dataset.id,
        p = findPost(id);
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const body = card?.querySelector('[data-role="text"]');
      if (!body) return;
      body.innerHTML = `
        <textarea class="tt-edit-area">${escapeHTML(p.text)}</textarea>
        <div class="tt-edit-actions">
          <button class="tt-edit-save" data-act="save" data-id="${id}" type="button">Save</button>
          <button class="tt-edit-cancel" data-act="cancel" data-id="${id}" type="button">Cancel</button>
        </div>`;
    }

    if (t.dataset.act === "save") {
      const id = t.dataset.id;
      const area = document.querySelector(
        `.card[data-id="${id}"] .tt-edit-area`
      );
      const p = findPost(id);
      if (!p || !area) return;
      p.text = area.value.trim() || p.text;
      updateRow(id);
    }

    if (t.dataset.act === "cancel") updateRow(t.dataset.id);

    if (t.dataset.act === "react") {
      const id = t.dataset.id,
        key = t.dataset.emoji;
      const p = findPost(id);
      if (!p) return;
      p.reactions[key] = (p.reactions[key] || 0) + 1;
      updateRow(id);
    }

    if (t.dataset.act === "comment") {
      const id = t.dataset.id,
        p = findPost(id);
      if (!p) return;
      const input = document.querySelector(
        `.card[data-id="${id}"] .tt-comment-input`
      );
      const val = (input?.value || "").trim();
      if (!val) return;
      p.comments.push({
        id: uuid(),
        user: displayName || "Afroza",
        text: val,
        ts: Date.now(),
      });
      updateRow(id);
    }
  });

  const escapeHTML = (s) =>
    (s || "").replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));

  // ---------- Init ----------
  renderAll();
})();
