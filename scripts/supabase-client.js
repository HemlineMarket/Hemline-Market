<!-- scripts/supabase-client.js -->
<script>
(function(){
  // Dynamically load Supabase v2 if it isn't already present
  async function ensureSupabase(){
    if (window.supabase && window.supabase.createClient) return;
    await new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/@supabase/supabase-js@2.46.1';
      s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }

  const SUPABASE_URL = 'https://clkizksbvxjkoatdajgd.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI';

  let client = null;

  async function getClient(){
    if (client) return client;
    await ensureSupabase();
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    return client;
  }

  // Simple “ping” you can call from console if needed: HM_SUPA.ping()
  async function ping(){
    const c = await getClient();
    // Public, no-auth read of a small table (adjust if your table is named differently)
    const { data, error } = await c.from('listings').select('id').limit(1);
    return { ok: !error, error, sample: data };
  }

  // Upload a file to a bucket path like 'listings/{listingId}/{filename}'
  async function uploadFile(file, path, bucket='media'){
    const c = await getClient();
    const { data, error } = await c.storage.from(bucket).upload(path, file, { upsert: false });
    if (error) throw error;
    const { data: pub } = c.storage.from(bucket).getPublicUrl(path);
    return { path: data.path, publicUrl: pub.publicUrl };
  }

  // Create a listing record (returns the inserted row)
  async function insertListing(payload){
    const c = await getClient();
    // expected payload: { title, price, yards, ... , cover_url, photo_urls[], video_url? }
    const { data, error } = await c.from('listings').insert(payload).select('*').single();
    if (error) throw error;
    return data;
  }

  // List active listings for browse (adjust column names as needed)
  async function listActiveListings({ limit=24, offset=0 }={}){
    const c = await getClient();
    const q = c.from('listings')
      .select('id,title,price,width,gsm,cover_url,slug', { count: 'exact' })
      .eq('status','active')
      .order('created_at', { ascending:false })
      .range(offset, offset+limit-1);
    const { data, count, error } = await q;
    if (error) throw error;
    return { rows: data||[], count: count||0 };
  }

  // Expose helpers globally without touching existing pages yet
  window.HM_SUPA = {
    getClient,
    ping,
    uploadFile,
    insertListing,
    listActiveListings
  };
})();
</script>
