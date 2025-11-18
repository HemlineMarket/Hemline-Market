<script>
// public/scripts/account-auth.js

// -------- Supabase client --------
const HM_SUPABASE_URL = "https://clkizksbvxjkoatdajgd.supabase.co";
const HM_SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNsa2l6a3Nidnhqa29hdGRhamdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2ODAyMDUsImV4cCI6MjA3MDI1NjIwNX0.m3wd6UAuqxa7BpcQof9mmzd8zdsmadwGDO0x7-nyBjI";

const supabase = window.supabase.createClient(HM_SUPABASE_URL, HM_SUPABASE_ANON);

// -------- Small helpers --------
function byId(id) { return document.getElementById(id); }

function safeText(el, value) {
  if (!el) return;
  el.textContent = value || "";
}

function initialsFromName(first, last) {
  const a = (first || "").trim()[0] || "";
  const b = (last  || "").trim()[0] || "";
  return (a + b || "HM").toUpperCase();
}

// For shop URL slug: no dashes, only letters/numbers, lower-case.
function normalizeShopSlug(str) {
  if (!str) return "";
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Build a base slug if no shop name is provided
function baseSlugFromName(first, last) {
  const f = (first || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const l = (last  || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (f && l) return f + l;
  return f || l || "";
}

// Find a unique shop_slug, appending numbers if needed
async function ensureUniqueShopSlug(userId, requestedSlug) {
  if (!requestedSlug) return null;

  let candidate = requestedSlug;
  let suffix = 2;

  while (true) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("shop_slug", candidate)
      .maybeSingle();

    if (error) {
      console.error("Error checking shop slug", error);
      return candidate; // fall back rather than blocking
    }
    if (!data || data.id === userId) {
      // Free or belongs to this user → OK
      return candidate;
    }
    candidate = requestedSlug + String(suffix++);
  }
}

// USPS ZIP lookup via backend proxy
// This expects you to expose a backend endpoint like:
//   GET /api/usps-zip?zip=03079  -> { city: "Salem", state: "NH" }
async function lookupZip(zip) {
  if (!zip || zip.length !== 5) return null;
  try {
    const res = await fetch(`/api/usps-zip?zip=${encodeURIComponent(zip)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.city || !data.state) return null;
    return { city: data.city, state: data.state };
  } catch (e) {
    console.warn("ZIP lookup failed", e);
    return null;
  }
}

// Populate city/state when ZIP is filled, but don’t fight the user
async function handleZipAutoFill() {
  const zipInput   = byId("shipPostal");
  const cityInput  = byId("shipCity");
  const stateInput = byId("shipState");
  if (!zipInput || !cityInput || !stateInput) return;

  const zip = zipInput.value.trim();
  if (zip.length !== 5) return;

  const result = await lookupZip(zip);
  if (!result) return;

  if (!cityInput.value.trim())  cityInput.value  = result.city;
  if (!stateInput.value.trim()) stateInput.value = result.state;
}

// -------- Load + wire everything --------
document.addEventListener("DOMContentLoaded", () => {
  initAccountPage().catch(err => {
    console.error(err);
    alert("There was a problem loading your account. Please refresh.");
  });
});

async function initAccountPage() {
  // 1) Require auth
  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError) {
    console.error(sessionError);
  }

  if (!session || !session.user) {
    // Logged out → send to auth
    window.location.href = "auth.html";
    return;
  }

  const user = session.user;

  // 2) Load or create profile row
  const profile = await loadOrCreateProfile(user);

  // 3) Fill summary and forms
  hydrateProfileSummary(user, profile);
  hydrateProfileForm(user, profile);
  hydrateAddress(profile);

  // 4) Wire actions
  wireProfileForm(user, profile);
  wireAddressForm(user, profile);
  wireAvatarUpload(user);
  wireBasicButtons();
}

// -------- Profile load / create --------
async function loadOrCreateProfile(user) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Error loading profile", error);
    throw error;
  }

  if (data) return data;

  // Create a minimal profile row for this user
  const first = (user.user_metadata && user.user_metadata.first_name) || "";
  const last  = (user.user_metadata && user.user_metadata.last_name) || "";
  const initialSlug = baseSlugFromName(first, last);

  const insert = {
    id: user.id,
    email: user.email,
    first_name: first,
    last_name: last,
    shop_name: null,
    shop_slug: initialSlug || null,
    created_at: new Date().toISOString()
  };

  const { data: created, error: insertError } = await supabase
    .from("profiles")
    .insert(insert)
    .select("*")
    .single();

  if (insertError) {
    console.error("Error creating profile", insertError);
    throw insertError;
  }

  return created;
}

// -------- Hydrate UI --------
function hydrateProfileSummary(user, profile) {
  const first = profile.first_name || "";
  const last  = profile.last_name || "";

  safeText(byId("summaryName"), first || last ? `${first} ${last}`.trim() : user.email);
  safeText(byId("summaryEmail"), user.email || "");

  const loc  = profile.location || "";
  const bio  = profile.bio || profile.shop_story || "";
  safeText(byId("summaryLocation"), loc);
  safeText(byId("summaryBio"), bio);

  const avatar = byId("profileAvatar");
  if (avatar) {
    if (profile.avatar_url) {
      avatar.textContent = "";
      avatar.style.backgroundImage = `url(${profile.avatar_url})`;
      avatar.style.backgroundSize = "cover";
      avatar.style.backgroundPosition = "center";
    } else {
      avatar.style.backgroundImage = "none";
      avatar.textContent = initialsFromName(first, last);
    }
  }

  // Header initials should always be real name
  const headerAvatar = byId("headerAvatar");
  if (headerAvatar) {
    headerAvatar.textContent = initialsFromName(first, last);
  }
}

function hydrateProfileForm(user, profile) {
  if (byId("profileFirst"))   byId("profileFirst").value   = profile.first_name || "";
  if (byId("profileLast"))    byId("profileLast").value    = profile.last_name || "";
  if (byId("profileLocation"))byId("profileLocation").value= profile.location || "";
  if (byId("profileShop"))    byId("profileShop").value    = profile.shop_name || "";
  if (byId("profileWebsite")) byId("profileWebsite").value = profile.website || "";
  if (byId("profileInsta"))   byId("profileInsta").value   = profile.instagram || "";
  if (byId("profileTiktok"))  byId("profileTiktok").value  = profile.tiktok || "";
  if (byId("profileBio"))     byId("profileBio").value     = profile.bio || profile.shop_story || "";
}

function hydrateAddress(profile) {
  if (byId("shipName"))      byId("shipName").value      = profile.ship_name || "";
  if (byId("shipAddress1"))  byId("shipAddress1").value  = profile.ship_address1 || "";
  if (byId("shipAddress2"))  byId("shipAddress2").value  = profile.ship_address2 || "";
  if (byId("shipCity"))      byId("shipCity").value      = profile.ship_city || "";
  if (byId("shipState"))     byId("shipState").value     = profile.ship_state || "";
  if (byId("shipPostal"))    byId("shipPostal").value    = profile.ship_postal || "";
  if (byId("shipCountry"))   byId("shipCountry").value   = profile.ship_country || "United States";

  // Summary block
  const lines = [];
  if (profile.ship_name)      lines.push(profile.ship_name);
  if (profile.ship_address1)  lines.push(profile.ship_address1);
  if (profile.ship_address2)  lines.push(profile.ship_address2);
  const cityLine = [profile.ship_city, profile.ship_state, profile.ship_postal]
    .filter(Boolean)
    .join(", ")
    .replace(", ,", ",")
    .replace(",,", ",");
  if (cityLine) lines.push(cityLine);
  if (profile.ship_country)   lines.push(profile.ship_country);

  safeText(byId("shipSummary"), lines.join("\n"));

  // Wire ZIP auto-fill
  const zipInput = byId("shipPostal");
  if (zipInput) {
    zipInput.addEventListener("blur", handleZipAutoFill);
    zipInput.addEventListener("input", () => {
      if (zipInput.value.trim().length === 5) handleZipAutoFill();
    });
  }
}

// -------- Profile form save --------
function wireProfileForm(user, profile) {
  const form = byId("profileForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const first = byId("profileFirst")   ? byId("profileFirst").value.trim()   : "";
    const last  = byId("profileLast")    ? byId("profileLast").value.trim()    : "";
    const loc   = byId("profileLocation")? byId("profileLocation").value.trim(): "";
    const shopName = byId("profileShop") ? byId("profileShop").value.trim()    : "";
    const website  = byId("profileWebsite") ? byId("profileWebsite").value.trim() : "";
    const insta    = byId("profileInsta")   ? byId("profileInsta").value.trim()   : "";
    const tiktok   = byId("profileTiktok")  ? byId("profileTiktok").value.trim()  : "";
    const bio      = byId("profileBio")     ? byId("profileBio").value.trim()     : "";

    // Build slug
    let base = shopName
      ? normalizeShopSlug(shopName)
      : baseSlugFromName(first || profile.first_name, last || profile.last_name);

    if (!base) base = normalizeShopSlug(user.email.split("@")[0] || "shop");

    const uniqueSlug = await ensureUniqueShopSlug(user.id, base);

    const update = {
      id: user.id,
      first_name: first || null,
      last_name: last || null,
      location: loc || null,
      shop_name: shopName || null,
      shop_slug: uniqueSlug || null,
      website: website || null,
      instagram: insta || null,
      tiktok: tiktok || null,
      bio: bio || null,
      shop_story: bio || null
    };

    const { error } = await supabase.from("profiles").upsert(update);

    if (error) {
      console.error("Profile save error", error);
      alert("There was a problem saving your profile. Please try again.");
      return;
    }

    alert("Profile saved.");

    // Refresh summary with new values
    const merged = Object.assign({}, profile, update);
    hydrateProfileSummary(user, merged);
  });
}

// -------- Address form save --------
function wireAddressForm(user, profile) {
  const form = byId("addressForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const shipName    = byId("shipName")     ? byId("shipName").value.trim()     : "";
    const addr1       = byId("shipAddress1") ? byId("shipAddress1").value.trim() : "";
    const addr2       = byId("shipAddress2") ? byId("shipAddress2").value.trim() : "";
    const city        = byId("shipCity")     ? byId("shipCity").value.trim()     : "";
    const state       = byId("shipState")    ? byId("shipState").value.trim()    : "";
    const postal      = byId("shipPostal")   ? byId("shipPostal").value.trim()   : "";
    const country     = byId("shipCountry")  ? byId("shipCountry").value.trim()  : "United States";

    const update = {
      id: user.id,
      ship_name: shipName || null,
      ship_address1: addr1 || null,
      ship_address2: addr2 || null,
      ship_city: city || null,
      ship_state: state || null,
      ship_postal: postal || null,
      ship_country: country || null
    };

    // Optional: if profile.location is empty, set it from city/state
    if (!profile.location && city && state) {
      update.location = `${city}, ${state}`;
    }

    const { error } = await supabase.from("profiles").upsert(update);

    if (error) {
      console.error("Address save error", error);
      alert("There was a problem saving your address. Please try again.");
      return;
    }

    alert("Shipping address saved.");

    const merged = Object.assign({}, profile, update);
    hydrateAddress(merged);
    hydrateProfileSummary(user, merged);
  });
}

// -------- Avatar upload --------
function wireAvatarUpload(user) {
  const editBtn  = byId("btnEditPhoto");
  const fileInput = byId("avatarInput");
  if (!editBtn || !fileInput) return;

  editBtn.addEventListener("click", (e) => {
    e.preventDefault();
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    try {
      const bucket = supabase.storage.from("avatars");
      const path = `${user.id}/${Date.now()}-${file.name}`;

      const { error: uploadError } = await bucket.upload(path, file, {
        cacheControl: "3600",
        upsert: true
      });

      if (uploadError) {
        console.error(uploadError);
        alert("Could not upload photo. Please try again.");
        return;
      }

      const { data } = bucket.getPublicUrl(path);
      const publicUrl = data && data.publicUrl;

      const { error: updateError } = await supabase
        .from("profiles")
        .upsert({ id: user.id, avatar_url: publicUrl });

      if (updateError) {
        console.error(updateError);
        alert("Photo uploaded but profile did not update. Please save profile again.");
        return;
      }

      // Apply immediately
      const avatar = byId("profileAvatar");
      if (avatar) {
        avatar.textContent = "";
        avatar.style.backgroundImage = `url(${publicUrl})`;
        avatar.style.backgroundSize = "cover";
        avatar.style.backgroundPosition = "center";
      }

      const headerAvatar = byId("headerAvatar");
      if (headerAvatar) {
        headerAvatar.textContent = "";
        headerAvatar.style.backgroundImage = `url(${publicUrl})`;
        headerAvatar.style.backgroundSize = "cover";
        headerAvatar.style.backgroundPosition = "center";
      }

    } catch (e) {
      console.error(e);
      alert("There was a problem uploading your photo.");
    } finally {
      fileInput.value = "";
    }
  });
}

// -------- Misc buttons (log out, etc.) --------
function wireBasicButtons() {
  const logoutBtn = byId("btnLogout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      await supabase.auth.signOut();
      window.location.href = "auth.html";
    });
  }

  const toAtelier = byId("btnYourAtelier");
  if (toAtelier) {
    toAtelier.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "atelier.html";
    });
  }

  const toPurchases = byId("btnPurchases");
  if (toPurchases) {
    toPurchases.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "purchases.html";
    });
  }

  const toSales = byId("btnSales");
  if (toSales) {
    toSales.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "sales.html";
    });
  }
}
</script>
