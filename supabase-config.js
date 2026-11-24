
/* =========================================================
   FRATEL-AGRIPREDICT
   Supabase Client Configuration
   ========================================================= */

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
