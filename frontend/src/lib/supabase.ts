import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export const supabaseOptions = {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: typeof window === "undefined" ? undefined : window.sessionStorage,
  },
};

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  if (!browserClient) {
    browserClient = createClient(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_ANON_KEY,
      supabaseOptions,
    );
  }

  return browserClient;
}
