// public/scripts/account-auth.js
// Session-aware account page, shared profile for Account + Atelier

import { supabase } from './supabase-client.js';

// --- DOM helpers -----------------------------------------------------------

const $ = (id) => document.getElementById(id);

// Header bits
const headerAvatar   = $('headerAvatar');
const loginHeaderBtn = $('loginHeaderBtn');

// Page sections
const accountLoggedOut = $('accountLoggedOut');
const accountGrid      = $('accountGrid');

// Profile summary (top card)
const profileAvatarEl    = $('profileAvatar');
const profileNameEl      = $('profileName');
const profileEmailEl     = $('profileEmail');
const profileLocationEl  = $('profileLocationSummary');
const profileBioEl       = $('profileBioSummary');
const profileWebsiteWrap = $('profileWebsiteWrapper');
const profileWebsiteEl   = $('profileWebsite');

// Profile form + buttons
const profileForm        = $('profileForm');
const editProfileBtn     = $('editProfileBtn');
const avatarChangeBtn    = $('avatarChangeBtn');
const logoutBtn          = $('logoutBtn');
const avatarInput        = $('avatarInput');
const saveProfileBtn     = $('saveProfileBtn');
const cancelProfileEdit  = $('cancelProfileEditBtn');

// Profile form fields
const firstNameInput = $('firstNameInput');
const lastNameInput  = $('lastNameInput');
const locationInput  = $('locationInput');
const websiteInput   = $('websiteInput');
const instagramInput = $('instagramInput');
const tiktokInput    = $('tiktokInput');
const bioInput       = $('bioInput');
const shopNameInput  = $('shopNameInput');

// Shipping fields
const shipFromName    = $('shipFromName');
const shipFromStreet  = $('shipFromStreet');
const shipFromStreet2 = $('shipFromStreet2');
const shipFromCity    = $('shipFromCity');
const shipFromState   = $('shipFromState');
const shipFromZip     = $('shipFromZip');
const shipFromCountry = $('shipFromCountry');
const saveShippingBtn = $('saveShippingSettingsBtn');

// Vacation switch
const vacSwitch = $('vacSwitch');

// Simple inline status area (we’ll piggyback on authMessage if it exists)
const authMessage = $('authMessage');
const authError   = $('authError');

// --- State -----------------------------------------------------------------

let currentUser = null;
let profileRow  = null;

// --- Utility functions -----------------------------------------------------

function initialsFrom(source) {
  if (!source) return 'HM';
  const parts = source
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    // Fallback from email
    const at = source.indexOf('@');
    const base = at > 0 ? source.slice(0, at) : source;
    return base.slice(0, 2).toUpperCase();
  }

  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// “Handle” used for public links — no dashes, just squashed letters/numbers
function buildHandle({ shopName, fullName, email }) {
  const source =
    (shopName && shopName.trim()) ||
    (fullName && fullName.trim()) ||
    (email && email.split('@')[0]) ||
    '';

  return source
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // remove everything that isn’t a–z or 0–9
    .slice(0, 40);             // keep it reasonably short
}

// Small helpers to show inline status
function setStatus(msg) {
  if (authMessage) authMessage.textContent = msg || '';
}
function setError(msg) {
  if (authError) authError.textContent = msg || '';
}

// --- UI wiring -------------------------------------------------------------

function showLoggedOut() {
  if (accountLoggedOut) accountLoggedOut.style.display = 'block';
  if (accountGrid)      accountGrid.style.display      = 'none';

  if (headerAvatar) {
    headerAvatar.style.display = 'none';
    headerAvatar.textContent   = '';
  }
  if (loginHeaderBtn) loginHeaderBtn.style.display = 'inline-flex';

  if (logoutBtn) logoutBtn.style.display = 'none';
}

function showLoggedIn() {
  if (accountLoggedOut) accountLoggedOut.style.display = 'none';
  if (accountGrid)      accountGrid.style.display      = 'grid';

  if (loginHeaderBtn) loginHeaderBtn.style.display = 'none';
  if (logoutBtn)      logoutBtn.style.display      = 'inline-flex';
}

