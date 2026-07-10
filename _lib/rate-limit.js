/**
 * Gate for backend routes that don't carry their own credit/quota logic
 * (TTS, bubble detection). Ties the call to a known extension install and
 * enforces the same per-minute cap /api/use applies to paid vs free users,
 * so these routes can't be hit anonymously/unboundedly.
 */
import { getSupabase } from './supabase.js';

export async function checkRateLimit(extension_id, { freeLimit = 5, paidLimit = 15 } = {}) {
  const supabase = getSupabase();
  const now = new Date();

  let { data: user } = await supabase
    .from('users')
    .select('id, credit_balance, scans_this_minute, last_scan_minute')
    .eq('extension_id', extension_id)
    .maybeSingle();

  if (!user) {
    const { data: created } = await supabase
      .from('users')
      .insert([{
        extension_id,
        credit_balance: 0,
        scans_today: 0,
        scans_this_minute: 0,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      }])
      .select('id, credit_balance, scans_this_minute, last_scan_minute')
      .maybeSingle();
    user = created;
  }

  if (!user) return { ok: false, status: 500, error: 'SERVER_ERROR' };

  const lastMinute = user.last_scan_minute ? new Date(user.last_scan_minute) : null;
  const secondsElapsed = lastMinute ? (now - lastMinute) / 1000 : 999;
  const scansThisMinute = secondsElapsed < 60 ? (user.scans_this_minute || 0) : 0;
  const limit = (user.credit_balance || 0) > 0 ? paidLimit : freeLimit;

  if (scansThisMinute >= limit) {
    return { ok: false, status: 429, error: 'RATE_LIMIT' };
  }

  await supabase.from('users').update({
    scans_this_minute: scansThisMinute + 1,
    last_scan_minute: now.toISOString(),
    updated_at: now.toISOString(),
  }).eq('id', user.id);

  return { ok: true };
}
