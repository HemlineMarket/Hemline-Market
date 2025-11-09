/* public/scripts/threadtalk.js
 * ThreadTalk front-end (localStorage only)
 * v2 — reactions + discreet edit/delete + category defaults
 */

(function () {
  // ----- Element helpers (robust to small HTML differences)
  const $ = (sel) => document.querySelector(sel);

  const els = {
    // composer
    category:
      $('#tt-category') ||
      $('#composeCategory') ||
      document.querySelector('select[aria-label="Category"]') ||
      document.querySelector('select'),
    text:
      $('#tt-text') ||
      $('#composeText') ||
      document.querySelector('textarea[aria-label="Post"]') ||
      document.querySelector('textarea'),
    postBtn:
      $('#tt-postBtn') ||
      $('#postBtn') ||
      document.querySelector('button.tt-post') ||
      document.querySelector('button[type="submit"]') ||
      document.querySelector('button[aria-label="Post"]'),
    // feed
    feed:
      $('#feedList') ||
      $('#cards') ||
      $('#tt-feed') ||
      document.getElementById('cards'),
    empty:
      $('#emptyState') ||
      $('#tt-empty') ||
      document.getElementById('emptyState'),
  };

  // If we somehow don't have the minimum needed controls, bail quietly
  if (!els.text || !els.postBtn) return;

  // ----- Storage
  const STORAGE_KEY = 'tt_posts_v2';
  const REACT_KEY = 'tt_reacts_v2'; // per-post, per-browser user reactions
  const USER_NAME_KEY = 'tt_user_name'; // optional stored name

  const getUserName = () => {
    // If you've got a real auth layer, hook here. For now:
    const stored = localStorage.getItem(USER_NAME_KEY);
    return (stored && stored.trim()) || 'Afroza';
  };

  const loadPosts = () => {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  };

  const savePosts = (posts) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(posts));
    } catch {}
  };

  const loadReacts = () => {
    try {
      const obj = JSON.parse(localStorage.getItem(REACT_KEY) || '{}');
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  };

  const saveReacts = (reacts) => {
    try {
      localStorage.setItem(REACT_KEY, JSON.stringify(reacts));
    } catch {}
  };

  // ----- Utilities
  const uid = () =>
    'p_' +
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);

  const timeAgo = (ts) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  const normCategory = (val) => {
    const clean = (val || '').toString().trim();
    return clean || 'Loose Threads';
  };

  // ----- Rendering
  const REACTIONS = [
    { key: 'like', emoji: '👍' },
    { key: 'love', emoji: '❤️' },
    { key: 'wow', emoji: '😮' },
    { key: 'sad', emoji: '😢' },
  ];

  const postShell = (p, myReact = {}) => {
    // subtle “kebab” menu, reactions row, body
    const reacts = REACTIONS.map((r) => {
      const count = (p.reactions && p.reactions[r.key]) || 0;
      const mine = myReact[r.key] ? 'opacity:1; transform:scale(1.06);' : '';
      return `
        <button class="tt-react"
                data-react="${r.key}"
                style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid #eee;border-radius:999px;background:#fff;font-size:13px;opacity:.8;${mine}">
          <span>${r.emoji}</span><span>${count}</span>
        </button>`;
    }).join('');

    return `
      <article class="tt-card" data-id="${p.id}"
        style="background:#fff;border:1px solid #e8e0d9;border-radius:16px;padding:14px 16px;box-shadow:0 8px 14px rgba(50,38,31,.06)">
        <div class="tt-meta" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;color:#7a6e68;font-size:13px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <strong style="color:#3f2f2a">${p.userName || 'You'}</strong>
            <span>•</span>
            <span>${timeAgo(p.ts)}</span>
            <span>•</span>
            <a href="#feed" class="tt-cat" style="font-weight:700;color:#991b1b;text-decoration:none">[${p.category}]</a>
          </div>
          <div class="tt-more-wrap" style="position:relative">
            <button class="tt-more"
              aria-label="More"
              style="border:1px solid #eee;background:#fff;border-radius:8px;width:28px;height:28px;opacity:.6">⋯</button>
            <div class="tt-menu"
                 style="display:none;position:absolute;right:0;top:30px;background:#fff;border:1px solid #e8e0d9;border-radius:10px;box-shadow:0 10px 20px rgba(0,0,0,.08);overflow:hidden">
              <button class="tt-edit" style="display:block;padding:8px 12px;font-size:14px;background:#fff;border:0;width:120px;text-align:left">Edit</button>
              <button class="tt-delete" style="display:block;padding:8px 12px;font-size:14px;background:#fff;border:0;width:120px;text-align:left;color:#b91c1c">Delete</button>
            </div>
          </div>
        </div>

        <div class="tt-body" style="color:#4b3d35;font-size:15px;white-space:pre-wrap">${escapeHTML(p.text || '')}</div>

        <div class="tt-reacts" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${reacts}
        </div>
      </article>
    `;
  };

  const escapeHTML = (s) =>
    (s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');

  const renderAll = () => {
    if (!els.feed) return;
    const posts = loadPosts();
    const reacts = loadReacts();

    if (!posts.length && els.empty) {
      els.empty.style.display = '';
      els.feed.innerHTML = '';
      return;
    }
    if (els.empty) els.empty.style.display = 'none';

    els.feed.innerHTML = posts
      .map((p) => {
        const myReact = reacts[p.id] || {};
        return postShell(p, myReact);
      })
      .join('');

    // Wire up item controls
    els.feed.querySelectorAll('.tt-card').forEach((card) => {
      const id = card.getAttribute('data-id');
      const moreBtn = card.querySelector('.tt-more');
      const menu = card.querySelector('.tt-menu');
      const editBtn = card.querySelector('.tt-edit');
      const delBtn = card.querySelector('.tt-delete');

      if (moreBtn && menu) {
        moreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        });
        document.addEventListener('click', () => (menu.style.display = 'none'));
      }

      if (editBtn) {
        editBtn.addEventListener('click', () => beginEdit(card, id));
      }
      if (delBtn) {
        delBtn.addEventListener('click', () => doDelete(card, id));
      }

      // reactions
      card.querySelectorAll('.tt-react').forEach((btn) => {
        btn.addEventListener('click', () => toggleReact(id, btn.getAttribute('data-react')));
      });
    });
  };

  // ----- Edit / Delete
  const beginEdit = (card, id) => {
    const body = card.querySelector('.tt-body');
    if (!body) return;

    const original = body.textContent || '';
    body.setAttribute('data-orig', original);

    body.innerHTML = `
      <textarea class="tt-edit-area"
        style="width:100%;min-height:110px;border:1px solid #e8e0d9;border-radius:10px;padding:10px 12px;font-size:15px">${escapeHTML(
          original
        )}</textarea>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="tt-save" style="background:#2d2d2d;border:1px solid #2d2d2d;color:#fff;border-radius:10px;padding:8px 12px">Save</button>
        <button class="tt-cancel" style="background:#fff;border:1px solid #e8e0d9;color:#3f2f2a;border-radius:10px;padding:8px 12px">Cancel</button>
      </div>
    `;

    card.querySelector('.tt-save').addEventListener('click', () => {
      const ta = card.querySelector('.tt-edit-area');
      const newText = (ta && ta.value) || original;
      const posts = loadPosts();
      const i = posts.findIndex((p) => p.id === id);
      if (i >= 0) {
        posts[i].text = newText;
        savePosts(posts);
        renderAll();
      }
    });

    card.querySelector('.tt-cancel').addEventListener('click', () => renderAll());
  };

  const doDelete = (card, id) => {
    const ok = confirm('Delete this post? This cannot be undone.');
    if (!ok) return;
    const posts = loadPosts().filter((p) => p.id !== id);
    savePosts(posts);
    // also clear reactions for this post id
    const reacts = loadReacts();
    delete reacts[id];
    saveReacts(reacts);
    renderAll();
  };

  // ----- Reactions
  const toggleReact = (postId, key) => {
    const posts = loadPosts();
    const p = posts.find((x) => x.id === postId);
    if (!p) return;

    if (!p.reactions) p.reactions = {};
    if (typeof p.reactions[key] !== 'number') p.reactions[key] = 0;

    const reacts = loadReacts();
    const mine = reacts[postId] || {};

    if (mine[key]) {
      // un-react
      mine[key] = false;
      p.reactions[key] = Math.max(0, (p.reactions[key] || 0) - 1);
    } else {
      // add my reaction; remove other single reaction if you want exclusive per user
      mine[key] = true;
      p.reactions[key] = (p.reactions[key] || 0) + 1;
    }

    reacts[postId] = mine;
    savePosts(posts);
    saveReacts(reacts);
    renderAll();
  };

  // ----- Submit
  const onSubmit = (e) => {
    e.preventDefault();
    const userName = getUserName();
    const category = normCategory(els.category ? els.category.value : '');
    const text = (els.text && els.text.value ? els.text.value : '').trim();
    if (!text) {
      if (els.text) els.text.focus();
      return;
    }

    const newPost = {
      id: uid(),
      userName,
      category,
      text,
      ts: Date.now(),
      reactions: {}, // counts
    };

    const posts = loadPosts();
    posts.unshift(newPost);
    savePosts(posts);

    if (els.text) els.text.value = '';
    if (els.category) els.category.value = '';
    if (els.empty) els.empty.style.display = 'none';
    renderAll();

    // jump to feed
    const feed = document.getElementById('feed') || els.feed;
    if (feed && feed.scrollIntoView) feed.scrollIntoView({ behavior: 'smooth' });
  };

  if (els.postBtn) {
    // Some pages wire the button directly; prevent double-submit
    els.postBtn.addEventListener('click', onSubmit);
  }
  // Also catch Enter+Meta in textarea for quick-post
  if (els.text) {
    els.text.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        onSubmit(e);
      }
    });
  }

  // ----- Category tiles → set composer + scroll
  document.querySelectorAll('.topics .topic, .categories .category, .topics-grid a, .tt-category-tile').forEach((tile) => {
    tile.addEventListener('click', (ev) => {
      const label =
        tile.getAttribute('aria-label') ||
        tile.textContent ||
        '';
      const name = label.trim();
      if (els.category && name) {
        // Try to set the select to the clicked category if it exists in options
        const found = Array.from(els.category.options || []).find(
          (o) => o.textContent.trim().toLowerCase() === name.toLowerCase()
        );
        if (found) {
          els.category.value = found.value;
        }
      }
      // Scroll to composer
      if (els.text && els.text.scrollIntoView) {
        els.text.scrollIntoView({ behavior: 'smooth', block: 'center' });
        els.text.focus();
      }
      ev.preventDefault();
    });
  });

  // Initial render
  renderAll();
})();
