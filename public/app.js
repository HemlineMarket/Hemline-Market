// Hemline Market — global error/toast helpers
(function () {
  // ------- Toast UI -------
  let toastBox;
  function ensureToastUI() {
    if (toastBox) return;
    toastBox = document.createElement('div');
    toastBox.id = 'hm-toast';
    toastBox.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
      'max-width:90vw;padding:12px 16px;border:1px solid #e5e7eb;border-radius:12px;' +
      'background:#111827;color:#fff;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s';
    document.body.appendChild(toastBox);
  }
  function toast(message, ms=3800) {
    ensureToastUI();
    toastBox.textContent = message;
    toastBox.style.opacity = '1';
    clearTimeout(toastBox._t);
    toastBox._t = setTimeout(() => (toastBox.style.opacity = '0'), ms);
  }

  // ------- Error normalization -------
  function normalizeSupabaseError(err) {
    try {
      if (!err) return 'Something went wrong.';
      if (typeof err === 'string') return err;

      const m = (err.message || err.error || '').toLowerCase();
      if (m.includes('too many') || m.includes('rate')) {
        return 'Slow down a sec—too many attempts. Try again in a moment.';
      }
      if (m.includes('row level security') || m.includes('rls')) {
        return 'You don’t have permission for that action.';
      }
      if (m.includes('not null') || m.includes('missing')) {
        return 'Required info is missing—please complete the fields.';
      }
      if (m.includes('unique') || m.includes('duplicate')) {
        return 'Looks like that was already submitted.';
      }
      if (m.includes('invalid') || m.includes('bad input')) {
        return 'Please check the values—something looks invalid.';
      }
      return err.message || err.hint || 'Request failed.';
    } catch (_) {
      return 'Request failed.';
    }
  }

  // ------- Guards for Supabase calls -------
  function guard(result, friendly) {
    if (!result) {
      toast(friendly || 'Request failed.');
      throw new Error('No result');
    }
    const { error } = result;
    if (error) {
      const msg = friendly || normalizeSupabaseError(error);
      toast(msg);
      throw error;
    }
    return result.data ?? result;
  }

  async function fetchWithRetry(url, opts={}, retries=2) {
    for (let i = 0; i <= retries; i++) {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      if (![429,500,502,503,504].includes(res.status) || i === retries) return res;
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }

  // expose
  window.hm = { toast, guard, normalizeSupabaseError, fetchWithRetry };
})();
