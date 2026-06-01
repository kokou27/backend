// api/credits.js — Vercel Serverless Function
// GET /api/credits?extensionId=xxx

import { getSupabase } from '../_lib/supabase.js';
import { normalizeInstallId } from '../_lib/install-id.js';

export default async (req, res) => {
  const supabase = getSupabase();

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const extensionId = normalizeInstallId(req.query?.extensionId);
  const secretToken = req.headers['x-secret-token'];

  if (!extensionId) {
    return res.status(400).json({ error: 'extensionId invalide (32 hex)' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('credit_balance, scans_today, last_scan_date, created_at, secret_token')
    .eq('extension_id', extensionId)
    .single();

  if (error || !user) {
    // Utilisateur pas encore créé → 0 crédits
    return res.status(200).json({
      credit_balance: 0,
      scans_today: 0,
    });
  }

  // Rejeter seulement si un MAUVAIS token est fourni (pas s'il est absent)
  if (user.secret_token && secretToken && user.secret_token !== secretToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // Reset scans_today si nouveau jour
  const today = new Date().toISOString().split('T')[0];
  const scansToday = user.last_scan_date === today ? user.scans_today : 0;

  return res.status(200).json({
    credit_balance: user.credit_balance,
    scans_today: scansToday,
  });
};
