/* ThreadTalk client logic (CSP-safe: no inline JS) */

/* =============== Utilities =============== */
const LS_KEY = 'tt_posts_v1';            // where we store posts
const USER_NAME = localStorage.getItem('hm_user_name') || 'Afroza'; // show your name
const AVATAR_URL = localStorage.getItem('avatarUrl') || '';

function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function nowLabel(ts){
  const d = ts ? new Date(ts) : new Date();
  return d.toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }

function readPosts(){
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}
function writePosts(arr){
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

/* Convert a File to a dataURL for persistence */
function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/* =============== Hamburger =============== */
(function setupHamburger(){
  const sheet = $('#menuSheet');
  const overlay = $('#sheetOverlay');
  const openBtn = $('#openMenu');
  const closeBtn = $('#closeMenu');

  function open(){
    if(!sheet || !overlay) return;
    sheet.classList.add('open');
    sheet.setAttribute('aria-hidden','false');
    overlay.classList.add('show');
    document.body.style.overflow='hidden';
  }
  function close(){
    if(!sheet || !overlay) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden','true');
    overlay.classList.remove('show');
    document.body.style.overflow='';
  }
  if(openBtn) openBtn.addEventListener('click', e=>{ e.preventDefault(); open(); });
  if(closeBtn) closeBtn.addEventListener('click', e=>{ e.preventDefault(); close(); });
  if(overlay) overlay.addEventListener('click', close);
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') close(); });

  // Avatar image
  const avatar = $('#avatar');
  if(avatar && AVATAR_URL){
    avatar.textContent = '';
    avatar.style.backgroundImage = `url('${AVATAR_URL}')`;
  }
})();

/* =============== Composer / Posting =============== */
const composeCategory = $('#composeCategory');
const composeText     = $('#composeText');
const photoInput      = $('#photoInput');
const videoInput      = $('#videoInput');
const mediaPreview    = $('#mediaPreview');
const cardsEl         = $('#cards');
const emptyStateEl    = $('#emptyState');

let preview = null; // {type:'image'|'video', dataUrl:string}

/* Show media preview */
function clearPreview(){
  preview = null;
  mediaPreview.hidden = true;
  mediaPreview.innerHTML = '';
}
async function handleFileChange(kind, file){
  if(!file) return clearPreview();
  preview = { type: kind, dataUrl: await fileToDataURL(file) };
  mediaPreview.hidden = false;
  if(kind==='image'){
    mediaPreview.innerHTML = `<img alt="preview image" src="${preview.dataUrl}" style="max-width:140px;max-height:120px;border-radius:10px;border:1px solid #e8e0d9">`;
  }else{
    mediaPreview.innerHTML = `<video controls src="${preview.dataUrl}" style="max-width:180px;max-height:120px;border-radius:10px;border:1px solid #e8e0d9"></video>`;
  }
}

photoInput?.addEventListener('change', async (e)=>{
  videoInput.value = '';
  await handleFileChange('image', e.target.files?.[0]);
});
videoInput?.addEventListener('change', async (e)=>{
  photoInput.value = '';
  await handleFileChange('video', e.target.files?.[0]);
});

/* Post submit */
$('#composer')?.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text = (composeText.value || '').trim();
  if(!text){ composeText.focus(); return; }

  const category = (composeCategory.value || '').trim() || 'Loose Threads';
  const post = {
    id: uid(),
    user: USER_NAME,
    category,
    text,
    media: preview ? { type: preview.type, dataUrl: preview.dataUrl } : null,
    ts: Date.now()
  };

  const posts = readPosts();
  posts.unshift(post);
  writePosts(posts);

  // reset composer
  composeText.value = '';
  composeCategory.value = '';
  clearPreview();

  renderFeed(); // rerender
  // scroll into view
  $('#feed')?.scrollIntoView({behavior:'smooth'});
});

/* =============== Rendering =============== */

