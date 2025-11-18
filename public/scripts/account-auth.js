// public/scripts/account-auth.js
// Session-aware wiring for Account page (profile, shipping, vacation hold)
// Uses Supabase only for auth; profile/shipping are stored in localStorage for now.

import { supabase } from './supabase-client.js';

const PROFILE_KEY = 'hm.account.profile.v1';
const SHIPPING_KEY = 'hm.account.shipping.v1';
const VACATION_KEY = 'hm.account.vacationHold.v1';
const AVATAR_KEY = 'hm.account.avatar.dataUrl.v1';

function $(id) {
  return document.getElementById(id);
}

// ---------- helpers ----------

function getInitials(nameOrEmail) {
  if (!nameOrEmail) return 'HM';
  const trimmed = nameOrEmail.trim();
  if (!trimmed) return 'HM';

  // If it's an email, use the part before @
  const base = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (!parts.length) return base.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors for now
  }
}

// Very plain "label" version – no dashes, just spaces stripped
function buildShopLabel(profile) {
  const shop = (profile.shopName || '').trim();
  if (shop) return shop;
  const fn = (profile.firstName || '').trim();
  const ln = (profile.lastName || '').trim();
  if (fn && ln) return `${fn} ${ln}`;
  if (fn) return fn;
  return '';
}

// ---------- profile + shipping wiring ----------