// Fill the inline edit form from profileRow
function hydrateProfileForm() {
  const p = profileRow || {};

  if (firstNameInput) firstNameInput.value = p.first_name || '';
  if (lastNameInput)  lastNameInput.value  = p.last_name  || '';
  if (locationInput)  locationInput.value  = p.location   || '';
  if (websiteInput)   websiteInput.value   = p.website    || '';
  if (instagramInput) instagramInput.value = p.instagram  || '';
  if (tiktokInput)    tiktokInput.value    = p.tiktok     || '';
  if (bioInput)       bioInput.value       = p.bio || p.shop_story || '';
  if (shopNameInput)  shopNameInput.value  = p.shop_name  || '';

  // Shipping (stored on profile for now)
  if (shipFromName)    shipFromName.value    = p.ship_from_name    || '';
  if (shipFromStreet)  shipFromStreet.value  = p.ship_from_street  || '';
  if (shipFromStreet2) shipFromStreet2.value = p.ship_from_street2 || '';
  if (shipFromCity)    shipFromCity.value    = p.ship_from_city    || '';
  if (shipFromState)   shipFromState.value   = p.ship_from_state   || '';
  if (shipFromZip)     shipFromZip.value     = p.ship_from_zip     || '';
  if (shipFromCountry) shipFromCountry.value = p.ship_from_country || 'US';

  // Vacation
  if (vacSwitch) {
    const isOn = !!p.vacation_mode;
    vacSwitch.dataset.on = isOn ? 'true' : 'false';
  }
}

// Update the *summary* card + header from profileRow/currentUser
function renderProfileSummary() {
  if (!currentUser) return;

  const p = profileRow || {};
  const fullName =
    (p.first_name || p.last_name)
      ? [p.first_name, p.last_name].filter(Boolean).join(' ')
      : null;

  const displayName =
    p.shop_name ||
    fullName ||
    (currentUser.email && currentUser.email.split('@')[0]) ||
    'Hemline Market member';

  const locationText = p.location || 'Location coming soon';
  const bioText =
    p.bio ||
    p.shop_story ||
    "Add a short note about your sourcing, favorite textiles, or sewing style.";

  // Avatar: prefer stored avatar_url, otherwise initials
  const avatarInitials = initialsFrom(p.shop_name || fullName || currentUser.email);

  if (profileAvatarEl) {
    profileAvatarEl.style.backgroundImage = '';
    profileAvatarEl.textContent = avatarInitials;
    if (p.avatar_url) {
      profileAvatarEl.textContent = '';
      profileAvatarEl.style.backgroundImage = `url('${p.avatar_url}')`;
      profileAvatarEl.style.backgroundSize = 'cover';
      profileAvatarEl.style.backgroundPosition = 'center';
    }
  }

  if (profileNameEl)     profileNameEl.textContent     = displayName;
  if (profileEmailEl)    profileEmailEl.textContent    = currentUser.email || '';
  if (profileLocationEl) profileLocationEl.textContent = locationText;
  if (profileBioEl)      profileBioEl.textContent      = bioText;

  if (profileWebsiteWrap && profileWebsiteEl) {
    if (p.website) {
      profileWebsiteWrap.style.display = 'block';
      profileWebsiteEl.textContent = p.website.replace(/^https?:\/\//, '');
      profileWebsiteEl.href        = p.website;
    } else {
      profileWebsiteWrap.style.display = 'none';
      profileWebsiteEl.textContent     = '';
      profileWebsiteEl.removeAttribute('href');
    }
  }

  // Header avatar
  if (headerAvatar) {
    headerAvatar.style.display = 'inline-grid';
    headerAvatar.textContent   = avatarInitials;
  }
}

// --- Supabase profile I/O --------------------------------------------------

async function loadProfile() {
  if (!currentUser) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (error) {
    console.error('loadProfile error', error);
    setError('Trouble loading your profile. Try refreshing.');
    profileRow = null;
  } else {
    profileRow = data || {};
  }

  hydrateProfileForm();
  renderProfileSummary();
}

// Save profile fields (name, shop name, links, bio, location, avatar url)
async function saveProfile() {
  if (!currentUser) return;

  const firstName = firstNameInput?.value.trim() || '';
  const lastName  = lastNameInput?.value.trim()  || '';
  const location  = locationInput?.value.trim()  || '';
  const website   = websiteInput?.value.trim()   || '';
  const instagram = instagramInput?.value.trim() || '';
  const tiktok    = tiktokInput?.value.trim()    || '';
  const bio       = bioInput?.value.trim()       || '';
  const shopName  = shopNameInput?.value.trim()  || '';

  const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

  const handle = buildHandle({
    shopName,
    fullName,
    email: currentUser.email
  });

  const payload = {
    id: currentUser.id,
    email: currentUser.email,
    first_name: firstName || null,
    last_name:  lastName  || null,
    full_name:  fullName,
    location:   location  || null,
    website:    website   || null,
    instagram:  instagram || null,
    tiktok:     tiktok    || null,
    bio:        bio       || null,
    shop_name:  shopName  || null,
    handle:     handle    || null
  };

  setStatus('Saving profile…');
  setError('');

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('saveProfile error', error);
    setError(error.message || 'Could not save profile.');
    setStatus('');
    return;
  }

  profileRow = data;
  hydrateProfileForm();
  renderProfileSummary();

  if (profileForm) profileForm.style.display = 'none';
  setStatus('Profile saved.');
  setTimeout(() => setStatus(''), 1500);
}

