/* ThreadTalk (Supabase edition)
   - UI stays exactly the same.
   - Reads: everyone (public SELECT policy).
   - Writes (insert/update/delete): only the signed-in user who owns the row (user_id).
   - Table: public.threadtalk_posts
     Columns (suggested):
       id uuid (PK, default gen_random_uuid())
       user_id uuid
       username text
       category text
       text text
       media_url text       -- optional for future image/video
       media_type text      -- optional ("image" | "video")
       reactions jsonb      -- { like:0, love:0, laugh:0, wow:0 }
       comments  jsonb      -- [{ id, user, text, ts }]
       created_at timestamptz default now()
*/

(function () {
  // -------- supabase client ----------
  const supa = window.supabase; // provided by threadtalk.supabase.js
  if (!supa) {
    console.error("Supabase client not found. Did you include threadtalk.supabase.js before this file?");
  }

  // -------- quick DOM helpers --------
  const $ = (id) => document.getElementById(id);

  const cardsEl      = $("cards");
  const emptyState   = $("emptyState");

  const sel          = $("composeCategory");
  const txt          = $("composeText");
  const photoInput   = $("photoInput");
  const videoInput   = $("videoInput");
  const mediaPreview = $("mediaPreview");
  const postBtn      = $("postBtn");

  const toast = (() => {
    const el = document.getElementById("toast");
    return (msg) => {
      if (!el) return;
      el.textContent = msg;
      el.classList.add("show");
      setTimeout(() => el.classList.remove("show"), 1400);
    };
  })();

  // -------- session / username --------
  let session = null;
  let currentUserId = null;

  function deriveUsername() {
    // Prefer Supabase profile; otherwise local preference; otherwise fallback
    const local = (localStorage.getItem("tt_user") || "").trim();
    if (session?.user?.user_metadata?.full_name) return session.user.user_metadata.full_name;
    if (session?.user?.email) return session.user.email.split("@")[0];
    if (local) return local;
    return "Afroza";
  }

  // -------- utilities --------
  function uuid() {
    return "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  function nowLabel() {
    return "just now";
  }
  function escapeHTML(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
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

  function mediaHTML(row) {
    if (!row?.media_url || !row?.media_type) return "";
    if (row.media_type === "image") {
      return `<img class="post-img" src="${row.media_url}" alt="post image">`;
    }
    if (row.media_type === "video") {
      return `<video class="post-video" controls src="${row.media_url}"></video>`;
    }
    return "";
  }

  function reactionBarHTML(row) {
    const r = row.reactions || { like: 0, love: 0, laugh: 0, wow: 0 };
    return `
      <div class="tt-react-row" role="group" aria-label="Reactions">
        <button class="tt-react" data-act="react" data-emoji="like"  data-id="${row.id}">👍 <span>${r.like || 0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="love"  data-id="${row.id}">❤️ <span>${r.love || 0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="laugh" data-id="${row.id}">😂 <span>${r.laugh || 0}</span></button>
        <button class="tt-react" data-act="react" data-emoji="wow"   data-id="${row.id}">😮 <span>${r.wow || 0}</span></button>
      </div>`;
  }

  function menuHTML(row) {
    // Only show Edit/Delete if this post belongs to the current session user
    const canEdit = !!(currentUserId && row.user_id === currentUserId);
    if (!canEdit) return "";
    return `
      <div class="tt-menu">
        <button class="tt-menu-btn" aria-label="More" data-id="${row.id}" data-act="menu">⋯</button>
        <div class="tt-menu-pop" data-pop="${row.id}" hidden>
          <button class="tt-menu-item" data-act="edit" data-id="${row.id}">Edit</button>
          <button class="tt-menu-item danger" data-act="delete" data-id="${row.id}">Delete</button>
        </div>
      </div>`;
  }

  function commentsHTML(row) {
    const c = row.comments || [];
    const items = c.map(cm => `
      <div class="tt-comment" data-cid="${cm.id}">
        <div class="tt-comment-head"><strong>${escapeHTML(cm.user)}</strong> · <span>just now</span></div>
        <div class="tt-comment-body">${escapeHTML(cm.text)}</div>
      </div>`).join("");
    return `
      <div class="tt-comments">
        ${items}
        <div class="tt-comment-new">
          <input type="text" class="tt-comment-input" placeholder="Write a comment…" data-id="${row.id}">
          <button class="tt-comment-send" data-act="comment" data-id="${row.id}">Send</button>
        </div>
      </div>`;
  }

  function cardHTML(row) {
    return `
      <article class="card" data-id="${row.id}">
        <div class="meta" style="justify-content:space-between;">
          <div style="display:flex;gap:8px;align-items:center;">
            <span><strong>${escapeHTML(row.username || "User")}</strong></span>
            <span>•</span><span>${nowLabel()}</span>
            <span>•</span><a class="cat" href="${categoryHref(row.category)}">[${escapeHTML(row.category)}]</a>
          </div>
          ${menuHTML(row)}
        </div>
        ${mediaHTML(row)}
        <div class="preview" data-role="text">${escapeHTML(row.text)}</div>
        ${reactionBarHTML(row)}
        ${commentsHTML(row)}
      </article>`;
  }

  function renderAll(rows) {
    if (!rows || rows.length === 0) {
      cardsEl.innerHTML = "";
      emptyState.style.display = "";
      return;
    }
    cardsEl.innerHTML = rows.map(cardHTML).join("");
    emptyState.style.display = "none";
  }

  async function refreshFeed() {
    const { data, error } = await supa
      .from("threadtalk_posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error(error);
      toast("Could not load threads.");
      return;
    }
    cache.posts = data || [];
    renderAll(cache.posts);
  }

  // in-memory cache (keeps the page snappy when we tweak one row)
  const cache = { posts: [] };
  function findRow(id) { return cache.posts.find(p => p.id === id); }
  function replaceRow(updated) {
    const idx = cache.posts.findIndex(p => p.id === updated.id);
    if (idx !== -1) cache.posts[idx] = updated;
    // re-render just this card
    const old = document.querySelector(`.card[data-id="${updated.id}"]`);
    if (!old) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = cardHTML(updated);
    old.replaceWith(wrap.firstElementChild);
  }
  function removeRow(id) {
    cache.posts = cache.posts.filter(p => p.id !== id);
    const el = document.querySelector(`.card[data-id="${id}"]`);
    if (el) el.remove();
    if (cache.posts.length === 0) emptyState.style.display = "";
  }
  function prependRow(row) {
    cache.posts.unshift(row);
    const el = document.createElement("div");
    el.innerHTML = cardHTML(row);
    const card = el.firstElementChild;
    if (cardsEl.firstChild) cardsEl.insertBefore(card, cardsEl.firstChild);
    else cardsEl.appendChild(card);
    emptyState.style.display = "none";
  }

  // -------- composer (unchanged UI) --------
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
  photoInput?.addEventListener("change", function () {
    if (this.files?.[0]) { videoInput.value = ""; showPreview(this.files[0], "image"); }
  });
  videoInput?.addEventListener("change", function () {
    if (this.files?.[0]) { photoInput.value = ""; showPreview(this.files[0], "video"); }
  });

  async function submitPost(e) {
    e?.preventDefault();
    const textVal = (txt?.value || "").trim();
    if (!textVal) { txt?.focus(); return; }

    const categoryVal = (sel?.value || "").trim() || "Loose Threads";

    // NOTE: media upload to Supabase Storage can come later; keep null for now.
    const media_url = null;
    const media_type = null;

    // must be signed in to insert due to RLS
    if (!currentUserId) {
      toast("Sign in to post.");
      return;
    }

    const row = {
      user_id: currentUserId,
      username: deriveUsername(),
      category: categoryVal,
      text: textVal,
      media_url,
      media_type,
      reactions: { like: 0, love: 0, laugh: 0, wow: 0 },
      comments: []
    };

    const { data, error } = await supa
      .from("threadtalk_posts")
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error(error);
      toast("Could not post.");
      return;
    }

    prependRow(data);
    clearComposer();
    toast("Posted");
    document.getElementById("feed")?.scrollIntoView({ behavior: "smooth" });
  }

  postBtn?.addEventListener("click", submitPost);
  document.getElementById("composer")?.addEventListener("submit", submitPost);

  // -------- interactions (delegated) --------
  document.addEventListener("click", async (e) => {
    const t = e.target;

    // menus
    if (t.matches(".tt-menu-btn")) {
      const id = t.getAttribute("data-id");
      const pop = document.querySelector(`.tt-menu-pop[data-pop="${id}"]`);
      if (pop) pop.hidden = !pop.hidden;
      return;
    }
    if (!t.closest(".tt-menu")) {
      document.querySelectorAll(".tt-menu-pop").forEach(p => p.hidden = true);
    }

    // delete
    if (t.matches('[data-act="delete"]')) {
      const id = t.getAttribute("data-id");
      const { error } = await supa.from("threadtalk_posts").delete().eq("id", id);
      if (error) { console.error(error); toast("Delete failed"); return; }
      removeRow(id);
      toast("Deleted");
      return;
    }

    // edit -> turn into textarea
    if (t.matches('[data-act="edit"]')) {
      const id = t.getAttribute("data-id");
      const row = findRow(id);
      if (!row) return;
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const textDiv = card?.querySelector('[data-role="text"]');
      if (!textDiv) return;
      textDiv.innerHTML = `
        <textarea class="tt-edit-area">${escapeHTML(row.text)}</textarea>
        <div class="tt-edit-actions">
          <button class="tt-edit-save" data-act="save" data-id="${id}">Save</button>
          <button class="tt-edit-cancel" data-act="cancel" data-id="${id}">Cancel</button>
        </div>`;
      return;
    }

    // save edit
    if (t.matches('[data-act="save"]')) {
      const id = t.getAttribute("data-id");
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const area = card?.querySelector(".tt-edit-area");
      if (!area) return;
      const val = area.value.trim();
      const { data, error } = await supa
        .from("threadtalk_posts")
        .update({ text: val })
        .eq("id", id)
        .select()
        .single();
      if (error) { console.error(error); toast("Update failed"); return; }
      replaceRow(data);
      toast("Updated");
      return;
    }

    // cancel edit
    if (t.matches('[data-act="cancel"]')) {
      const id = t.getAttribute("data-id");
      const row = findRow(id);
      if (!row) return;
      replaceRow(row); // re-renders original
      return;
    }

    // reactions (+1)
    if (t.matches('[data-act="react"]')) {
      const id = t.getAttribute("data-id");
      const emoji = t.getAttribute("data-emoji");
      const row = findRow(id);
      if (!row) return;
      const r = Object.assign({ like:0, love:0, laugh:0, wow:0 }, row.reactions || {});
      r[emoji] = (r[emoji] || 0) + 1;
      const { data, error } = await supa
        .from("threadtalk_posts")
        .update({ reactions: r })
        .eq("id", id)
        .select()
        .single();
      if (error) { console.error(error); toast("Reaction failed"); return; }
      replaceRow(data);
      return;
    }

    // comments
    if (t.matches('[data-act="comment"]')) {
      const id = t.getAttribute("data-id");
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const input = card?.querySelector(".tt-comment-input");
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;

      const row = findRow(id);
      if (!row) return;

      // must be signed in to comment (keeps ownership simple)
      if (!currentUserId) { toast("Sign in to comment."); return; }

      const comments = Array.isArray(row.comments) ? row.comments.slice() : [];
      comments.push({ id: uuid(), user: deriveUsername(), text, ts: Date.now() });

      const { data, error } = await supa
        .from("threadtalk_posts")
        .update({ comments })
        .eq("id", id)
        .select()
        .single();

      if (error) { console.error(error); toast("Comment failed"); return; }
      replaceRow(data);
      input.value = "";
      return;
    }
  });

  // -------- preview image/video hooks already bound above --------

  // -------- auth/session boot --------
  async function initSession() {
    const { data: { session: s } } = await supa.auth.getSession();
    session = s || null;
    currentUserId = session?.user?.id || null;

    // keep avatar initials the same way you had it
    try {
      const avatar = document.getElementById("avatar");
      const url = localStorage.getItem("avatarUrl");
      if (avatar && url) { avatar.textContent = ""; avatar.style.backgroundImage = `url('${url}')`; }
    } catch {}

    await refreshFeed();
  }

  // live session change
  supa.auth.onAuthStateChange((_event, s) => {
    session = s || null;
    currentUserId = session?.user?.id || null;
    refreshFeed();
  });

  // -------- go --------
  initSession();
})();
