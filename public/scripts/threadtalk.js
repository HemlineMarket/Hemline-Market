/* ThreadTalk client (localStorage) + Supabase Auth gate
   - Prevents double init
   - Single sign-in box
   - Supports Email+Password, Magic Link, and Google
*/

(function () {
  // ---- prevent double init --------------------------------------------------
  if (window.__TT_THREADTALK_INITED__) return;
  window.__TT_THREADTALK_INITED__ = true;

  // ---------------------------
  // Supabase auth state
  // ---------------------------
  const sb = (window && window.supabase) ? window.supabase : null;
  let currentUser = null;
  let displayName = null;

  // ---------------------------
  // Storage + DOM refs
  // ---------------------------
  const LS_KEY = "tt_posts";
  const $ = (id) => document.getElementById(id);

  const cardsEl = $("cards");
  const emptyState = $("emptyState");
  const sel = $("composeCategory");
  const txt = $("composeText");
  const photoInput = $("photoInput");
  const videoInput = $("videoInput");
  const postBtn = $("postBtn");
  const mediaPreview = $("mediaPreview");
  const form = $("composer");

  // ---------------------------
  // Helpers
  // ---------------------------
  function uuid() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function nowLabel() { return "just now"; }

  function readStore() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); }
    catch { return []; }
  }
  function writeStore(posts) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(posts)); }
    catch {}
  }

  let posts = readStore();

  function categoryHref(cat) {
    const k = (cat || "").toLowerCase();
    if (k === "showcase") return "showcase.html";
    if (k === "tailoring") return "tailoring.html";
    if (k === "stitch school") return "stitch-school.html";
    if (k === "fabric sos") return "fabric-sos.html";
    if (k === "before & after" || k === "before and after" || k === "before-after") return "before-after.html";
    if (k === "pattern hacks") return "pattern-hacks.html";
    if (k === "stash confessions") return "stash-confessions.html";
    return "loose-threads.html";
  }

  function mediaHTML(media) {
    if (!media) return "";
    if (media.type === "image") return `<img class="post-img" src="${media.url}" alt="post image">`;
    if (media.type === "video") return `<video class="post-video" controls src="${media.url}"></video>`;
    return "";
  }

  function reactionBarHTML(p) {
    const r = p.reactions || { like: 0, love: 0, laugh: 0, wow: 0 };
    return `
      <div class="tt-react-row" role="group" aria-label="Reactions">
        <button class="tt-react" data-act="react" data-emoji="like"  data-id="${p.id}" title="Like">👍 <span>${r.like||0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="love"  data-id="${p.id}" title="Love">❤️ <span>${r.love||0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="laugh" data-id="${p.id}" title="Funny">😂 <span>${r.laugh||0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="wow"   data-id="${p.id}" title="Wow">😮 <span>${r.wow||0}</span></button>
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
    const items = c.map(cm => `
      <div class="tt-comment" data-cid="${cm.id}">
        <div class="tt-comment-head"><strong>${cm.user}</strong> · <span>just now</span></div>
        <div class="tt-comment-body">${escapeHTML(cm.text)}</div>
      </div>
    `).join("");
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
  // Auth gate UI
  // ---------------------------
  function removeExistingAuthBox() {
    document.querySelectorAll("#tt-auth").forEach(n => n.remove());
  }

  function disableComposerWithAuthPrompt() {
    if (!form) return;

    [sel, txt, photoInput, videoInput, postBtn].forEach(n => { if (n) n.disabled = true; });
    removeExistingAuthBox();

    const authBox = document.createElement("div");
    authBox.id = "tt-auth";
    authBox.style.margin = "8px";
    authBox.style.padding = "10px";
    authBox.style.border = "1px solid var(--border)";
    authBox.style.borderRadius = "10px";
    authBox.style.background = "#fff";
    authBox.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <strong>Sign in to post</strong>

        <!-- Email + password -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="ttEmail" type="email" placeholder="you@example.com"
                 style="flex:1 1 220px;border:1px solid var(--border);border-radius:10px;padding:8px">
          <input id="ttPass" type="password" placeholder="Password"
                 style="flex:1 1 180px;border:1px solid var(--border);border-radius:10px;padding:8px" autocomplete="current-password">
          <button id="ttSignInPwd"
                  style="border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:10px;padding:8px 12px">Sign in</button>
          <button id="ttSignUpPwd"
                  style="border:1px solid var(--border);background:#fff;border-radius:10px;padding:8px 12px">Create account</button>
        </div>

        <!-- Magic link + Google -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          <input id="ttEmailLink" type="email" placeholder="you@example.com"
                 style="flex:1 1 240px;border:1px solid var(--border);border-radius:10px;padding:8px">
          <button id="ttEmailBtn"
                  style="border:1px solid var(--border);background:#fff;border-radius:10px;padding:8px 12px">Email link</button>
          <button id="ttGoogleBtn"
                  style="border:1px solid var(--border);background:#fff;border-radius:10px;padding:8px 12px">Continue with Google</button>
        </div>

        <div style="color:var(--muted);font-size:12px">
          Use password sign-in, a one-time email link, or Google. After signing in, return to this page and the composer will unlock.
        </div>
      </div>
    `;
    form.appendChild(authBox);

    // Wire: password sign-in
    if (sb) {
      const emailEl = document.getElementById("ttEmail");
      const passEl  = document.getElementById("ttPass");
      const inBtn   = document.getElementById("ttSignInPwd");
      const upBtn   = document.getElementById("ttSignUpPwd");
      const mlEl    = document.getElementById("ttEmailLink");
      const mlBtn   = document.getElementById("ttEmailBtn");
      const gBtn    = document.getElementById("ttGoogleBtn");

      inBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const email = (emailEl.value || "").trim();
        const password = passEl.value || "";
        if (!email || !password) return emailEl.focus();
        try {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (!error) location.reload();
          else inBtn.textContent = "Try again";
        } catch { inBtn.textContent = "Try again"; }
      });

      upBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const email = (emailEl.value || "").trim();
        const password = passEl.value || "";
        if (!email || !password) return emailEl.focus();
        try {
          const localName = email.split("@")[0];
          const { error } = await sb.auth.signUp({
            email,
            password,
            options: { data: { full_name: localName } }
          });
          upBtn.textContent = error ? "Error" : "Check email";
        } catch { upBtn.textContent = "Error"; }
      });

      mlBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const email = (mlEl.value || "").trim();
        if (!email) return mlEl.focus();
        try {
          await sb.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: window.location.href }
          });
          mlBtn.textContent = "Link sent!";
          setTimeout(() => (mlBtn.textContent = "Email link"), 1600);
        } catch { mlBtn.textContent = "Error"; }
      });

      gBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await sb.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.href }
          });
        } catch {}
      });
    }
  }

  function enableComposerForUser(u) {
    [sel, txt, photoInput, videoInput, postBtn].forEach(n => { if (n) n.disabled = false; });
    removeExistingAuthBox();

    const meta = (u && u.user_metadata) || {};
    const email = u && u.email;
    displayName =
      meta.full_name ||
      meta.name ||
      (email ? email.split("@")[0] : null) ||
      (localStorage.getItem("tt_user") || "Afroza");
  }

  async function refreshAuthGate() {
    if (!sb) { enableComposerForUser({ user_metadata: { name: localStorage.getItem("tt_user") || "Afroza" }, email: "" }); return; }
    try {
      const { data } = await sb.auth.getSession();
      currentUser = data && data.session ? data.session.user : null;
    } catch { currentUser = null; }
    if (currentUser) enableComposerForUser(currentUser);
    else disableComposerWithAuthPrompt();
  }

  if (sb && sb.auth && sb.auth.onAuthStateChange) {
    sb.auth.onAuthStateChange((_evt, session) => {
      currentUser = session && session.user ? session.user : null;
      if (currentUser) enableComposerForUser(currentUser);
      else disableComposerWithAuthPrompt();
    });
  }

  // ---------------------------
  // Composer logic
  // ---------------------------
  function clearComposer() {
    if (sel) sel.value = "";
    if (txt) txt.value = "";
    if (photoInput) photoInput.value = "";
    if (videoInput) videoInput.value = "";
    if (mediaPreview) { mediaPreview.hidden = true; mediaPreview.innerHTML = ""; }
    if (txt) txt.focus();
  }

  function showPreview(file, kind) {
    if (!mediaPreview) return;
    const url = URL.createObjectURL(file);
    mediaPreview.hidden = false;
    mediaPreview.innerHTML = (kind === "image")
      ? `<img alt="preview image" src="${url}">`
      : `<video controls src="${url}"></video>`;
  }

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

  function submitPost(e) {
    if (e) e.preventDefault();
    if (!currentUser) { disableComposerWithAuthPrompt(); return; }

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
      user: displayName || (localStorage.getItem("tt_user") || "Afroza"),
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

    const feed = document.getElementById("feed");
    if (feed) feed.scrollIntoView({ behavior: "smooth" });
  }

  if (postBtn) postBtn.addEventListener("click", submitPost);
  if (form) form.addEventListener("submit", submitPost);

  // ---------------------------
  // Row-level interactions
  // ---------------------------
  function findPost(id) { return posts.find((x) => x.id === id); }

  function updateAndRerenderRow(id) {
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

    if (t.matches(".tt-menu-btn")) {
      const id = t.getAttribute("data-id");
      const pop = document.querySelector(`.tt-menu-pop[data-pop="${id}"]`);
      if (pop) pop.hidden = !pop.hidden;
      return;
    }
    if (!t.closest(".tt-menu")) {
      document.querySelectorAll(".tt-menu-pop").forEach((p) => (p.hidden = true));
    }

    if (t.matches('[data-act="delete"]')) {
      const id = t.getAttribute("data-id");
      posts = posts.filter((x) => x.id !== id);
      writeStore(posts);
      const card = document.querySelector(`.card[data-id="${id}"]`);
      if (card) card.remove();
      emptyState.style.display = posts.length ? "none" : "";
      return;
    }

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

    if (t.matches('[data-act="cancel"]')) {
      const id = t.getAttribute("data-id");
      updateAndRerenderRow(id);
      return;
    }

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

    if (t.matches('[data-act="comment"]')) {
      const id = t.getAttribute("data-id");
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const input = card && card.querySelector(".tt-comment-input");
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      const p = findPost(id);
      if (!p) return;
      const who = displayName || (localStorage.getItem("tt_user") || "Afroza");
      p.comments = p.comments || [];
      p.comments.push({ id: uuid(), user: who, text, ts: Date.now() });
      updateAndRerenderRow(id);
      return;
    }
  });

  // ---------------------------
  // Util
  // ---------------------------
  function escapeHTML(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---------------------------
  // Init
  // ---------------------------
  renderAll();
  refreshAuthGate();

})();
