// File: public/scripts/vacation-check.js
// Utility for checking if a seller is on vacation hold

(function(){
  'use strict';

  // Get supabase client
  function getSupabase(){
    return window.__hm_supabase || window.supabase_client || (window.HM && window.HM.supabase);
  }

  /**
   * Check if a seller is on vacation
   * @param {string} sellerId - The seller's user ID
   * @returns {Promise<{onVacation: boolean, storeName: string|null}>}
   */
  async function checkSellerVacation(sellerId){
    if(!sellerId) return { onVacation: false, storeName: null };

    const supabase = getSupabase();
    if(!supabase){
      console.warn("[vacation-check] No supabase client available");
      return { onVacation: false, storeName: null };
    }

    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("vacation_mode, store_name, first_name, last_name")
        .eq("id", sellerId)
        .single();

      if(error){
        console.warn("[vacation-check] Profile fetch error:", error);
        return { onVacation: false, storeName: null };
      }

      const storeName = profile?.store_name || 
        (profile?.first_name ? `${profile.first_name}'s Shop` : null);

      return {
        onVacation: profile?.vacation_mode === true,
        storeName: storeName
      };
    } catch(e){
      console.error("[vacation-check] Exception:", e);
      return { onVacation: false, storeName: null };
    }
  }

  /**
   * Check multiple sellers at once
   * @param {string[]} sellerIds - Array of seller IDs
   * @returns {Promise<Map<string, {onVacation: boolean, storeName: string|null}>>}
   */
  async function checkSellersVacation(sellerIds){
    const results = new Map();
    
    if(!sellerIds || !sellerIds.length) return results;

    const supabase = getSupabase();
    if(!supabase){
      console.warn("[vacation-check] No supabase client available");
      return results;
    }

    try {
      const uniqueIds = [...new Set(sellerIds)];
      
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, vacation_mode, store_name, first_name, last_name")
        .in("id", uniqueIds);

      if(error){
        console.warn("[vacation-check] Profiles fetch error:", error);
        return results;
      }

      (profiles || []).forEach(profile => {
        const storeName = profile.store_name || 
          (profile.first_name ? `${profile.first_name}'s Shop` : null);
        
        results.set(profile.id, {
          onVacation: profile.vacation_mode === true,
          storeName: storeName
        });
      });

      return results;
    } catch(e){
      console.error("[vacation-check] Exception:", e);
      return results;
    }
  }

  /**
   * Block checkout if any seller in cart is on vacation
   * @param {Array} cartItems - Cart items with sellerId property
   * @returns {Promise<{canCheckout: boolean, blockedSellers: Array}>}
   */
  async function validateCartForVacation(cartItems){
    if(!cartItems || !cartItems.length){
      return { canCheckout: true, blockedSellers: [] };
    }

    const sellerIds = cartItems
      .map(item => item.sellerId || item.seller_id)
      .filter(Boolean);

    if(!sellerIds.length){
      return { canCheckout: true, blockedSellers: [] };
    }

    const vacationStatus = await checkSellersVacation(sellerIds);
    const blockedSellers = [];

    cartItems.forEach(item => {
      const sellerId = item.sellerId || item.seller_id;
      const status = vacationStatus.get(sellerId);
      
      if(status?.onVacation){
        blockedSellers.push({
          sellerId,
          storeName: status.storeName || 'Unknown seller',
          itemName: item.name || item.title || 'Item'
        });
      }
    });

    return {
      canCheckout: blockedSellers.length === 0,
      blockedSellers
    };
  }

  // Export to window
  window.HM = window.HM || {};
  window.HM.vacation = {
    checkSeller: checkSellerVacation,
    checkSellers: checkSellersVacation,
    validateCart: validateCartForVacation
  };

})();
