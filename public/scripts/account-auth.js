// public/scripts/account-auth.js
// Account page: session check, profile + shop settings, header avatar, and basic shipping persistence.

import { supabase } from './supabase-client.js';

async function getSessionUser() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('Error getting session', error);
    return null;
  }
  return data?.session?.user || null;
}

/* ---------- DOM helpers ---------- */

function $(id) {
  return document.getElementById(id);
}

function setText(el, value) {
  if (!el) return;
  el.textContent = value || '';
}

/* ---------- Avatar helpers (local only for now) ---------- */

function initialsFrom(user, profile) {
  const first = profile?.first_name || '';
  const last = profile?.last_name || '';
  const full = `${first} ${last}`.trim();
  if (full) {
    const parts = full.split(/\s+/);
    return (parts[0][0] || '') + (parts[1]?.[0] || '');
  }
  const email = user?.email || '';
  if (!email) return 'HM';
  const namePart = email.split('@')[0];
  const firstChar = namePart[0] || '';
  const secondChar = namePart.split(/[._-]/)[1]?.[0] || '';
  return (firstChar + secondChar || 'HM').toUpperCase();
}

function applyAvatarVisual(url, initials) {
  const avatarEls = [$('profileAvatar'), $('headerAvatar')].filter(Boolean);

  avatarEls.forEach(el => {
    el.style.backgroundImage = '';
    el.style.backgroundColor = '#fefce8';
    if (url) {
      el.style.backgroundImage = `url(${url})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.textContent = '';
    } else {
      el.textContent = (initials || 'HM').toUpperCase();
    }
  });
}

function loadAvatarFromLocal(user, profile) {
  let url = null;
  try {
    url = localStorage.getItem('hm.avatar');
  } catch (e) {
    console.warn('Avatar localStorage unavailable', e);
  }
  const ini = initialsFrom(user, profile);
  applyAvatarVisual(url, ini);
}

/* ---------- Shop slug (no dashes) ---------- */

function makeBaseFromName(firstName, lastName) {
  const combo = `${firstName || ''}${lastName || ''}`.trim();
  return combo || '';
}

// normalize to letters + digits only, lowercased, no dashes
function normalizeSlugSource(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

async function findUniqueShopSlug(baseSource, userId) {
  let raw = normalizeSlugSource(baseSource);
  if (!raw) raw = 'shop';

  let candidate = raw;
  let suffix = 2;

  for (let i = 0; i < 40; i++) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,user_id')
      .eq('shop_slug', candidate)
      .neq('user_id', userId)
      .limit(1);

    if (error) {
      console.warn('Shop slug uniqueness check failed; using first candidate', error);
      return candidate;
    }

    if (!data || data.length === 0) {
      return candidate; // unique
    }

    candidate = raw + String(suffix);
    suffix += 1;
  }

  // Fallback: include a piece of userId to break ties
  return raw + userId.slice(0, 4);
}

/* ---------- Load + render profile ---------- */

async function loadProfile(user) {
  const {
    data: rows,
    error
  } = await supabase
    .from('profiles')
    .select(
      'id, first_name, last_name, location, website, instagram, tiktok, bio, shop_name, shop_slug'
    )
    .eq('user_id', user.id)
    .limit(1);

  if (error) {
    console.error('Error loading profile', error);
  }

  const profile = rows && rows[0] ? rows[0] : {};

  const firstName = profile.first_name || '';
  const lastName = profile.last_name || '';
  const fullName = (firstName || lastName)
    ? `${firstName} ${lastName}`.trim()
    : 'Hemline member';

  const shopName = profile.shop_name || '';
  const displayName = shopName || fullName;
  const email = user.email || '';

  // Profile summary card
  setText($('profileName'), fullName);
  setText($('profileEmail'), email);
  setText($('profileLocationSummary'), profile.location || '');
  setText($('profileBioSummary'), profile.bio || '');
  if (profile.location) $('profileLocationSummary').style.display = '';
  if (profile.bio) $('profileBioSummary').style.display = '';

  if (profile.website) {
    const link = $('profileWebsite');
    const wrap = $('profileWebsiteWrapper');
    if (link && wrap) {
      link.href = profile.website;
      link.textContent = profile.website;
      wrap.style.display = '';
    }
  }

  // Inline form values
  if ($('firstNameInput')) $('firstNameInput').value = firstName;
  if ($('lastNameInput')) $('lastNameInput').value = lastName;
  if ($('locationInput')) $('locationInput').value = profile.location || '';
  if ($('shopNameInput')) $('shopNameInput').value = shopName || '';
  if ($('websiteInput')) $('websiteInput').value = profile.website || '';
  if ($('instagramInput')) $('instagramInput').value = profile.instagram || '';
  if ($('tiktokInput')) $('tiktokInput').value = profile.tiktok || '';
  if ($('bioInput')) $('bioInput').value = profile.bio || '';

  // Header avatar + initials
  loadAvatarFromLocal(user, profile);

  // Header initials text
  const headerAvatar = $('headerAvatar');
  if (headerAvatar) {
    headerAvatar.style.display = 'inline-grid';
    headerAvatar.title = 'Your account';
  }

  return profile;
}

/* ---------- Save profile ---------- */

async function saveProfile(user) {
  const firstName = $('firstNameInput')?.value.trim() || '';
  const lastName = $('lastNameInput')?.value.trim() || '';
  const location = $('locationInput')?.value.trim() || '';
  const shopNameRaw = $('shopNameInput')?.value.trim() || '';
  const website = $('websiteInput')?.value.trim() || '';
  const instagram = $('instagramInput')?.value.trim() || '';
  const tiktok = $('tiktokInput')?.value.trim() || '';
  const bio = $('bioInput')?.value.trim() || '';

  // Shop display name: explicit shop name or person's name
  const displayNameBase =
    shopNameRaw ||
    makeBaseFromName(firstName, lastName) ||
    (user.email || '').split('@')[0] ||
    'shop';

  // Generate a unique slug (no dashes) whenever we save
  const shopSlug = await findUniqueShopSlug(displayNameBase, user.id);

  const updates = {
    user_id: user.id,
    first_name: firstName || null,
    last_name: lastName || null,
    location: location || null,
    website: website || null,
    instagram: instagram || null,
    tiktok: tiktok || null,
    bio: bio || null,
    shop_name: shopNameRaw || null,
    shop_slug: shopSlug
  };

  const { error } = await supabase
    .from('profiles')
    .upsert(updates, { onConflict: 'user_id' });

  if (error) {
    console.error('Error saving profile', error);
    alert('Could not save your profile. Please try again.');
    return;
  }

  // Re-render with fresh data
  await loadProfile(user);

  // Collapse form
  const form = $('profileForm');
  if (form) form.style.display = 'none';
}

/* ---------- Shipping (local-only for now) ---------- */

function loadShippingFromLocal() {
  let data = null;
  try {
    const raw = localStorage.getItem('hm.shipping');
    if (raw) data = JSON.parse(raw);
  } catch (e) {
    console.warn('Shipping localStorage unreadable', e);
  }
  if (!data) return;

  $('shipFromName') && ($('shipFromName').value = data.name || '');
  $('shipFromStreet') && ($('shipFromStreet').value = data.street || '');
  $('shipFromStreet2') && ($('shipFromStreet2').value = data.street2 || '');
  $('shipFromCity') && ($('shipFromCity').value = data.city || '');
  $('shipFromState') && ($('shipFromState').value = data.state || '');
  $('shipFromZip') && ($('shipFromZip').value = data.zip || '');
  $('shipFromCountry') && ($('shipFromCountry').value = data.country || '');
}

function saveShippingToLocal() {
  const payload = {
    name: $('shipFromName')?.value.trim() || '',
    street: $('shipFromStreet')?.value.trim() || '',
    street2: $('shipFromStreet2')?.value.trim() || '',
    city: $('shipFromCity')?.value.trim() || '',
    state: $('shipFromState')?.value.trim() || '',
    zip: $('shipFromZip')?.value.trim() || '',
    country: $('shipFromCountry')?.value || ''
  };

  try {
    localStorage.setItem('hm.shipping', JSON.stringify(payload));
  } catch (e) {
    console.warn('Unable to save shipping locally', e);
  }

  alert('Shipping address saved.');
}

/* ---------- Auth overlay on Account ---------- */

function wireAuthOverlay() {
  const overlay = $('authOverlay');
  const closeBtn = $('authCloseBtn');

  function close() {
    if (!overlay) return;
    overlay.classList.remove('show');
  }

  if (closeBtn && overlay) {
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
  }
}

/* ---------- Header state ---------- */

function showLoggedOutHeader() {
  const avatar = $('headerAvatar');
  const loginBtn = $('loginHeaderBtn');
  if (avatar) avatar.style.display = 'none';
  if (loginBtn) loginBtn.style.display = 'inline-flex';
}

function showLoggedInHeader() {
  const avatar = $('headerAvatar');
  const loginBtn = $('loginHeaderBtn');
  if (avatar) avatar.style.display = 'inline-grid';
  if (loginBtn) loginBtn.style.display = 'none';
}

/* ---------- Main init ---------- */

async function initAccount() {
  const user = await getSessionUser();

  const loggedOutCard = $('accountLoggedOut');
  const accountGrid = $('accountGrid');

  if (!user) {
    if (loggedOutCard) loggedOutCard.style.display = '';
    if (accountGrid) accountGrid.style.display = 'none';
    showLoggedOutHeader();
    wireAuthOverlay();
    return;
  }

  // Logged in
  if (loggedOutCard) loggedOutCard.style.display = 'none';
  if (accountGrid) accountGrid.style.display = '';
  showLoggedInHeader();
  wireAuthOverlay();

  const profile = await loadProfile(user);

  // Avatar upload
  const avatarBtn = $('avatarChangeBtn');
  const avatarInput = $('avatarInput');
  if (avatarBtn && avatarInput) {
    avatarBtn.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', e => {
      const file = e.target.files && e.target.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = evt => {
        const dataUrl = evt.target.result;
        try {
          localStorage.setItem('hm.avatar', dataUrl);
        } catch (err) {
          console.warn('Avatar too large for localStorage or not allowed', err);
        }
        applyAvatarVisual(dataUrl, initialsFrom(user, profile));
      };
      reader.readAsDataURL(file);
    });
  }

  // Edit profile form toggles
  const editProfileBtn = $('editProfileBtn');
  const cancelProfileEditBtn = $('cancelProfileEditBtn');
  const saveProfileBtn = $('saveProfileBtn');
  const profileForm = $('profileForm');

  if (editProfileBtn && profileForm) {
    editProfileBtn.addEventListener('click', () => {
      profileForm.style.display = profileForm.style.display === 'block' ? 'none' : 'block';
    });
  }
  if (cancelProfileEditBtn && profileForm) {
    cancelProfileEditBtn.addEventListener('click', () => {
      profileForm.style.display = 'none';
      loadProfile(user); // reset fields to saved state
    });
  }
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
      saveProfile(user).catch(err => console.error(err));
    });
  }

  // Logout
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
      location.href = 'auth.html';
    });
  }

  // Shipping
  loadShippingFromLocal();
  const saveShippingBtn = $('saveShippingSettingsBtn');
  if (saveShippingBtn) {
    saveShippingBtn.addEventListener('click', saveShippingToLocal);
  }

  // Vacation switch (local for now)
  const vacSwitch = $('vacSwitch');
  if (vacSwitch) {
    try {
      const stored = localStorage.getItem('hm.vacation');
      if (stored === 'true') {
        vacSwitch.dataset.on = 'true';
      }
    } catch (e) {}

    const toggle = () => {
      const isOn = vacSwitch.dataset.on === 'true';
      vacSwitch.dataset.on = isOn ? 'false' : 'true';
      try {
        localStorage.setItem('hm.vacation', String(!isOn));
      } catch (e) {}
    };
    vacSwitch.addEventListener('click', toggle);
    vacSwitch.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggle();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initAccount().catch(err => console.error('Account init failed', err));
});
