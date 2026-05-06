/**
 * Client Supabase partagé — lazy init.
 * Initialisé seulement au premier appel, après que process.env a été injecté par worker.js.
 */
import { createClient } from '@supabase/supabase-js';

let _client = null;

export function getSupabase() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SECRET_KEY || ''
    );
  }
  return _client;
}
