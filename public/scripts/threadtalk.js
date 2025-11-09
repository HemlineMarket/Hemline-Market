/* ThreadTalk front-end logic (localStorage prototype)
   - Works with public/ThreadTalk.html as-is
   - No layout/style changes — DOM IDs/classes match your page
*/
(function(){
  // --- DOM lookups (null-safe) ---
  var form         = document.getElementById('composer');
  var sel          = document.getElementById('composeCategory');
  var txt          = document.getElementById('composeText');
  var photoInput   = document.getElementById('photoInput');
  var videoInput   = document.getElementById('videoInput');
  var previewWrap  = document.getElementById('mediaPreview');
  var postBtn      = document.getElementById('postBtn');
  var cardsEl      = document.getElementById('cards');
  var emptyState   = document.getElementById('emptyState');
  var toast        = document.getElementById('toast');

  // If the page didn’t render these yet, bail gracefully
  if(!form || !txt || !cardsEl){ 
    console.warn('[ThreadTalk] Required elements not found — script loaded before DOM?');
    return;
  }

  // --- Small utilities ---
  function nowLabel(){ return 'just now'; }
  function initials(name){ return (name||'AA').slice(0,2).toUpperCase(); }
  function showToast(msg){
    if(!toast) return;
    toast.textContent = msg || 'Posted';
    toast.classList.add('show');
    setTimeout(function(){ toast.classList.remove('show'); }, 1400);
  }
  function getAccountName(){
    try{
      return localStorage.getItem('hm_name')
          || localStorage.getItem('accountName')
          || localStorage.getItem('displayName')
          || localStorage.getItem('tt_user')
          || 'Afroza';
    }catch(e){ return 'Afroza'; }
  }
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

  // --- Storage helpers ---
  function loadPosts(){ try{ return JSON.parse(localStorage.getItem('tt_posts')||'[]'); }catch(e){ return []; } }
  function savePosts(arr){ try{ localStorage.setItem('tt_posts', JSON.stringify(arr)); }catch(e){} }
  function loadComments(){ try{ return JSON.parse(localStorage.getItem('tt_comments')||'{}'); }catch(e){ return {}; } }
  function saveComments(map){ try{ localStorage.setItem('tt_comments', JSON.stringify(map)); }catch(e){} }

  // --- Comments UI ---
  function renderComments(container, postId){
    var cm = loadComments();
    var list = cm[postId] || [];
    container.innerHTML = '';
    list.forEach(function(c, idx){
      var me = getAccountName();
      var canEdit = me && me === c.user;
      var wrap = document.createElement('div');
      wrap.className = 'comment';
      wrap.innerHTML =
        '<div class="c-meta"><strong>'+c.user+'</strong> • <span>'+nowLabel()+'</span></div>'+
        '<div class="c-text" data-idx="'+idx+'">'+c.text+'</div>'+
        '<div class="c-actions">'+
          (canEdit ? '<button type="button" class="btn secondary c-edit" data-idx="'+idx+'">Edit</button>' : '')+
          (canEdit ? '<button type="button" class="btn secondary c-del" data-idx="'+idx+'">Delete</button>' : '')+
        '</div>';
      container.appendChild(wrap);
    });

    // Bind edit/delete
    container.querySelectorAll('.c-edit').forEach(function(btn){
      btn.addEventListener('click', function(){
        var i = Number(this.getAttribute('data-idx'));
        var map = loadComments(); var arr = map[postId] || [];
        var cur = arr[i]; if(!cur) return;
        var nv = prompt('Edit comment:', cur.text);
        if(nv!=null){
          arr[i].text = nv.trim();
          map[postId] = arr;
          saveComments(map);
          renderComments(container, postId);
        }
      });
    });
    container.querySelectorAll('.c-del').forEach(function(btn){
      btn.addEventListener('click', function(){
        var i = Number(this.getAttribute('data-idx'));
        var map = loadComments(); var arr = map[postId] || [];
        arr.splice(i,1);
        map[postId] = arr;
        saveComments(map);
        renderComments(container, postId);
      });
    });
  }

  // --- Post card UI ---
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
      '<div class="actions"><span>👍</span><span>❤️</span><span>😮</span></div>'+
      '<div class="comments" id="cwrap-'+post.ts+'">'+
        '<div class="c-list" id="clist-'+post.ts+'"></div>'+
        '<form class="comment-form" id="cform-'+post.ts+'">'+
          '<textarea placeholder="Add a comment…" aria-label="Add a comment" required></textarea>'+
          '<button class="btn" type="submit">Comment</button>'+
        '</form>'+
      '</div>';

    if(toTop && cardsEl.firstChild){ cardsEl.insertBefore(el, cardsEl.firstChild); }
    else cardsEl.appendChild(el);

    // Hook up comments for this card
    var cList = document.getElementById('clist-'+post.ts);
    renderComments(cList, String(post.ts));
    var cForm = document.getElementById('cform-'+post.ts);
    cForm.addEventListener('submit', function(ev){
      ev.preventDefault();
      var me = getAccountName();
      var ta = cForm.querySelector('textarea');
      var val = (ta.value||'').trim(); if(!val) return;
      var map = loadComments(); var arr = map[String(post.ts)] || [];
      arr.push({user:me, text:val, ts:Date.now()});
      map[String(post.ts)] = arr; saveComments(map);
      ta.value=''; renderComments(cList, String(post.ts));
    });
  }

  function renderAll(){
    cardsEl.innerHTML = '';
    var arr = loadPosts();
    if(arr.length){ emptyState && (emptyState.style.display='none'); }
    arr.forEach(function(p){ renderCard(p,false); });
  }

  // --- Media preview controls ---
  function showPreview(file, kind){
    if(!file || !previewWrap) return;
    var url = URL.createObjectURL(file);
    previewWrap.hidden = false;
    previewWrap.innerHTML = (kind==='image')
      ? '<img alt="preview image" src="'+url+'"/>'
      : '<video controls src="'+url+'"></video>';
  }
  if(photoInput){
    photoInput.addEventListener('change', function(){
      if(this.files && this.files[0]){ if(videoInput) videoInput.value=''; showPreview(this.files[0],'image'); }
    });
  }
  if(videoInput){
    videoInput.addEventListener('change', function(){
      if(this.files && this.files[0]){ if(photoInput) photoInput.value=''; showPreview(this.files[0],'video'); }
    });
  }

  // --- Submit handler (POST) ---
  function submitPost(e){
    if(e) e.preventDefault();

    var category = (sel && sel.value && sel.value.trim()) ? sel.value.trim() : 'Loose Threads';
    var text = (txt.value||'').trim();

    if(!text){
      txt.focus();
      return;
    }

    var media = null;
    if(photoInput && photoInput.files && photoInput.files[0]){
      media = {type:'image', url: URL.createObjectURL(photoInput.files[0])};
    }else if(videoInput && videoInput.files && videoInput.files[0]){
      media = {type:'video', url: URL.createObjectURL(videoInput.files[0])};
    }

    var user = getAccountName();
    var post = { category:category, text:text, media:media, user:user, ts: Date.now() };

    var arr = loadPosts();
    arr.unshift(post);
    savePosts(arr);

    if(emptyState) emptyState.style.display='none';
    renderCard(post,true);

    // Reset composer
    if(sel) sel.value='';
    txt.value='';
    if(photoInput) photoInput.value='';
    if(videoInput) videoInput.value='';
    if(previewWrap){ previewWrap.innerHTML=''; previewWrap.hidden=true; }
    txt.focus();

    showToast('Posted to Latest Threads');
    var feed = document.getElementById('feed');
    if(feed){ feed.scrollIntoView({behavior:'smooth'}); }
  }

  // Bind both submit and explicit click (some browsers intercept)
  form.addEventListener('submit', submitPost);
  if(postBtn){ postBtn.addEventListener('click', submitPost); }

  // Initial render
  renderAll();

  console.log('[ThreadTalk] script ready');
})();
