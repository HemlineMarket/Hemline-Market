// public/scripts/account-auth.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// ---- CONFIG ----
const SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// ---- DOM HELPERS ----
function $(id) {
  return document.getElementById(id);
}
function show(el) {
  if (el) el.classList.remove("hidden");
}
function hide(el) {
  if (el) el.classList.add("hidden");
}

// ---- INITIALS + AVATAR ----
function getInitialsFromMeta(meta, email) {
  const first = (meta.first_name || "").trim();
  const last = (meta.last_name || "").trim();
  const display = (meta.display_name || "").trim();

  // Strong preference: first + last → RK
  if (first && last) {
    return (first[0] + last[0]).toUpperCase();
  }

  // Only first or only last
  if (first && !last) {
    return first.slice(0, 2).toUpperCase();
  }
  if (!first && last) {
    return last.slice(0, 2).toUpperCase();
  }

  // Display name
  if (display) {
    const parts = display.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return display.slice(0, 2).toUpperCase();
  }

  // Email fallback
  if (email) {
    const local = email.split("@")[0] || "";
    return local.slice(0, 2).toUpperCase() || "HM";
  }

  return "HM";
}

function avatarStorageKey(userId) {
  return `hm-avatar-${userId}`;
}

function saveAvatar(user, dataUrl) {
  if (!user?.id) return;
  try {
    localStorage.setItem(avatarStorageKey(user.id), dataUrl);
  } catch (e) {
    console.warn("Unable to save avatar", e);
  }
}

function loadAvatar(user) {
  if (!user?.id) return null;
  try {
    return localStorage.getItem(avatarStorageKey(user.id));
  } catch {
    return null;
  }
}

function applyAvatarToElements(user, meta) {
  const avatarUrl = loadAvatar(user);
  const headerAvatar = $("headerAvatar");
  const profileAvatar = $("profileAvatar");
  const initials = getInitialsFromMeta(meta, user.email);

  if (avatarUrl) {
    if (headerAvatar) {
      headerAvatar.style.backgroundImage = `url(${avatarUrl})`;
      headerAvatar.textContent = "";
    }
    if (profileAvatar) {
      profileAvatar.style.backgroundImage = `url(${avatarUrl})`;
      profileAvatar.textContent = "";
    }
  } else {
    if (headerAvatar) {
      headerAvatar.style.backgroundImage = "";
      headerAvatar.textContent = initials;
    }
    if (profileAvatar) {
      profileAvatar.style.backgroundImage = "";
      profileAvatar.textContent = initials;
    }
  }
}

// ---- PROFILE & SHIPPING HELPERS ----
function mergeProfileSource(user, profileRow) {
  const meta = user.user_metadata || {};
  const fullName =
    (meta.first_name || meta.last_name)
      ? `${meta.first_name || ""} ${meta.last_name || ""}`.trim()
      : profileRow?.full_name || meta.display_name || user.email || "Hemline member";

  const location = meta.location || profileRow?.location || "";
  const bio = meta.bio || profileRow?.bio || "";
  const website = meta.website || profileRow?.website || "";
  const instagram = meta.instagram || profileRow?.instagram || "";
  const tiktok = meta.tiktok || profileRow?.tiktok || "";
  const shopName = meta.shop_name || profileRow?.shop_name || "";

  return {
    fullName,
    location,
    bio,
    website,
    instagram,
    tiktok,
    shopName,
  };
}

function formatAddressSummary(meta) {
  const name = (meta.ship_name || "").trim();
  const a1 = (meta.ship_address1 || "").trim();
  const a2 = (meta.ship_address2 || "").trim();
  const city = (meta.ship_city || "").trim();
  const state = (meta.ship_state || "").trim();
  const postal = (meta.ship_postal || "").trim();
  const country = (meta.ship_country || "").trim();

  const lines = [];

  if (name) lines.push(name);
  if (a1) lines.push(a1);
  if (a2) lines.push(a2);

  const cityStateLine = [city, state].filter(Boolean).join(", ");
  const lastLineParts = [];
  if (cityStateLine) lastLineParts.push(cityStateLine);
  if (postal) lastLineParts.push(postal);
  if (lastLineParts.length) lines.push(lastLineParts.join(" "));

  if (country) lines.push(country);

  if (!lines.length) {
    return "Add your ship-from name and address.";
  }

  return lines.join("\n");
}

