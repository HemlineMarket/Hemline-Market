(function(){
  /* ===== Hamburger ===== */
  var sheet=document.getElementById('menuSheet');
  var overlay=document.getElementById('sheetOverlay');
  var openBtn=document.getElementById('openMenu');
  var closeBtn=document.getElementById('closeMenu');

  function openSheet(){ if(!sheet||!overlay) return;
    sheet.classList.add('open'); sheet.setAttribute('aria-hidden','false');
    overlay.classList.add('show'); document.body.style.overflow='hidden';
    setTimeout(function(){ if(closeBtn) closeBtn.focus(); },50);
  }
  function closeSheet(){ if(!sheet||!overlay) return;
    sheet.classList.remove('open'); sheet.setAttribute('aria-hidden','true');
    overlay.classList.remove('show'); document.body.style.overflow='';
    if(openBtn) openBtn.focus();
  }
  if(openBtn) openBtn.addEventListener('click', function(e){ e.preventDefault(); openSheet(); });
  if(closeBtn) closeBtn.addEventListener('click', function(e){ e.preventDefault(); closeSheet(); });
  if(overlay) overlay.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeSheet(); });

  /* ===== Optional avatar + default display name ===== */
  try{
    var avatar=document.getElementById('avatar');
    var url=localStorage.getItem('avatarUrl');
    if(avatar && url){ avatar.textContent=''; avatar.style.backgroundImage="url('"+url+"')"; }
    if(!localStorage.getItem('tt_user')){ localStorage.setItem('tt_user','Afroza'); }
  }catch(e){}

  /* ===== Elements ===== */
  var cardsEl = document.getElementById('cards');
  var emptyState = document.getElementById('emptyState');
  var form = document.getElementById('composer');
  var sel = document.getElementById('composeCategory');
  var txt = document.getElementById('composeText');
  var photoInput = document.getElementById('photoInput');
  var videoInput = document.getElementById('videoInput');
  var previewWrap = document.getElementById('mediaPreview');
  var postBtn = document.getElementById('postBtn');
  var toast = document.getElementById('toast');

  /* ===== Helpers ===== */
  function nowLabel(){ return 'just now'; }
  function initials(name){ return (name||'AA').slice(0,2).toUpperCase(); }
  function showToast(msg){ if(!toast) return; toast.textContent=msg; toast.classList.add('show'); setTimeout(function(){ toast.classList.remove('show'); }, 1400); }

  function categoryFile(cat){
    var k=(cat||'').toLowerCase();
    if(k==='showcase') return 'showcase.html';
    if(k==='tailoring') return 'tailoring.html';
    if(k==='stitch school') return 'stitch-school.html';
    if(k==='fabric sos') return 'fabric-sos.html';
    if(k==='before & after' || k==='before and after' || k==='before-after') return 'before-after.html';
    if(k==='pattern hacks') return 'pattern-hacks.html';
    if(k==='stash confessions') return 'stash-confessions.html';
    return 'loose-threads.html';
  }

  function renderCard(post, toTop){
    var el = document.createElement('article');
    el.className='card';
    var mediaHTML = '';
    if(post.media && post.media.type==='image'){
      mediaHTML = '<img class="post-img" src="'+post.media.url+'" alt="post image"/>';
    }else if(post.media && post.media.type==='video'){
      mediaHTML = '<video class="post-video" controls src="'+post.media.url+'"></video>';
    }
    el.innerHTML =
      '<div class="meta"><div class="avatar">'+initials(post.user)+'</div><span>'+ (post.user||'You') +'</span> • <span>'+nowLabel()+'</span></div>'+
      '<div class="title"><a class="cat" href="'+categoryFile(post.category)+'">['+post.category+']</a></div>'+
      mediaHTML+
      '<div class="preview">'+post.text+'</div>'+
      '<div class="actions"><span>❤ '+(Math.floor(Math.random()*8)+3)+'</span><span>💬 '+(Math.floor(Math.random()*4)+1)+'</span></div>';
    if(toTop && cardsEl.firstChild){ cardsEl.insertBefore(el, cardsEl.firstChild); }
    else cardsEl.appendChild(el);
  }

  function savePost(post){
    try{
      var arr = JSON.parse(localStorage.getItem('tt_posts')||'[]');
      arr.unshift(post);
      localStorage.setItem('tt_posts', JSON.stringify(arr));
    }catch(e){}
  }

  function loadPosts(){
    try{
      var arr = JSON.parse(localStorage.getItem('tt_posts')||'[]');
      if(arr.length){
        emptyState.style.display='none';
        arr.forEach(function(p){ renderCard(p,false); });
      }
    }catch(e){}
  }

  function clearComposer(){
    sel.value='';
    txt.value='';
    photoInput.value='';
    videoInput.value='';
    previewWrap.innerHTML='';
    previewWrap.hidden=true;
    txt.focus();
  }

  function showPreview(file, kind){
    if(!file) return;
    var url = URL.createObjectURL(file);
    previewWrap.hidden=false;
    previewWrap.innerHTML = (kind==='image')
      ? '<img alt="preview image" src="'+url+'"/>'
      : '<video controls src="'+url+'"></video>';
  }

  photoInput && photoInput.addEventListener('change', function(){
    if(this.files && this.files[0]){ videoInput.value=''; showPreview(this.files[0],'image'); }
  });
  videoInput && videoInput.addEventListener('change', function(){
    if(this.files && this.files[0]){ photoInput.value=''; showPreview(this.files[0],'video'); }
  });

  function submitPost(e){
    if(e) e.preventDefault();
    var category = sel && sel.value && sel.value.trim() ? sel.value.trim() : 'Loose Threads';
    var text = (txt && txt.value || '').trim();
    if(!text){ if(txt) txt.focus(); return; }

    var media = null;
    if(photoInput && photoInput.files && photoInput.files[0]){
      media = {type:'image', url: URL.createObjectURL(photoInput.files[0])};
    }else if(videoInput && videoInput.files && videoInput.files[0]){
      media = {type:'video', url: URL.createObjectURL(videoInput.files[0])};
    }

    var user = localStorage.getItem('tt_user') || 'You';
    var post = { category, text, media, user, ts: Date.now() };

    emptyState && (emptyState.style.display='none');
    renderCard(post,true);
    savePost(post);
    clearComposer();
    showToast('Posted to Latest Threads');
    var feedEl = document.getElementById('feed');
    if(feedEl && feedEl.scrollIntoView){ feedEl.scrollIntoView({behavior:'smooth'}); }
  }

  /* Bind BOTH submit and click for robustness */
  form && form.addEventListener('submit', submitPost);
  postBtn && postBtn.addEventListener('click', submitPost);

  /* Load any existing */
  loadPosts();
})();
