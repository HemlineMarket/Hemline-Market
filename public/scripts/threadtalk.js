// public/scripts/threadtalk.js
// ThreadTalk client: localStorage + Supabase Auth gate

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
      <button class="tt-menu-btn" data-id="${p.id}" data-act="menu">⋯</button>
      <div class="tt-menu-pop" data-pop="${p.id}" hidden>
        <button class="tt-menu-item" data-act="edit" data-id="${p.id}">Edit</button>
        <button class="tt-menu-item danger" data-act="delete" data-id="${p.id}">Delete</button>
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
          <button class="tt-comment-send" data-act="comment" data-id="${p.id}">Send</button>
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
    cardsEl.innerHTML = posts.map(cardHTML).join("");
    emptyState.style.display = posts.length ? "none" : "";
  };

  // ---------------- Auth Gate ----------------
  const removeAuthBox = () => document.querySelectorAll("#tt-auth").forEach(n => n.remove());
  const disableComposer = () => {
    [sel, txt, photoInput, videoInput, postBtn].forEach(n => n.disabled = true);
    removeAuthBox();
    const box = document.createElement("div");
    box.id = "tt-auth";
    box.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin:8px;background:#fff">
        <strong>Sign in to post</strong>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <input id="ttEmail" type="email" placeholder="you@example.com" style="padding:8px;border:1px solid var(--border);border-radius:10px">
          <input id="ttPass" type="password" placeholder="Password" style="padding:8px;border:1px solid var(--border);border-radius:10px">
          <button id="ttSignInPwd" style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:10px;padding:8px 12px">Sign in</button>
          <button id="ttSignUpPwd" style="border:1px solid var(--border);background:#fff;border-radius:10px;padding:8px 12px">Create account</button>
        </div>
      </div>`;
    form.appendChild(box);

    if (!sb) return;
    const emailEl = $("ttEmail"), passEl = $("ttPass");
    const inBtn = $("ttSignInPwd"), upBtn = $("ttSignUpPwd");
    inBtn.onclick = async () => {
      const email = emailEl.value.trim(), pw = passEl.value.trim();
      if (!email || !pw) return;
      const { error } = await sb.auth.signInWithPassword({ email, password: pw });
      if (!error) location.reload();
    };
    upBtn.onclick = async () => {
      const email = emailEl.value.trim(), pw = passEl.value.trim();
      if (!email || !pw) return;
      const { error } = await sb.auth.signUp({ email, password: pw, options: { data: { full_name: email.split("@")[0] } } });
      if (!error) upBtn.textContent = "Check email";
    };
  };

  const enableComposer = (u) => {
    [sel, txt, photoInput, videoInput, postBtn].forEach(n => n.disabled = false);
    removeAuthBox();
    const meta = u?.user_metadata || {};
    const email = u?.email;
    displayName = meta.full_name || meta.name || (email ? email.split("@")[0] : "User");
  };

  async function refreshAuth() {
    if (!sb) return enableComposer({ user_metadata: { full_name: "Guest" } });
    const { data } = await sb.auth.getSession();
    currentUser = data?.session?.user || null;
    currentUser ? enableComposer(currentUser) : disableComposer();
  }

  if (sb?.auth?.onAuthStateChange)
    sb.auth.onAuthStateChange((_e, s) => (s?.user ? enableComposer(s.user) : disableComposer()));

  // ---------------- Posts ----------------
  const clearComposer = () => { txt.value = ""; sel.value = ""; photoInput.value = ""; videoInput.value = ""; mediaPreview.hidden = true; };
  const showPreview = (file, kind) => {
    const url = URL.createObjectURL(file);
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = kind === "image" ? `<img src="${url}" alt="">` : `<video src="${url}" controls></video>`;
  };

  photoInput.onchange = () => { if (photoInput.files[0]) { videoInput.value = ""; showPreview(photoInput.files[0], "image"); } };
  videoInput.onchange = () => { if (videoInput.files[0]) { photoInput.value = ""; showPreview(videoInput.files[0], "video"); } };

  function submitPost(e) {
    e?.preventDefault();
    if (!currentUser) return disableComposer();
    const text = txt.value.trim(); if (!text) return;
    const cat = sel.value || "Loose Threads";
    let media = null;
    if (photoInput.files[0]) media = { type: "image", url: URL.createObjectURL(photoInput.files[0]) };
    else if (videoInput.files[0]) media = { type: "video", url: URL.createObjectURL(videoInput.files[0]) };

    const p = { id: uuid(), user: displayName, category: cat, text, media, reactions: { like: 0, love: 0, laugh: 0, wow: 0 }, comments: [], ts: Date.now() };
    posts.unshift(p); writeStore(posts);
    cardsEl.insertAdjacentHTML("afterbegin", cardHTML(p));
    emptyState.style.display = "none";
    clearComposer();
  }
  postBtn.onclick = submitPost; form.onsubmit = submitPost;

  // ---------------- Interactions ----------------
  const findPost = id => posts.find(p => p.id === id);
  const updateRow = id => {
    const idx = posts.findIndex(p => p.id === id);
    if (idx < 0) return;
    const el = document.querySelector(`.card[data-id="${id}"]`);
    const wrap = document.createElement("div");
    wrap.innerHTML = cardHTML(posts[idx]);
    el.replaceWith(wrap.firstElementChild);
    writeStore(posts);
  };

  document.onclick = (e) => {
    const t = e.target;
    if (t.dataset.act === "menu") {
      const pop = document.querySelector(`.tt-menu-pop[data-pop="${t.dataset.id}"]`);
      pop.hidden = !pop.hidden; return;
    }
    document.querySelectorAll(".tt-menu-pop").forEach(p => p.hidden = true);

    if (t.dataset.act === "delete") {
      posts = posts.filter(p => p.id !== t.dataset.id);
      writeStore(posts);
      document.querySelector(`.card[data-id="${t.dataset.id}"]`)?.remove();
      emptyState.style.display = posts.length ? "none" : "";
    }

    if (t.dataset.act === "edit") {
      const id = t.dataset.id, p = findPost(id), card = document.querySelector(`.card[data-id="${id}"]`);
      const body = card.querySelector('[data-role="text"]');
      body.innerHTML = `<textarea class="tt-edit-area">${escapeHTML(p.text)}</textarea>
        <div class="tt-edit-actions">
          <button class="tt-edit-save" data-act="save" data-id="${id}">Save</button>
          <button class="tt-edit-cancel" data-act="cancel" data-id="${id}">Cancel</button>
        </div>`;
    }

    if (t.dataset.act === "save") {
      const id = t.dataset.id, p = findPost(id);
      const val = document.querySelector(`.card[data-id="${id}"] .tt-edit-area`).value.trim();
      p.text = val; updateRow(id);
    }
    if (t.dataset.act === "cancel") updateRow(t.dataset.id);

    if (t.dataset.act === "react") {
      const p = findPost(t.dataset.id);
      const ekey = t.dataset.emoji;
      p.reactions[ekey]++; updateRow(t.dataset.id);
    }

    if (t.dataset.act === "comment") {
      const id = t.dataset.id, p = findPost(id);
      const input = document.querySelector(`.card[data-id="${id}"] .tt-comment-input`);
      const val = input.value.trim(); if (!val) return;
      p.comments.push({ id: uuid(), user: displayName, text: val, ts: Date.now() });
      updateRow(id);
    }
  };

  const escapeHTML = (s) => (s || "").replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  renderAll();
  refreshAuth();
})();
