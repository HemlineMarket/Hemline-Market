// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- ELEMENTS ----

// Header
const headerAvatar = document.getElementById("headerAvatar");
const loginHeaderBtn = document.getElementById("loginHeaderBtn");

// Profile summary + avatar
const profileAvatar = document.getElementById("profileAvatar");
const summaryName = document.getElementById("summaryName");
const summaryEmail = document.getElementById("summaryEmail");
const summaryLocation = document.getElementById("summaryLocation");
const summaryBio = document.getElementById("summaryBio");

// Profile form controls
const btnEditPhoto = document.getElementById("btnEditPhoto");
const btnEditProfile = document.getElementById("btnEditProfile");
const btnLogout = document.getElementById("btnLogout");

const profileForm = document.getElementById("profileForm");
const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");
const locationInput = document.getElementById("location");
const shopNameInput = document.getElementById("shopName");
const websiteInput = document.getElementById("website");
const instagramInput = document.getElementById("instagram");
const tiktokInput = document.getElementById("tiktok");
const bioInput = document.getElementById("bio");
const avatarFileInput = document.getElementById("avatarFile");
const btnCancelProfile = document.getElementById("btnCancelProfile");

// Address
const addressSummary = document.getElementById("addressSummary");
const addrSummaryName = document.getElementById("addrSummaryName");
const addrSummaryLine1 = document.getElementById("addrSummaryLine1");
const addrSummaryCityState = document.getElementById("addrSummaryCityState");
const addrSummaryPostCountry = document.getElementById("addrSummaryPostCountry");

const addressForm = document.getElementById("addressForm");
const shipNameInput = document.getElementById("shipName");
const shipLine1Input = document.getElementById("shipLine1");
const shipLine2Input = document.getElementById("shipLine2");
const shipCityInput = document.getElementById("shipCity");
const shipStateInput = document.getElementById("shipState");
const shipZipInput = document.getElementById("shipZip");
const shipCountrySelect = document.getElementById("shipCountry");
const btnEditAddress = document.getElementById("btnEditAddress");
const btnCancelAddress = document.getElementById("btnCancelAddress");

// Status & security
const vacationToggle = document.getElementById("vacationToggle");
const btnChangePassword = document.getElementById("btnChangePassword");
const btnStripe = document.getElementById("btnStripe");

// ---- STATE ----
let currentUser = null;
let currentProfile = null;

// ---- HELPERS ----

function getInitialsFromStrings(name, email) {
  const trimmed = (name || "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    const a = parts[0][0] || "";
    const b = parts[parts.length - 1][0] || "";
    const letters = (a + b).toUpperCase();
    if (letters) return letters;
  }
  const em = email || "";
  if (em) {
    const local = em.split("@")[0] || "";
    if (local) return local.slice(0, 2).toUpperCase();
  }
  return "HM";
}

function getInitials(user, profile) {
  const meta = user?.user_metadata || {};
  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const fullNameMeta = [first, last].filter(Boolean).join(" ").trim();
  const profileName = (profile?.shop_name || profile?.full_name || "").trim();
  const displayName = profileName || fullNameMeta || meta.display_name || "";

  return getInitialsFromStrings(displayName, user?.email);
}

function avatarStorageKey(user) {
  if (!user?.id) return null;
  return `hm-avatar-${user.id}`;
}

function applyLocalAvatar(user) {
  const key = avatarStorageKey(user);
  if (!key) return;

  try {
    const dataUrl = window.localStorage.getItem(key);
    if (dataUrl && profileAvatar) {
      profileAvatar.style.backgroundImage = `url(${dataUrl})`;
      profileAvatar.style.backgroundSize = "cover";
      profileAvatar.style.backgroundPosition = "center";
      profileAvatar.textContent = "";
    }
  } catch (e) {
    console.warn("Could not read avatar from localStorage", e);
  }
}

