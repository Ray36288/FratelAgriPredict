
/* =========================================================
   FRATEL-AGRIPREDICT
   Supabase Client Configuration
   ========================================================= */

// Retire legacy browser-only farm records. Do not touch Supabase Auth's
// own persisted session; it is required to keep the farmer signed in.
(() => {
    const retiredFarmKeys = [
        "agripredict_broiler_v1", "agripredict_broiler_active",
        "agripredict_broiler_feed_v1", "agripredict_feed_formula_draft",
        "agripredict_portfolio_owner_v1", "agripredict_farm_inventory_v1",
        "agripredict_farm_expenses_v1"
    ];
    try {
        retiredFarmKeys.forEach(key => localStorage.removeItem(key));
        sessionStorage.removeItem("agriUsername");
    } catch (error) {
        console.warn("Could not clear retired browser farm records:", error);
    }
})();

// Supabase project URL
const SUPABASE_URL = "https://fwtlqktjkwldomwuupgw.supabase.co";

// Supabase Publishable Key
const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_-2BxyQZHYoe2w_vFrH-siw_YnvnZH12";

// Prevent duplicate Supabase client initialization
if (!window.supabaseClient) {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.error(
            "Supabase library is missing. Load the Supabase JavaScript CDN before supabase-config.js."
        );
    } else {
        window.supabaseClient = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY
        );

        console.log("Fratel-AgriPredict Supabase client initialized.");
    }
}

// Make the client accessible to the rest of the application
var supabaseClient = window.supabaseClient;
