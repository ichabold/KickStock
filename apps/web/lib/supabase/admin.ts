/**
 * Supabase admin client using the Service Role Key.
 * ONLY for server-side API routes — NEVER import this in client components.
 * The service role key bypasses RLS, allowing admin operations.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY env var. ' +
      'Add it to .env.local — find it in Supabase dashboard → Settings → API.'
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false },
  });
}