function saveLocalAvatar(user, dataUrl) {
  const key = avatarStorageKey(user);
  if (!key) return;
  try {
    window.localStorage.setItem(key, dataUrl);
  } catch (e) {
    console.warn("Could not save avatar to localStorage", e);
  }
}

function show(el) {
  if (el) el.classList.remove("hidden");
}

function hide(el) {
  if (el) el.classList.add("hidden");
}

// Build slug with NO dashes: only letters+numbers, all lowercase.
// Example: "Roza Kalwar Studio" → "rozakalwarstudio"
function buildBaseSlug(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "") // remove everything that is not a–z or 0–9
    .slice(0, 60);
}

// Ensure slug is unique across profiles. If taken, add a number: rozakalwar, rozakalwar2, rozakalwar3, ...
async function ensureUniqueSlug(base, userId) {
  if (!base) return "";

  const { data, error } = await supabase
    .from("profiles")
    .select("id, shop_slug")
    .ilike("shop_slug", `${base}%`);

  if (error) {
    console.warn("Error checking shop_slug uniqueness:", error);
    return base;
  }

  const taken = new Set(
    (data || [])
      .filter((row) => row.id !== userId && row.shop_slug)
      .map((row) => row.shop_slug.toLowerCase())
  );

  // If base is not taken, use it
  if (!taken.has(base.toLowerCase())) {
    return base;
  }

  // Otherwise, add numeric suffix
  let n = 2;
  let candidate = `${base}${n}`;
  while (taken.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${base}${n}`;
  }
  return candidate;
}

// ---- PROFILE LOAD / SAVE ----

async function fetchOrCreateProfile(user) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "id, full_name, tagline, location, shop_name, website, instagram, tiktok, avatar_url, shop_slug"
      )
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("Error loading profile:", error);
    }

    if (data) return data;

    // Create minimal profile row if none exists yet
    const meta = user.user_metadata || {};
    const first = (meta.first_name || "").trim();
    const last = (meta.last_name || "").trim();
    const fullName =
      [first, last].filter(Boolean).join(" ").trim() ||
      (meta.display_name || "").trim() ||
      user.email ||
      "Hemline sewist";

    const insertPayload = {
      id: user.id,
      full_name: fullName,
      tagline: "",
      location: meta.location || "",
      shop_name: meta.shop_name || "",
      website: meta.website || "",
      instagram: meta.instagram || "",
      tiktok: meta.tiktok || "",
      avatar_url: null,
      shop_slug: "",
    };

    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .insert(insertPayload)
      .select(
        "id, full_name, tagline, location, shop_name, website, instagram, tiktok, avatar_url, shop_slug"
      )
      .single();

    if (insertError) {
      console.warn("Error creating profile row:", insertError);
      return insertPayload;
    }

    return inserted;
  } catch (e) {
    console.error("Unexpected error loading profile:", e);
    const meta = user.user_metadata || {};
    return {
      id: user.id,
      full_name: meta.display_name || user.email || "Hemline sewist",
      tagline: "",
      location: meta.location || "",
      shop_name: meta.shop_name || "",
      website: meta.website || "",
      instagram: meta.instagram || "",
      tiktok: meta.tiktok || "",
      avatar_url: null,
      shop_slug: "",
    };
  }
}

function applyHeaderUI(user, profile) {
  const initials = getInitials(user, profile);

  if (headerAvatar) {
    headerAvatar.textContent = initials;
    headerAvatar.style.display = "inline-grid";
  }
  if (loginHeaderBtn) {
    loginHeaderBtn.style.display = "none";
  }
}

function applyProfileSummaryUI(user, profile) {
  const meta = user.user_metadata || {};

  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const fullNameMeta = [first, last].filter(Boolean).join(" ").trim();

  const shopName = (profile?.shop_name || "").trim();
  const fullName = (profile?.full_name || "").trim() || fullNameMeta;

  const primaryName = shopName || fullName || user.email || "Hemline member";
  const email = user.email || "";

  const location = (profile?.location || meta.location || "").trim();
  const bioText = (profile?.tagline || meta.bio || "").trim();

  const initials = getInitials(user, profile);

  if (summaryName) summaryName.textContent = primaryName;
  if (summaryEmail) summaryEmail.textContent = email;
  if (summaryLocation) {
    summaryLocation.textContent = location || "Location not added";
  }
  if (summaryBio) {
    summaryBio.textContent =
      bioText ||
      "Tell buyers a bit about your sourcing, favorite textiles, or sewing style.";
  }

  if (profileAvatar) {
    profileAvatar.textContent = initials;
    profileAvatar.style.backgroundImage = "";
  }

  // Apply any stored avatar from localStorage over the initials
  applyLocalAvatar(user);
}

function applyProfileFormUI(user, profile) {
  const meta = user.user_metadata || {};
  const first = meta.first_name || "";
  const last = meta.last_name || "";
  const location = profile?.location || meta.location || "";
  const shopName = profile?.shop_name || meta.shop_name || "";
  const website = profile?.website || meta.website || "";
  const instagram = profile?.instagram || meta.instagram || "";
  const tiktok = profile?.tiktok || meta.tiktok || "";
  const bio = profile?.tagline || meta.bio || "";

  if (firstNameInput) firstNameInput.value = first;
  if (lastNameInput) lastNameInput.value = last;
  if (locationInput) locationInput.value = location;
  if (shopNameInput) shopNameInput.value = shopName;
  if (websiteInput) websiteInput.value = website;
  if (instagramInput) instagramInput.value = instagram;
  if (tiktokInput) tiktokInput.value = tiktok;
  if (bioInput) bioInput.value = bio;
}

// Address in user_metadata only (private)
function applyAddressUI(user) {
  const meta = user.user_metadata || {};
  const name = (meta.ship_name || "").trim();
  const line1 = (meta.ship_line1 || "").trim();
  const line2 = (meta.ship_line2 || "").trim();
  const city = (meta.ship_city || "").trim();
  const state = (meta.ship_state || "").trim();
  const zip = (meta.ship_zip || "").trim();
  const country = (meta.ship_country || "").trim();

  // Summary
  if (addrSummaryName) {
    addrSummaryName.textContent = name || "Add your ship-from name";
  }
  if (addrSummaryLine1) {
    addrSummaryLine1.textContent =
      [line1, line2].filter(Boolean).join(", ") || "Add your street address";
  }
  if (addrSummaryCityState) {
    const cityState = [city, state].filter(Boolean).join(", ");
    addrSummaryCityState.textContent = cityState || "City, State";
  }
  if (addrSummaryPostCountry) {
    const postCountry = [zip, country].filter(Boolean).join(" · ");
    addrSummaryPostCountry.textContent = postCountry || "Postal code · Country";
  }

  // Form
  if (shipNameInput) shipNameInput.value = name;
  if (shipLine1Input) shipLine1Input.value = line1;
  if (shipLine2Input) shipLine2Input.value = line2;
  if (shipCityInput) shipCityInput.value = city;
  if (shipStateInput) shipStateInput.value = state;
  if (shipZipInput) shipZipInput.value = zip;
  if (shipCountrySelect && country) {
    shipCountrySelect.value = country;
  }
}

function applyStatusUI(user) {
  const meta = user.user_metadata || {};
  const vacOn = !!meta.vacation_on;

  if (vacationToggle) {
    vacationToggle.checked = vacOn;
  }
}

// ---- INITIAL LOAD ----
(async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("Error getting current user:", error);
    }

    currentUser = data?.user || null;

    // If not logged in, send to auth page
    if (!currentUser) {
      if (headerAvatar) headerAvatar.style.display = "none";
      if (loginHeaderBtn) loginHeaderBtn.style.display = "inline-block";
      window.location.href = "auth.html";
      return;
    }

    currentProfile = await fetchOrCreateProfile(currentUser);

    applyHeaderUI(currentUser, currentProfile);
    applyProfileSummaryUI(currentUser, currentProfile);
    applyProfileFormUI(currentUser, currentProfile);
    applyAddressUI(currentUser);
    applyStatusUI(currentUser);
  } catch (e) {
    console.error("Error during account initialization:", e);
  }
})();

// ---- EVENTS: PROFILE ----

if (btnEditProfile && profileForm) {
  btnEditProfile.addEventListener("click", () => {
    if (!currentUser) return;
    applyProfileFormUI(currentUser, currentProfile);
    show(profileForm);
    profileForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

if (btnCancelProfile && profileForm) {
  btnCancelProfile.addEventListener("click", () => {
    hide(profileForm);
  });
}

if (profileForm) {
  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const first = (firstNameInput?.value || "").trim();
    const last = (lastNameInput?.value || "").trim();
    const location = (locationInput?.value || "").trim();
    const shopName = (shopNameInput?.value || "").trim();
    const website = (websiteInput?.value || "").trim();
    const instagram = (instagramInput?.value || "").trim();
    const tiktok = (tiktokInput?.value || "").trim();
    const bio = (bioInput?.value || "").trim();

    const meta = currentUser.user_metadata || {};
    const fullName =
      [first, last].filter(Boolean).join(" ").trim() ||
      (currentProfile?.full_name || "").trim() ||
      meta.display_name ||
      currentUser.email ||
      "Hemline sewist";

    // Update auth user metadata (private)
    const newMeta = {
      ...meta,
      first_name: first || null,
      last_name: last || null,
      location: location || null,
      bio: bio || null,
      shop_name: shopName || null,
      website: website || null,
      instagram: instagram || null,
      tiktok: tiktok || null,
    };

    let updatedUser = currentUser;
    try {
      const { data, error } = await supabase.auth.updateUser({ data: newMeta });
      if (error) {
        console.error("Error updating auth metadata:", error);
        alert("There was a problem saving your profile. Please try again.");
        return;
      }
      updatedUser = data.user;
      currentUser = updatedUser;
    } catch (err) {
      console.error("Error updating auth user:", err);
      alert("There was a problem saving your profile. Please try again.");
      return;
    }

    // Build shop slug from shopName OR fullName OR email local-part
    const baseNameForSlug =
      shopName ||
      fullName ||
      (updatedUser.email ? updatedUser.email.split("@")[0] : "");

    let shopSlug = currentProfile?.shop_slug || "";
    if (baseNameForSlug) {
      const base = buildBaseSlug(baseNameForSlug);
      shopSlug = await ensureUniqueSlug(base, updatedUser.id);
    }

    // Update profiles row (public profile)
    const profilePayload = {
      id: updatedUser.id,
      full_name: fullName,
      location: location || "",
      tagline: bio || "",
      shop_name: shopName || "",
      website: website || "",
      instagram: instagram || "",
      tiktok: tiktok || "",
      shop_slug: shopSlug || "",
    };

    try {
      const { data: upserted, error: upsertError } = await supabase
        .from("profiles")
        .upsert(profilePayload, { onConflict: "id" })
        .select(
          "id, full_name, tagline, location, shop_name, website, instagram, tiktok, avatar_url, shop_slug"
        )
        .single();

      if (upsertError) {
        console.error("Error saving profile row:", upsertError);
        alert("There was a problem saving your profile. Please try again.");
        return;
      }

      currentProfile = upserted;
    } catch (e) {
      console.error("Unexpected error saving profile row:", e);
      alert("There was a problem saving your profile. Please try again.");
      return;
    }

    applyProfileSummaryUI(updatedUser, currentProfile);
    hide(profileForm);
  });
}

// Avatar upload (localStorage-backed for now)
if (btnEditPhoto && avatarFileInput) {
  btnEditPhoto.addEventListener("click", () => {
    if (!currentUser) return;
    avatarFileInput.click();
  });

  avatarFileInput.addEventListener("change", () => {
    if (!currentUser) return;
    const file = avatarFileInput.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (!dataUrl || !profileAvatar) return;

      profileAvatar.style.backgroundImage = `url(${dataUrl})`;
      profileAvatar.style.backgroundSize = "cover";
      profileAvatar.style.backgroundPosition = "center";
      profileAvatar.textContent = "";

      saveLocalAvatar(currentUser, dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

// Logout
if (btnLogout) {
  btnLogout.addEventListener("click", async () => {
    await supabase.auth.signOut();
    // Clear avatar from localStorage for this user
    const key = avatarStorageKey(currentUser);
    if (key) {
      try {
        window.localStorage.removeItem(key);
      } catch (e) {
        console.warn("Could not remove avatar from localStorage", e);
      }
    }
    window.location.href = "index.html";
  });
}

// ---- EVENTS: ADDRESS ----

if (btnEditAddress && addressForm && addressSummary) {
  btnEditAddress.addEventListener("click", () => {
    show(addressForm);
    hide(addressSummary);
    btnEditAddress.style.display = "none";
  });
}

if (btnCancelAddress && addressForm && addressSummary) {
  btnCancelAddress.addEventListener("click", () => {
    applyAddressUI(currentUser);
    hide(addressForm);
    show(addressSummary);
    if (btnEditAddress) btnEditAddress.style.display = "inline-block";
  });
}

if (addressForm) {
  addressForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const meta = currentUser.user_metadata || {};

    const updatedMeta = {
      ...meta,
      ship_name: (shipNameInput?.value || "").trim() || null,
      ship_line1: (shipLine1Input?.value || "").trim() || null,
      ship_line2: (shipLine2Input?.value || "").trim() || null,
      ship_city: (shipCityInput?.value || "").trim() || null,
      ship_state: (shipStateInput?.value || "").trim() || null,
      ship_zip: (shipZipInput?.value || "").trim() || null,
      ship_country: shipCountrySelect?.value || null,
    };

    try {
      const { data, error } = await supabase.auth.updateUser({
        data: updatedMeta,
      });
      if (error) {
        console.error("Error saving shipping address:", error);
        alert("There was a problem saving your shipping address.");
        return;
      }
      currentUser = data.user;
      applyAddressUI(currentUser);
      hide(addressForm);
      show(addressSummary);
      if (btnEditAddress) btnEditAddress.style.display = "inline-block";
    } catch (err) {
      console.error("Error saving shipping address:", err);
      alert("There was a problem saving your shipping address.");
    }
  });
}

// ---- EVENTS: STATUS & SECURITY ----

if (vacationToggle) {
  vacationToggle.addEventListener("change", async () => {
    if (!currentUser) return;
    const meta = currentUser.user_metadata || {};
    const updatedMeta = { ...meta, vacation_on: vacationToggle.checked };

    try {
      const { data, error } = await supabase.auth.updateUser({
        data: updatedMeta,
      });
      if (error) {
        console.error("Error updating vacation status:", error);
        alert("There was a problem saving your vacation status.");
        return;
      }
      currentUser = data.user;
    } catch (err) {
      console.error("Error updating vacation status:", err);
      alert("There was a problem saving your vacation status.");
    }
  });
}

if (btnChangePassword) {
  btnChangePassword.addEventListener("click", async () => {
    if (!currentUser?.email) {
      alert("We need an email on your account to send a reset link.");
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        currentUser.email,
        {
          redirectTo: window.location.origin + "/auth.html",
        }
      );
      if (error) {
        console.error("Error sending reset email:", error);
        alert("There was a problem sending the reset link. Please try again.");
        return;
      }
      alert("Check your email for a password reset link.");
    } catch (err) {
      console.error("Error sending reset email:", err);
      alert("There was a problem sending the reset link. Please try again.");
    }
  });
}

if (btnStripe) {
  btnStripe.addEventListener("click", () => {
    window.open("https://dashboard.stripe.com/login", "_blank", "noopener");
  });
}