function postCardHTML(p){
  const canEdit = p.user === USER_NAME; // simple rule: you can edit your own posts
  const media = p.media
    ? (p.media.type === 'image'
       ? `<img class="post-img" src="${p.media.dataUrl}" alt="post image" style="width:100%;max-height:560px;object-fit:contain;border-radius:12px;margin:8px 0;border:1px solid #e8e0d9">`
       : `<video class="post-video" controls src="${p.media.dataUrl}" style="width:100%;max-height:560px;border-radius:12px;margin:8px 0;border:1px solid #e8e0d9"></video>`)
    : '';

  const actions = canEdit
    ? `<div class="actions" style="display:flex;gap:12px;margin-top:8px">
         <button class="link-btn" data-action="edit" data-id="${p.id}" style="border:none;background:none;color:#7e6f66;cursor:pointer">Edit</button>
         <button class="link-btn" data-action="delete" data-id="${p.id}" style="border:none;background:none;color:#7e6f66;cursor:pointer">Delete</button>
       </div>`
    : '';

  return `
    <article class="card" data-id="${p.id}"
             style="background:#fff;border:1px solid #e8e0d9;border-radius:16px;padding:18px 20px;box-shadow:0 12px 18px rgba(50,38,31,.07)">
      <div class="meta" style="display:flex;align-items:center;gap:8px;color:#7a6e68;font-size:13px;margin-bottom:6px">
        <div class="avatar" style="width:28px;height:28px;border-radius:50%;border:1px solid #e8e0d9;background:#fff;display:inline-grid;place-items:center;font-weight:700;font-size:12px">
          ${ (p.user||'AA').slice(0,2).toUpperCase() }
        </div>
        <strong>${p.user}</strong> • <span>${nowLabel(p.ts)}</span>
      </div>
      <div class="title" style="margin:4px 0 8px;line-height:1.35">
        <a href="?cat=${encodeURIComponent(p.category)}#feed" class="cat" style="font-weight:800;margin-right:.35rem;text-decoration:none;color:#991b1b">[${p.category}]</a>
      </div>
      ${media}
      <div class="preview" style="color:#5e544d;font-size:14px;margin-bottom:8px;white-space:pre-wrap">${p.text}</div>
      ${actions}
    </article>
  `;
}

function renderFeed(){
  const params = new URLSearchParams(location.search);
  const filterCat = params.get('cat'); // optional
  const all = readPosts();
  const posts = filterCat ? all.filter(p => p.category === filterCat) : all;

  cardsEl.innerHTML = posts.map(postCardHTML).join('');
  emptyStateEl.style.display = posts.length ? 'none' : '';
}

/* Edit / Delete handlers (event delegation) */
cardsEl?.addEventListener('click', (e)=>{
  const btn = e.target.closest('button.link-btn');
  if(!btn) return;
  const id = btn.getAttribute('data-id');
  const action = btn.getAttribute('data-action');
  if(!id) return;

  const posts = readPosts();
  const idx = posts.findIndex(p => p.id === id);
  if(idx === -1) return;

  if(action === 'delete'){
    posts.splice(idx,1);
    writePosts(posts);
    renderFeed();
    return;
  }

  if(action === 'edit'){
    const current = posts[idx];
    const newText = prompt('Edit your post text:', current.text);
    if(newText === null) return;

    // Optional: let user reassign category
    const newCat = prompt('Edit category (leave blank for Loose Threads):', current.category) || 'Loose Threads';

    posts[idx] = { ...current, text: newText.trim(), category: newCat.trim() || 'Loose Threads', ts: Date.now() };
    writePosts(posts);
    renderFeed();
  }
});

/* =============== Category tiles =============== */
$all('.topic').forEach(el=>{
  el.addEventListener('click', (e)=>{
    e.preventDefault();
    const cat = el.getAttribute('data-cat') || '';
    // Set composer select, filter feed, and scroll
    if(composeCategory) composeCategory.value = cat;
    const url = new URL(location.href);
    if(cat) url.searchParams.set('cat', cat);
    else url.searchParams.delete('cat');
    url.hash = 'feed';
    history.replaceState({}, '', url.toString());
    renderFeed();
    $('#feed')?.scrollIntoView({behavior:'smooth'});
  });
});

/* =============== Initial load =============== */
(function init(){
  // Support direct links like ?cat=Tailoring#feed
  const params = new URLSearchParams(location.search);
  const cat = params.get('cat');
  if(cat && composeCategory){
    composeCategory.value = cat;
  }

  // First-time demo: if no posts, keep empty state. (No seeding.)
  renderFeed();
})();