// Save shipping address into the same profiles row for now
async function saveShipping() {
  if (!currentUser) return;

  const p = profileRow || {};

  const payload = {
    id: currentUser.id,
    ship_from_name:    (shipFromName?.value || '').trim()    || null,
    ship_from_street:  (shipFromStreet?.value || '').trim()  || null,
    ship_from_street2: (shipFromStreet2?.value || '').trim() || null,
    ship_from_city:    (shipFromCity?.value || '').trim()    || null,
    ship_from_state:   (shipFromState?.value || '').trim()   || null,
    ship_from_zip:     (shipFromZip?.value || '').trim()     || null,
    ship_from_country: (shipFromCountry?.value || '').trim() || null,
    // keep existing fields so we don’t wipe them out
    first_name:  p.first_name  || null,
    last_name:   p.last_name   || null,
    full_name:   p.full_name   || null,
    location:    p.location    || null,
    website:     p.website     || null,
    instagram:   p.instagram   || null,
    tiktok:      p.tiktok      || null,
    bio:         p.bio         || null,
    shop_name:   p.shop_name   || null,
    handle:      p.handle      || null,
    vacation_mode: p.vacation_mode || null
  };

  setStatus('Saving address…');
  setError('');

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('saveShipping error', error);
    setError(error.message || 'Could not save address.');
    setStatus('');
    return;
  }

  profileRow = data;
  setStatus('Address saved.');
  setTimeout(() => setStatus(''), 1500);
}

// Toggle vacation mode
async function toggleVacation() {
  if (!currentUser || !vacSwitch) return;

  const isOn = vacSwitch.dataset.on === 'true';
  const next = !isOn;

  const p = profileRow || {};

  const payload = {
    id: currentUser.id,
    vacation_mode: next,
    // keep the rest
    first_name:  p.first_name  || null,
    last_name:   p.last_name   || null,
    full_name:   p.full_name   || null,
    location:    p.location    || null,
    website:     p.website     || null,
    instagram:   p.instagram   || null,
    tiktok:      p.tiktok      || null,
    bio:         p.bio         || null,
    shop_name:   p.shop_name   || null,
    handle:      p.handle      || null,
    ship_from_name:    p.ship_from_name    || null,
    ship_from_street:  p.ship_from_street  || null,
    ship_from_street2: p.ship_from_street2 || null,
    ship_from_city:    p.ship_from_city    || null,
    ship_from_state:   p.ship_from_state   || null,
    ship_from_zip:     p.ship_from_zip     || null,
    ship_from_country: p.ship_from_country || null
  };

  vacSwitch.dataset.on = next ? 'true' : 'false';

  const { data, error } = await supabase
    .from('profiles')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('toggleVacation error', error);
    // revert UI if save failed
    vacSwitch.dataset.on = isOn ? 'true' : 'false';
    setError('Could not update vacation status.');
    return;
  }

  profileRow = data;
}

// --- Avatar upload (local-only for now) ------------------------------------