// ---- SUPABASE: LOAD PROFILE ROW ----
async function fetchOrCreateProfileRow(user) {
  if (!user?.id) return null;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, location, bio, website, instagram, tiktok, shop_name, completed_count, on_time_pct")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("Error loading profiles row", error);
    }

    if (data) return data;

    // Make a basic row if none exists yet
    const meta = user.user_metadata || {};
    const guessedName =
      (meta.first_name || meta.last_name)
        ? `${meta.first_name || ""} ${meta.last_name || ""}`.trim()
        : meta.display_name || user.email || "Hemline member";

    const { data: inserted, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: user.id,
        full_name: guessedName,
        location: meta.location || "",
        bio: meta.bio || "",
        website: meta.website || "",
        instagram: meta.instagram || "",
        tiktok: meta.tiktok || "",
        shop_name: meta.shop_name || "",
        completed_count: 0,
        on_time_pct: 0,
      })
      .select("*")
      .single();

    if (insertError) {
      console.warn("Error creating profiles row", insertError);
      return null;
    }

    return inserted;
  } catch (e) {
    console.error("Unexpected error loading profile row", e);
    return null;
  }
}

// ---- APPLY DATA TO ACCOUNT PAGE ----
function applyAccountProfileUI(user, merged) {
  const meta = user.user_metadata || {};

  const summaryName = $("summaryName");
  const summaryEmail = $("summaryEmail");
  const summaryLocation = $("summaryLocation");
  const summaryBio = $("summaryBio");

  if (summaryName) summaryName.textContent = merged.fullName;
  if (summaryEmail) summaryEmail.textContent = user.email || "";
  if (summaryLocation) summaryLocation.textContent = merged.location || "";
  if (summaryBio) summaryBio.textContent = merged.bio || "";

  // Fill profile form
  const firstInput = $("profileFirst");
  const lastInput = $("profileLast");
  const locInput = $("profileLocation");
  const shopInput = $("profileShop");
  const webInput = $("profileWebsite");
  const instaInput = $("profileInsta");
  const tiktokInput = $("profileTiktok");
  const bioInput = $("profileBio");

  if (firstInput) firstInput.value = meta.first_name || "";
  if (lastInput) lastInput.value = meta.last_name || "";
  if (locInput) locInput.value = merged.location || "";
  if (shopInput) shopInput.value = merged.shopName || "";
  if (webInput) webInput.value = merged.website || "";
  if (instaInput) instaInput.value = merged.instagram || "";
  if (tiktokInput) tiktokInput.value = merged.tiktok || "";
  if (bioInput) bioInput.value = merged.bio || "";
}

function applyAccountAddressUI(user) {
  const meta = user.user_metadata || {};
  const shipSummary = $("shipSummary");
  if (shipSummary) {
    shipSummary.textContent = formatAddressSummary(meta);
  }

  // Always pre-fill the edit form with current meta so it doesn't "wipe" on edit
  const shipName = $("shipName");
  const shipAddress1 = $("shipAddress1");
  const shipAddress2 = $("shipAddress2");
  const shipCity = $("shipCity");
  const shipState = $("shipState");
  const shipPostal = $("shipPostal");
  const shipCountry = $("shipCountry");

  if (shipName) shipName.value = meta.ship_name || "";
  if (shipAddress1) shipAddress1.value = meta.ship_address1 || "";
  if (shipAddress2) shipAddress2.value = meta.ship_address2 || "";
  if (shipCity) shipCity.value = meta.ship_city || "";
  if (shipState) shipState.value = meta.ship_state || "";
  if (shipPostal) shipPostal.value = meta.ship_postal || "";
  if (shipCountry && meta.ship_country) {
    shipCountry.value = meta.ship_country;
  }
}

