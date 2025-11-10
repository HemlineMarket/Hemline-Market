// public/scripts/threadtalk.js
// ThreadTalk client: localStorage feed + Supabase Auth gate

(function () {
  if (window.__TT_THREADTALK_INITED__) return;
  window.__TT_THREADTALK_INITED__ = true;

  const sb = window.supabase || null;
  let currentUser = null;
  let displayName = null;

  const LS_KEY = "tt_posts";
  const $ = (id) => document.getElementById(id);
  const cardsEl = $("cards"), emptyState = $("emptyState");
  const sel = $("composeCategory"), txt = $("composeText");
  const photoInput = $("photoInput"), videoInput = $("videoInput");
  const postBtn = $("postBtn"), mediaPreview = $("mediaPreview");
  const form = $("composer");

  const uuid = () => "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const nowLabel = () => "just now";
  const readStore = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; } };
  const writeStore = (p) => { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch {} };
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
      "loose threads": "loose-threads.html"
    };
    return map[k] || "loose-threads.html";
  };

  const mediaHTML = (m) => !m ? "" :
    m.type === "image" ? `<img class="post-img" src="${m.url}" alt="post image">` :
    `<video class="post-video" controls src="${m.url}"></video>`;

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
    const items = c.map(cm => `
      <div class="tt-comment" data-cid="${cm.id}">
        <div class="tt-comment-head"><strong>${cm.user}</strong> · just now</div>
        <div class="tt-comment-body">${escapeHTML(cm.text)}</div>
      </div>`).join("");
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

  // ---------- Auth Gate ----------
  const removeAuthBox = () => document.querySelectorAll("#tt-auth").forEach(n => n.remove());

  const disableComposer = (reason) => {
    [sel, txt, photoInput, videoInput, postBtn].forEach(n => { if (n) n.disabled = true; });
    removeAuthBox();

    const box = document.createElement("div");
    box.id = "tt-auth";
    box.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin:8px;background:#fff">
        <strong>Sign in to post</strong>
        ${!sb ? `<div style="margin-top:6px;color:#b91c1c;font-size:13px">
          Auth library didn’t load. Make sure <code>scripts/supabase-client.js</code> is included before <code>threadtalk.js</code>.
        </div>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <input id="ttEmail" type="email" placeholder="you@example.com"
                 style="padding:8px;border:1px solid var(--border);border-radius:10px">
          <input id="ttPass" type="password" placeholder="Password"
                 style="padding:8px;border:1px solid var(--border);border-radius:10px" autocomplete="current-password">
          <button id="ttSignInPwd" type="button"
                  style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:10px;padding:8px 12px">Sign in</button>
          <button id="ttSignUpPwd" type="button"
                  style="border:1px solid var(--border);background:#fff;border-radius:10px;padding:8px 12px">Create account</button>
        </div>
      </div>`;
    form && form.appendChild(box);

    if (!sb) return;

    const emailEl = $("ttEmail"), passEl = $("ttPass");
    const inBtn = $("ttSignInPwd"), upBtn = $("ttSignUpPwd");

    inBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = (emailEl.value || "").trim();
      const pw = passEl.value || "";
      if (!email || !pw) return emailEl.focus();
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (error) { inBtn.textContent = "Try again"; return; }
      location.reload();
    });

    upBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = (emailEl.value || "").trim();
      const pw = passEl.value || "";
      if (!email || !pw) return emailEl.focus();
      const localName = email.split("@")[0];
      const { error } = await sb.auth.signUp({
        email, password: pw, options: { data: { full_name: localName } }
      });
      upBtn.textContent = error ? "Error" : "Check email";
    });
  };

  const enableComposer = (u) => {
    [sel, txt, photoInput, videoInput, postBtn].forEach(n => { if (n) n.disabled = false; });
    removeAuthBox();
    const meta = u?.user_metadata || {};
    const email = u?.email;
    displayName = meta.full_name || meta.name || (email ? email.split("@")[0] : "User");
  };

  async function refreshAuth() {
    if (!sb) return disableComposer("no-sb");
    const { data } = await sb.auth.getSession();
    currentUser = data?.session?.user || null;
    currentUser ? enableComposer(currentUser) : disableComposer();
  }

  if (sb?.auth?.onAuthStateChange)
    sb.auth.onAuthStateChange((_e, s) => (s?.user ? enableComposer(s.user) : disableComposer()));

  // ---------- Composer ----------
  const clearComposer = () => {
    if (txt) txt.value = "";
    if (sel) sel.value = "";
    if (photoInput) photoInput.value = "";
    if (videoInput) videoInput.value = "";
    if (mediaPreview) { mediaPreview.hidden = true; mediaPreview.innerHTML = ""; }
  };

  const showPreview = (file, kind) => {
    if (!mediaPreview) return;
    const url = URL.createObjectURL(file);
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = kind === "image"
      ? `<img src="${url}" alt="">` : `<video src="${url}" controls></video>`;
  };

  if (photoInput) photoInput.onchange = () => {
    if (photoInput.files && photoInput.files[0]) {
      if (videoInput) videoInput.value = "";
      showPreview(photoInput.files[0], "image");
    }
  };
  if (videoInput) videoInput.onchange = () => {
    if (videoInput.files && videoInput.files[0]) {
      if (photoInput) photoInput.value = "";
      showPreview(videoInput.files[0], "video");
    }
  };

  function submitPost(e) {
    if (e) e.preventDefault();
    if (!currentUser) return disableComposer();

    const category = (sel && sel.value.trim()) || "Loose Threads";
    const text = (txt && txt.value.trim()) || "";
    if (!text) { if (txt) txt.focus(); return; }

    let media = null;
    if (photoInput && photoInput.files && photoInput.files[0]) {
      media = { type: "image", url: URL.createObjectURL(photoInput.files[0]) };
    } else if (videoInput && videoInput.files && videoInput.files[0]) {
      media = { type: "video", url: URL.createObjectURL(videoInput.files[0]) };
    }

    const p = {
      id: uuid(),
      user: displayName || "Afroza",
      category, text, media,
      reactions: { like: 0, love: 0, laugh: 0, wow: 0 },
      comments: [],
      ts: Date.now()
    };
    posts.unshift(p); writeStore(posts);
    if (cardsEl) cardsEl.insertAdjacentHTML("afterbegin", cardHTML(p));
    if (emptyState) emptyState.style.display = "none";
    clearComposer();
  }

  if (postBtn) postBtn.onclick = submitPost;
  if (form) form.onsubmit = submitPost;

  // ---------- Row Interactions ----------
  const findPost = id => posts.find(p => p.id === id);
  const updateRow = id => {
    const idx = posts.findIndex(p => p.id === id);
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
    if (!t.closest(".tt-menu")) document.querySelectorAll(".tt-menu-pop").forEach(p => p.hidden = true);

    if (t.dataset.act === "delete") {
      const id = t.dataset.id;
      posts = posts.filter(p => p.id !== id);
      writeStore(posts);
      document.querySelector(`.card[data-id="${id}"]`)?.remove();
      if (emptyState) emptyState.style.display = posts.length ? "none" : "";
    }

    if (t.dataset.act === "edit") {
      const id = t.dataset.id, p = findPost(id);
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
      const area = document.querySelector(`.card[data-id="${id}"] .tt-edit-area`);
      const p = findPost(id); if (!p || !area) return;
      p.text = area.value.trim() || p.text;
      updateRow(id);
    }

    if (t.dataset.act === "cancel") updateRow(t.dataset.id);

    if (t.dataset.act === "react") {
      const id = t.dataset.id, key = t.dataset.emoji;
      const p = findPost(id); if (!p) return;
      p.reactions[key] = (p.reactions[key] || 0) + 1;
      updateRow(id);
    }

    if (t.dataset.act === "comment") {
      const id = t.dataset.id, p = findPost(id); if (!p) return;
      const input = document.querySelector(`.card[data-id="${id}"] .tt-comment-input`);
      const val = (input?.value || "").trim(); if (!val) return;
      p.comments.push({ id: uuid(), user: displayName || "Afroza", text: val, ts: Date.now() });
      updateRow(id);
    }
  });

  const escapeHTML = (s) => (s || "").replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

  // ---------- Init ----------
  renderAll();
  refreshAuth();
})();
