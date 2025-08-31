/* public/js/auth-guard.js
   Intercepts clicks to seller pages and routes unauthenticated users to account.html.
   Works even if the page didn't include env.js or supabase yet (loads them on demand).
*/
(function(){
  // Which links should require auth?
  // 1) Any link with data-require-auth="true"
  // 2) Any link whose href ends with "seller/index.html"
  const SELECTOR = 'a[data-require-auth="true"], a[href$="seller/index.html"]';

  // Utility: inject a script tag and wait for load
  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s=document.createElement('script');
      s.src=src; s.async=true;
      s.onload=()=>resolve();
      s.onerror=()=>reject(new Error('Failed to load '+src));
      document.head.appendChild(s);
    });
  }

  // Ensure env + supabase client exist
  async function ensureSupabase(){
    // Load env.js if window.__env not present
    if(typeof window.__env === 'undefined'){
      await loadScript('env.js'); // expects public/env.js at site root (public/)
    }
    // Load supabase-js if missing
    if(typeof window.supabase === 'undefined'){
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    }
    // Create (or reuse) client
    if(!window._sbClient){
      const { SUPABASE_URL, SUPABASE_ANON_KEY } = (window.__env || {});
      if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
        console.error('Auth guard: missing SUPABASE_URL or SUPABASE_ANON_KEY. Check public/env.js');
        return null;
      }
      window._sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return window._sbClient;
  }

  // Read current session quickly (cached if already fetched)
  let _sessionCache = null;
  async function getSession(sb){
    if(_sessionCache) return _sessionCache;
    const { data: { session } } = await sb.auth.getSession();
    _sessionCache = session || null;
    return _sessionCache;
  }

  // Resolve target href from clicked link
  function getHref(a){
    try{
      return new URL(a.getAttribute('href'), window.location.href).toString();
    }catch(_e){
      return a.getAttribute('href') || '';
    }
  }

  // Intercept clicks
  async function onClick(e){
    const a = e.target.closest('a');
    if(!a) return;
    if(!a.matches(SELECTOR)) return;

    // Allow modified clicks (new tab, etc.)
    if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

    e.preventDefault();

    const sb = await ensureSupabase();
    if(!sb){
      // Fallback: send to account page
      window.location.href = 'account.html';
      return;
    }

    const session = await getSession(sb);
    const href = getHref(a);

    if(session && session.user){
      // Signed in → go through
      window.location.href = href;
    }else{
      // Not signed in → send to account with ?next=
      const url = new URL('account.html', window.location.origin);
      url.searchParams.set('next', href);
      window.location.href = url.toString();
    }
  }

  // Attach once DOM is ready
  function ready(fn){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function(){
    // Delegate on document for any matching links
    document.addEventListener('click', onClick, { capture: true });
  });
})();