// ---- SAVE PROFILE ----
async function handleProfileSave(e, user, profileRow) {
  e.preventDefault();
  if (!user) return;

  const meta = user.user_metadata || {};

  const first = ($("profileFirst")?.value || "").trim();
  const last = ($("profileLast")?.value || "").trim();
  const location = ($("profileLocation")?.value || "").trim();
  const shopName = ($("profileShop")?.value || "").trim();
  const website = ($("profileWebsite")?.value || "").trim();
  const instagram = ($("profileInsta")?.value || "").trim();
  const tiktok = ($("profileTiktok")?.value || "").trim();
  const bio = ($("profileBio")?.value || "").trim();

  const fullName =
    (first || last)
      ? `${first || ""} ${last || ""}`.trim()
      : profileRow?.full_name || meta.display_name || user.email || "Hemline member";

  // Build new metadata, preserving other keys (like shipping)
  const newMeta = {
    ...meta,
    first_name: first || null,
    last_name: last || null,
    display_name: fullName,
    location: location || null,
    shop_name: shopName || null,
    website: website || null,
    instagram: instagram || null,
    tiktok: tiktok || null,
    bio: bio || null,
  };

  const profileForm = $("profileForm");
  const summaryName = $("summaryName");
  const summaryLocation = $("summaryLocation");
  const summaryBio = $("summaryBio");

  try {
    const { data: updatedUserData, error: userErr } = await supabase.auth.updateUser({
      data: newMeta,
    });

    if (userErr) {
      console.error("Error updating auth user", userErr);
      alert("There was a problem saving your profile. Please try again.");
      return;
    }

    const updatedUser = updatedUserData.user;
    const updatedMeta = updatedUser.user_metadata || {};

    // Sync to profiles table for public Atelier
    const { data: profileUpserted, error: profileErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: updatedUser.id,
          full_name: fullName,
          location,
          bio,
          website,
          instagram,
          tiktok,
          shop_name: shopName,
        },
        { onConflict: "id" }
      )
      .select("*")
      .single();

    if (profileErr) {
      console.warn("Error upserting profiles row", profileErr);
      // Not fatal; Atelier will just lag until next save succeeds.
    }

    // Update UI summaries
    const merged = mergeProfileSource(updatedUser, profileUpserted || profileRow || null);
    if (summaryName) summaryName.textContent = merged.fullName;
    if (summaryLocation) summaryLocation.textContent = merged.location || "";
    if (summaryBio) summaryBio.textContent = merged.bio || "";

    // Update avatar initials in case name changed
    applyAvatarToElements(updatedUser, updatedMeta);

    if (profileForm) {
      hide(profileForm);
    }
  } catch (e2) {
    console.error(e2);
    alert("There was a problem saving your profile. Please try again.");
  }
}

// ---- SAVE ADDRESS ----
async function handleAddressSave(e, user) {
  e.preventDefault();
  if (!user) return;

  const meta = user.user_metadata || {};

  const shipName = ($("shipName")?.value || "").trim();
  const shipAddress1 = ($("shipAddress1")?.value || "").trim();
  const shipAddress2 = ($("shipAddress2")?.value || "").trim();
  const shipCity = ($("shipCity")?.value || "").trim();
  const shipState = ($("shipState")?.value || "").trim();
  const shipPostal = ($("shipPostal")?.value || "").trim();
  const shipCountry = $("shipCountry")?.value || "United States";

  const newMeta = {
    ...meta,
    ship_name: shipName || null,
    ship_address1: shipAddress1 || null,
    ship_address2: shipAddress2 || null,
    ship_city: shipCity || null,
    ship_state: shipState || null,
    ship_postal: shipPostal || null,
    ship_country: shipCountry || null,
  };

  const addressForm = $("addressForm");
  const shipSummary = $("shipSummary");

  try {
    const { data: updatedUserData, error } = await supabase.auth.updateUser({
      data: newMeta,
    });

    if (error) {
      console.error("Error saving address", error);
      alert("There was a problem saving your shipping address. Please try again.");
      return;
    }

    const updatedUser = updatedUserData.user;
    const updatedMeta = updatedUser.user_metadata || {};

    if (shipSummary) {
      shipSummary.textContent = formatAddressSummary(updatedMeta);
    }
    if (addressForm) {
      hide(addressForm);
    }
  } catch (e2) {
    console.error(e2);
    alert("There was a problem saving your shipping address. Please try again.");
  }
}

