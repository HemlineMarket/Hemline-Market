// File: public/scripts/store-name-validation.js
// Validates store names for uniqueness and blocks offensive content

(function(){
  'use strict';

  // Offensive words blocklist (case-insensitive)
  const BLOCKED_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'damn', 'crap', 'piss', 'cunt', 'dick', 'cock',
    'nazi', 'hitler', 'kkk', 'nigger', 'nigga', 'faggot', 'fag', 'retard',
    'porn', 'xxx', 'sex', 'nude', 'naked', 'pussy', 'penis', 'vagina',
    'hemline', 'hemlinemarket', 'official', 'admin', 'support', 'moderator', 'staff',
    'verified', 'authentic', 'legit', 'trusted', 'real'
  ];

  // Additional patterns to block
  const BLOCKED_PATTERNS = [
    /\d{3,}/,
    /@/,
    /https?:/i,
    /\.com|\.net|\.org/i
  ];

  function checkOffensiveContent(text){
    if(!text) return { isOffensive: false, reason: null };

    const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    const withSpaces = text.toLowerCase();

    for(const word of BLOCKED_WORDS){
      if(normalized.includes(word) || withSpaces.includes(word)){
        return {
          isOffensive: true,
          reason: "This store name is not allowed. Please choose a different name."
        };
      }
    }

    for(const pattern of BLOCKED_PATTERNS){
      if(pattern.test(text)){
        return {
          isOffensive: true,
          reason: "Store names cannot contain number sequences, emails, or URLs."
        };
      }
    }

    return { isOffensive: false, reason: null };
  }

  async function checkStoreNameAvailability(storeName, storeSlug, currentUserId){
    if(!storeName && !storeSlug){
      return { isAvailable: true, reason: null };
    }

    const supabase = window.__hm_supabase || window.supabase_client || (window.HM && window.HM.supabase);
    if(!supabase){
      console.warn("[store-validation] No supabase client");
      return { isAvailable: true, reason: null };
    }

    try {
      let query = supabase
        .from("profiles")
        .select("id, store_name, store_slug");

      if(storeName && storeSlug){
        query = query.or(`store_name.ilike.${storeName},store_slug.eq.${storeSlug}`);
      } else if(storeName){
        query = query.ilike("store_name", storeName);
      } else if(storeSlug){
        query = query.eq("store_slug", storeSlug);
      }

      if(currentUserId){
        query = query.neq("id", currentUserId);
      }

      const { data: existing, error } = await query.limit(1);

      if(error){
        console.warn("[store-validation] Query error:", error);
        return { isAvailable: true, reason: null };
      }

      if(existing && existing.length > 0){
        return {
          isAvailable: false,
          reason: "This store name is already taken. Please choose a different name."
        };
      }

      return { isAvailable: true, reason: null };
    } catch(e){
      console.error("[store-validation] Exception:", e);
      return { isAvailable: true, reason: null };
    }
  }

  async function validateStoreName(storeName, storeSlug, currentUserId){
    // First check for offensive content
    const offensiveCheck = checkOffensiveContent(storeName);
    if(offensiveCheck.isOffensive){
      return {
        isValid: false,
        reason: offensiveCheck.reason
      };
    }

    // Then check availability
    const availabilityCheck = await checkStoreNameAvailability(storeName, storeSlug, currentUserId);
    if(!availabilityCheck.isAvailable){
      return {
        isValid: false,
        reason: availabilityCheck.reason
      };
    }

    return { isValid: true, reason: null };
  }

  // Export to window
  window.HM = window.HM || {};
  window.HM.storeValidation = {
    checkOffensive: checkOffensiveContent,
    checkAvailability: checkStoreNameAvailability,
    validate: validateStoreName
  };

})();
