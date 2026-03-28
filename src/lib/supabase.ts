import { createClient, SupabaseClient } from "@supabase/supabase-js";

const globalForSupabase = globalThis as unknown as {
  supabase: SupabaseClient;
};

function createSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

/** Lazy-initialized Supabase client (avoids crash when env vars missing in tests) */
export function getSupabase(): SupabaseClient {
  if (!globalForSupabase.supabase) {
    globalForSupabase.supabase = createSupabaseClient();
  }
  return globalForSupabase.supabase;
}

export const MEDIA_BUCKET = "media";