function wireAvatarUpload() {
  if (!avatarChangeBtn || !avatarInput || !profileAvatarEl) return;

  avatarChangeBtn.addEventListener('click', () => {
    avatarInput.click();
  });

  avatarInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    // For now we keep this client-side only using a data URL.
    const reader = new FileReader();
    reader.onload = async () => {
      const url = reader.result;

      // Store in localStorage so it shows up on this device
      try {
        localStorage.setItem('hm.avatar.url', url);
      } catch (_) {}

      // Update UI
      profileAvatarEl.textContent = '';
      profileAvatarEl.style.backgroundImage = `url('${url}')`;
      profileAvatarEl.style.backgroundSize = 'cover';
      profileAvatarEl.style.backgroundPosition = 'center';

      if (headerAvatar) {
        headerAvatar.textContent = '';
        headerAvatar.style.backgroundImage = `url('${url}')`;
        headerAvatar.style.backgroundSize = 'cover';
        headerAvatar.style.backgroundPosition = 'center';
        headerAvatar.style.display = 'inline-grid';
      }

      // Optionally, also push to Supabase profile so Atelier can see it later
      if (currentUser) {
        const p = profileRow || {};
        const payload = {
          id: currentUser.id,
          avatar_url: url,
          first_name:  p.first_name  || null,
          last_name:   p.last_name   || null,
          full_name:   p.full_name   || null,
          location:    p.location    || null,
          website:     p.website     || null,
          instagram:   p.instagram   || null,
          tiktok:      p.tiktok      || null,
          bio:         p.bio         || null,
          shop_name:   p.shop_name   || null,
          handle:      p.handle      || null,
          ship_from_name:    p.ship_from_name    || null,
          ship_from_street:  p.ship_from_street  || null,
          ship_from_street2: p.ship_from_street2 || null,
          ship_from_city:    p.ship_from_city    || null,
          ship_from_state:   p.ship_from_state   || null,
          ship_from_zip:     p.ship_from_zip     || null,
          ship_from_country: p.ship_from_country || null,
          vacation_mode:     p.vacation_mode     || null
        };

        const { data, error } = await supabase
          .from('profiles')
          .upsert(payload, { onConflict: 'id' })
          .select()
          .single();

        if (!error) profileRow = data;
      }
    };
    reader.readAsDataURL(file);
  });
}

// --- Event listeners -------------------------------------------------------

function wireEvents() {
  if (editProfileBtn && profileForm) {
    editProfileBtn.addEventListener('click', () => {
      const isOpen = profileForm.style.display === 'block';
      profileForm.style.display = isOpen ? 'none' : 'block';
    });
  }

  if (cancelProfileEdit && profileForm) {
    cancelProfileEdit.addEventListener('click', () => {
      hydrateProfileForm();
      profileForm.style.display = 'none';
    });
  }

  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      saveProfile();
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
      // Clear local avatar cache
      try { localStorage.removeItem('hm.avatar.url'); } catch (_) {}
      window.location.href = 'index.html';
    });
  }

  if (saveShippingBtn) {
    saveShippingBtn.addEventListener('click', (e) => {
      e.preventDefault();
      saveShipping();
    });
  }

  if (vacSwitch) {
    vacSwitch.addEventListener('click', (e) => {
      e.preventDefault();
      toggleVacation();
    });

    vacSwitch.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleVacation();
      }
    });
  }

  wireAvatarUpload();
}

// --- Initial boot ----------------------------------------------------------

(async function init() {
  setStatus('Checking session…');

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error('getSession error', error);
    setError('Could not check your login. Try refreshing.');
    showLoggedOut();
    setStatus('');
    return;
  }

  currentUser = data?.session?.user || null;

  if (!currentUser) {
    showLoggedOut();
    setStatus('Not logged in.');
    return;
  }

  showLoggedIn();

  // Try to load avatar from localStorage for instant header feedback
  try {
    const stored = localStorage.getItem('hm.avatar.url');
    if (stored && profileAvatarEl) {
      profileAvatarEl.textContent = '';
      profileAvatarEl.style.backgroundImage = `url('${stored}')`;
      profileAvatarEl.style.backgroundSize = 'cover';
      profileAvatarEl.style.backgroundPosition = 'center';
    }
    if (stored && headerAvatar) {
      headerAvatar.textContent = '';
      headerAvatar.style.backgroundImage = `url('${stored}')`;
      headerAvatar.style.backgroundSize = 'cover';
      headerAvatar.style.backgroundPosition = 'center';
      headerAvatar.style.display = 'inline-grid';
    }
  } catch (_) {}

  await loadProfile();
  wireEvents();
  setStatus('');
})();