// ---- AVATAR UPLOAD ----
function wireAvatarUpload(user) {
  const btnEditPhoto = $("btnEditPhoto");
  const fileInput = $("avatarInput");
  if (!btnEditPhoto || !fileInput || !user) return;

  btnEditPhoto.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (!dataUrl) return;

      saveAvatar(user, dataUrl);
      applyAvatarToElements(user, user.user_metadata || {});
    };
    reader.readAsDataURL(file);
  });
}

// ---- HEADER NAV BUTTONS ON ACCOUNT ----
function wireAccountShortcuts() {
  const btnPurchases = $("btnPurchases");
  const btnSales = $("btnSales");
  const btnAtelier = $("btnYourAtelier");

  if (btnPurchases) {
    btnPurchases.addEventListener("click", () => {
      window.location.href = "purchases.html";
    });
  }
  if (btnSales) {
    btnSales.addEventListener("click", () => {
      window.location.href = "sales.html";
    });
  }
  if (btnAtelier) {
    btnAtelier.addEventListener("click", () => {
      window.location.href = "atelier.html";
    });
  }
}

// ---- LOGOUT ----
function wireLogout() {
  const btnLogout = $("btnLogout");
  if (!btnLogout) return;

  btnLogout.addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "index.html";
  });
}

// ---- GLOBAL HEADER (ON ANY PAGE THAT HAS headerAvatar) ----
async function initHeaderForAnyPage(user) {
  const headerAvatar = $("headerAvatar");
  if (!headerAvatar) return;

  if (!user) {
    // Not logged in → show generic initials or hide
    headerAvatar.textContent = "HM";
    headerAvatar.style.backgroundImage = "";
    return;
  }

  const meta = user.user_metadata || {};
  applyAvatarToElements(user, meta);
}

// ---- MAIN INIT ----
(async () => {
  let user = null;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      console.error("Error getting current user", error);
    }
    user = data?.user || null;
  } catch (e) {
    console.error("Error getting current user", e);
  }

  // Header initials/avatar for any page
  await initHeaderForAnyPage(user);

  const onAccountPage = !!$("summaryName");

  // If we're on the Account page and there is no user, send them to sign-in
  if (onAccountPage && !user) {
    window.location.href = "auth.html";
    return;
  }

  if (!onAccountPage || !user) {
    // Nothing else to wire on non-account pages here
    return;
  }

  // ACCOUNT PAGE: load profile + address + avatar
  const profileRow = await fetchOrCreateProfileRow(user);
  const merged = mergeProfileSource(user, profileRow || null);

  applyAccountProfileUI(user, merged);
  applyAccountAddressUI(user);
  applyAvatarToElements(user, user.user_metadata || {});
  wireAvatarUpload(user);
  wireAccountShortcuts();
  wireLogout();

  // Wire profile form submit
  const profileForm = $("profileForm");
  if (profileForm) {
    profileForm.addEventListener("submit", (e) => handleProfileSave(e, user, profileRow));
  }

  // Wire address form submit
  const addressForm = $("addressForm");
  if (addressForm) {
    addressForm.addEventListener("submit", (e) => handleAddressSave(e, user));
  }
})();