async function initAccount() {
  const accountGrid = $('accountGrid');
  const accountLoggedOut = $('accountLoggedOut');
  const logoutBtn = $('logoutBtn');
  const headerAvatar = $('headerAvatar');
  const loginHeaderBtn = $('loginHeaderBtn');

  // Profile summary DOM
  const profileAvatar = $('profileAvatar');
  const profileNameEl = $('profileName');
  const profileEmailEl = $('profileEmail');
  const profileLocationSummary = $('profileLocationSummary');
  const profileBioSummary = $('profileBioSummary');
  const profileWebsiteWrapper = $('profileWebsiteWrapper');
  const profileWebsiteLink = $('profileWebsite');

  // Profile form DOM
  const profileForm = $('profileForm');
  const editProfileBtn = $('editProfileBtn');
  const saveProfileBtn = $('saveProfileBtn');
  const cancelProfileEditBtn = $('cancelProfileEditBtn');
  const avatarChangeBtn = $('avatarChangeBtn');
  const avatarInput = $('avatarInput');

  const firstNameInput = $('firstNameInput');
  const lastNameInput = $('lastNameInput');
  const locationInput = $('locationInput');
  const shopNameInput = $('shopNameInput');
  const websiteInput = $('websiteInput');
  const instagramInput = $('instagramInput');
  const tiktokInput = $('tiktokInput');
  const bioInput = $('bioInput');

  // Shipping DOM
  const shipFromName = $('shipFromName');
  const shipFromStreet = $('shipFromStreet');
  const shipFromStreet2 = $('shipFromStreet2');
  const shipFromCity = $('shipFromCity');
  const shipFromState = $('shipFromState');
  const shipFromZip = $('shipFromZip');
  const shipFromCountry = $('shipFromCountry');
  const saveShippingSettingsBtn = $('saveShippingSettingsBtn');

  // Vacation hold
  const vacSwitch = $('vacSwitch');

  // 1) Auth session
  let sessionUser = null;
  try {
    const { data } = await supabase.auth.getSession();
    sessionUser = data?.session?.user || null;
  } catch {
    sessionUser = null;
  }

  if (!sessionUser) {
    // Logged out state
    if (accountGrid) accountGrid.style.display = 'none';
    if (accountLoggedOut) accountLoggedOut.style.display = '';
    if (headerAvatar) headerAvatar.style.display = 'none';
    if (loginHeaderBtn) loginHeaderBtn.style.display = '';
    return;
  }

  const email = sessionUser.email || '';
  const fullName = sessionUser.user_metadata?.full_name || '';

  if (accountLoggedOut) accountLoggedOut.style.display = 'none';
  if (accountGrid) accountGrid.style.display = '';

  // Header avatar
  if (headerAvatar) {
    headerAvatar.textContent = getInitials(fullName || email);
    headerAvatar.style.display = '';
  }
  if (loginHeaderBtn) {
    loginHeaderBtn.style.display = 'none';
  }

  // 2) Load profile + shipping from localStorage
  let profile = loadJSON(PROFILE_KEY, {
    firstName: fullName.split(' ')[0] || '',
    lastName: fullName.split(' ').slice(1).join(' ') || '',
    location: '',
    shopName: '',
    website: '',
    instagram: '',
    tiktok: '',
    bio: '',
    email: email
  });

  // Keep email up to date from Supabase
  profile.email = email;

  let shipping = loadJSON(SHIPPING_KEY, {
    name: fullName || '',
    street: '',
    street2: '',
    city: '',
    state: '',
    zip: '',
    country: 'US'
  });

  // 3) Render profile summary + form

  function applyAvatarFromStorage() {
    const dataUrl = localStorage.getItem(AVATAR_KEY);
    if (dataUrl && profileAvatar) {
      profileAvatar.style.backgroundImage = `url(${dataUrl})`;
      profileAvatar.style.backgroundSize = 'cover';
      profileAvatar.style.backgroundPosition = 'center';
      profileAvatar.textContent = '';
    } else if (profileAvatar) {
      profileAvatar.style.backgroundImage = '';
      profileAvatar.textContent = getInitials(
        `${profile.firstName} ${profile.lastName}` || profile.email
      );
    }
    if (headerAvatar) {
      headerAvatar.textContent = getInitials(
        `${profile.firstName} ${profile.lastName}` || profile.email
      );
    }
  }

  function renderProfileSummary() {
    if (profileNameEl) {
      const label = buildShopLabel(profile) || 'Hemline Market member';
      profileNameEl.textContent = label;
    }
    if (profileEmailEl) {
      profileEmailEl.textContent = profile.email || '';
    }

    if (profileLocationSummary) {
      if (profile.location && profile.location.trim()) {
        profileLocationSummary.textContent = profile.location.trim();
        profileLocationSummary.style.display = '';
      } else {
        profileLocationSummary.style.display = 'none';
      }
    }

    if (profileBioSummary) {
      if (profile.bio && profile.bio.trim()) {
        profileBioSummary.textContent = profile.bio.trim();
        profileBioSummary.style.display = '';
      } else {
        profileBioSummary.style.display = 'none';
      }
    }

    if (profileWebsiteWrapper && profileWebsiteLink) {
      const url = (profile.website || '').trim();
      if (url) {
        profileWebsiteLink.href = url;
        profileWebsiteLink.textContent = url.replace(/^https?:\/\//i, '');
        profileWebsiteWrapper.style.display = '';
      } else {
        profileWebsiteWrapper.style.display = 'none';
      }
    }

    applyAvatarFromStorage();
  }

  function renderProfileForm() {
    if (firstNameInput) firstNameInput.value = profile.firstName || '';
    if (lastNameInput) lastNameInput.value = profile.lastName || '';
    if (locationInput) locationInput.value = profile.location || '';
    if (shopNameInput) shopNameInput.value = profile.shopName || '';
    if (websiteInput) websiteInput.value = profile.website || '';
    if (instagramInput) instagramInput.value = profile.instagram || '';
    if (tiktokInput) tiktokInput.value = profile.tiktok || '';
    if (bioInput) bioInput.value = profile.bio || '';
  }

  function renderShippingForm() {
    if (shipFromName) shipFromName.value = shipping.name || '';
    if (shipFromStreet) shipFromStreet.value = shipping.street || '';
    if (shipFromStreet2) shipFromStreet2.value = shipping.street2 || '';
    if (shipFromCity) shipFromCity.value = shipping.city || '';
    if (shipFromState) shipFromState.value = shipping.state || '';
    if (shipFromZip) shipFromZip.value = shipping.zip || '';
    if (shipFromCountry) shipFromCountry.value = shipping.country || 'US';
  }

  renderProfileSummary();
  renderProfileForm();
  renderShippingForm();

  // 4) Profile editing

  if (editProfileBtn && profileForm) {
    editProfileBtn.addEventListener('click', () => {
      renderProfileForm();
      profileForm.style.display = 'block';
    });
  }

  if (cancelProfileEditBtn && profileForm) {
    cancelProfileEditBtn.addEventListener('click', () => {
      renderProfileForm();
      profileForm.style.display = 'none';
    });
  }

  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
      if (firstNameInput) profile.firstName = firstNameInput.value.trim();
      if (lastNameInput) profile.lastName = lastNameInput.value.trim();
      if (locationInput) profile.location = locationInput.value.trim();
      if (shopNameInput) profile.shopName = shopNameInput.value.trim();
      if (websiteInput) profile.website = websiteInput.value.trim();
      if (instagramInput) profile.instagram = instagramInput.value.trim();
      if (tiktokInput) profile.tiktok = tiktokInput.value.trim();
      if (bioInput) profile.bio = bioInput.value.trim();

      saveJSON(PROFILE_KEY, profile);
      renderProfileSummary();
      if (profileForm) profileForm.style.display = 'none';
    });
  }

  // Avatar upload
  if (avatarChangeBtn && avatarInput) {
    avatarChangeBtn.addEventListener('click', () => {
      avatarInput.click();
    });

    avatarInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          localStorage.setItem(AVATAR_KEY, reader.result);
        } catch {
          // ignore
        }
        applyAvatarFromStorage();
      };
      reader.readAsDataURL(file);
    });
  }

  // 5) Shipping save

  if (saveShippingSettingsBtn) {
    saveShippingSettingsBtn.addEventListener('click', () => {
      if (shipFromName) shipping.name = shipFromName.value.trim();
      if (shipFromStreet) shipping.street = shipFromStreet.value.trim();
      if (shipFromStreet2) shipping.street2 = shipFromStreet2.value.trim();
      if (shipFromCity) shipping.city = shipFromCity.value.trim();
      if (shipFromState) shipping.state = shipFromState.value.trim();
      if (shipFromZip) shipping.zip = shipFromZip.value.trim();
      if (shipFromCountry) shipping.country = shipFromCountry.value || 'US';

      saveJSON(SHIPPING_KEY, shipping);

      // If profile location is blank, derive it from city/state for you.
      const city = shipping.city;
      const st = shipping.state;
      if ((!profile.location || !profile.location.trim()) && city && st && locationInput) {
        profile.location = `${city}, ${st}`;
        locationInput.value = profile.location;
        saveJSON(PROFILE_KEY, profile);
        renderProfileSummary();
      }

      // Tiny confirmation affordance
      saveShippingSettingsBtn.textContent = 'Saved';
      setTimeout(() => {
        saveShippingSettingsBtn.textContent = 'Save shipping address';
      }, 900);
    });
  }

  // 6) Vacation hold toggle (stored locally for now)

  if (vacSwitch) {
    const stored = loadJSON(VACATION_KEY, { on: false });
    vacSwitch.dataset.on = stored.on ? 'true' : 'false';

    const updateSwitch = () => {
      const current = vacSwitch.dataset.on === 'true';
      vacSwitch.dataset.on = current ? 'false' : 'true';
      saveJSON(VACATION_KEY, { on: !current });
    };

    vacSwitch.addEventListener('click', updateSwitch);
    vacSwitch.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        updateSwitch();
      }
    });
  }

  // 7) Logout

  if (logoutBtn) {
    logoutBtn.style.display = '';
    logoutBtn.addEventListener('click', async () => {
      try {
        await supabase.auth.signOut();
      } catch {
        // ignore
      }
      window.location.href = 'auth.html';
    });
  }
}

// Kick things off
document.addEventListener('DOMContentLoaded', () => {
  initAccount().catch(() => {
    // Fail quietly – better to leave the page static than break it completely.
  });
});
