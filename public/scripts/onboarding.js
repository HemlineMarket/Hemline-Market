// scripts/onboarding.js
// Shows a welcome modal for first-time users to set display name and accept Terms.
// Fires once per user via localStorage flag. Checks for existing profile data.

(function() {
  'use strict';

  const ONBOARD_KEY_PREFIX = 'hm-onboarded-';

  async function init() {
    // Wait for HM shell and supabase
    let retries = 0;
    while ((!window.HM || !window.HM.supabase) && retries < 30) {
      await new Promise(r => setTimeout(r, 200));
      retries++;
    }
    const sb = window.HM?.supabase;
    if (!sb) return;

    // Get current session
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user) return;

    const userId = session.user.id;

    // Already onboarded? Skip.
    if (localStorage.getItem(ONBOARD_KEY_PREFIX + userId)) return;

    // Check if profile already has a real display_name (not auto-generated)
    try {
      const { data: profile } = await sb
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .single();

      // If they have a display_name that doesn't look auto-generated, mark as onboarded
      if (profile && profile.display_name) {
        const email = session.user.email || '';
        const emailPrefix = email.split('@')[0] || '';
        // If display_name is different from email prefix, they've already set it
        if (profile.display_name !== emailPrefix && profile.display_name !== 'Hemline sewist') {
          localStorage.setItem(ONBOARD_KEY_PREFIX + userId, '1');
          return;
        }
      }
    } catch (e) {
      // Profile might not exist yet for brand new users, that's fine
    }

    // Show onboarding modal
    showOnboardingModal(sb, session.user);
  }

  function showOnboardingModal(sb, user) {
    // Pre-fill name from Google/Apple metadata if available
    const meta = user.user_metadata || {};
    const suggestedName = meta.full_name || meta.name || '';

    const overlay = document.createElement('div');
    overlay.id = 'hm-onboard-overlay';
    overlay.innerHTML = `
      <div class="hm-onboard-backdrop"></div>
      <div class="hm-onboard-modal" role="dialog" aria-modal="true" aria-label="Welcome to Hemline Market">
        <div class="hm-onboard-header">Welcome to Hemline Market</div>
        <div class="hm-onboard-sub">One quick step before you dive in.</div>

        <label class="hm-onboard-label">Display name</label>
        <input type="text" id="hm-onboard-name" class="hm-onboard-input" value="${escAttr(suggestedName)}" placeholder="How other sewists will see you" maxlength="50" autocomplete="name">

        <label class="hm-onboard-check">
          <input type="checkbox" id="hm-onboard-terms">
          <span>I agree to the <a href="/terms.html" target="_blank">Terms of Service</a> and <a href="/privacy.html" target="_blank">Privacy Policy</a></span>
        </label>

        <label class="hm-onboard-check">
          <input type="checkbox" id="hm-onboard-newsletter" checked>
          <span>Send me occasional updates and fabric finds</span>
        </label>

        <button type="button" id="hm-onboard-btn" class="hm-onboard-btn" disabled>Get Started</button>
        <div id="hm-onboard-error" class="hm-onboard-error"></div>
      </div>
    `;

    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
      #hm-onboard-overlay{position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;display:flex;align-items:center;justify-content:center}
      .hm-onboard-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(4px)}
      .hm-onboard-modal{position:relative;background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:calc(100% - 32px);box-shadow:0 20px 60px rgba(0,0,0,.2);animation:hm-onboard-in .25s ease-out}
      @keyframes hm-onboard-in{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      .hm-onboard-header{font-family:'Playfair Display',Georgia,serif;font-size:22px;font-weight:700;color:#991b1b;text-align:center;margin-bottom:4px}
      .hm-onboard-sub{font-size:14px;color:#6b7280;text-align:center;margin-bottom:20px}
      .hm-onboard-label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:6px}
      .hm-onboard-input{width:100%;box-sizing:border-box;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
      .hm-onboard-input:focus{border-color:#991b1b}
      .hm-onboard-check{display:flex;align-items:flex-start;gap:10px;margin-top:14px;font-size:13px;color:#374151;cursor:pointer;line-height:1.4}
      .hm-onboard-check input[type="checkbox"]{margin-top:2px;width:16px;height:16px;accent-color:#991b1b;flex-shrink:0;cursor:pointer}
      .hm-onboard-check a{color:#991b1b;text-decoration:none;font-weight:600}
      .hm-onboard-check a:hover{text-decoration:underline}
      .hm-onboard-btn{width:100%;margin-top:20px;padding:13px;background:linear-gradient(135deg,#991b1b,#7f1d1d);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s}
      .hm-onboard-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 16px rgba(153,27,27,.3)}
      .hm-onboard-btn:disabled{opacity:.5;cursor:not-allowed}
      .hm-onboard-error{text-align:center;font-size:13px;color:#dc2626;margin-top:8px;min-height:18px}
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // Elements
    const nameInput = document.getElementById('hm-onboard-name');
    const termsCheck = document.getElementById('hm-onboard-terms');
    const newsletterCheck = document.getElementById('hm-onboard-newsletter');
    const btn = document.getElementById('hm-onboard-btn');
    const errorEl = document.getElementById('hm-onboard-error');

    // Validation
    function validate() {
      const nameOk = nameInput.value.trim().length >= 2;
      const termsOk = termsCheck.checked;
      btn.disabled = !(nameOk && termsOk);
    }
    nameInput.addEventListener('input', validate);
    termsCheck.addEventListener('change', validate);
    validate();

    // Submit
    btn.addEventListener('click', async () => {
      const displayName = nameInput.value.trim();
      if (displayName.length < 2) { errorEl.textContent = 'Name must be at least 2 characters.'; return; }
      if (!termsCheck.checked) { errorEl.textContent = 'Please agree to the Terms and Privacy Policy.'; return; }

      btn.disabled = true;
      btn.textContent = 'Setting up...';
      errorEl.textContent = '';

      try {
        // Update the profiles table
        const { error: profileError } = await sb
          .from('profiles')
          .upsert({
            id: user.id,
            display_name: displayName,
            newsletter_opt_in: newsletterCheck.checked
          }, { onConflict: 'id' });

        if (profileError) {
          console.error('Profile update error:', profileError);
          // Try updating user_metadata as fallback
          await sb.auth.updateUser({
            data: { display_name: displayName, newsletter_opt_in: newsletterCheck.checked }
          });
        }

        // Mark onboarded
        localStorage.setItem(ONBOARD_KEY_PREFIX + user.id, '1');

        // Close modal
        overlay.remove();
        style.remove();

        // Refresh the header avatar/name
        if (window.HM?.supabase) {
          // Trigger a session refresh to update the header
          const { data: { session } } = await sb.auth.getSession();
          if (session) {
            // The shell's onAuthStateChange should pick this up
            // But let's also manually refresh if possible
            window.location.reload();
          }
        }

      } catch (err) {
        console.error('Onboarding error:', err);
        errorEl.textContent = 'Something went wrong. Please try again.';
        btn.disabled = false;
        btn.textContent = 'Get Started';
      }
    });

    // Focus the name input
    setTimeout(() => nameInput.focus(), 300);
  }

  function escAttr(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
