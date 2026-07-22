import { getSupabase } from '../_lib/supabase.js';

export default async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email invalide' });

  const supabase = getSupabase();

  const { data: user, error } = await supabase
    .from('users')
    .select('secret_token, credit_balance')
    .eq('email', email)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Erreur serveur' });

  if (!user || !user.secret_token) {
    return res.status(200).json({
      found: false,
      message: "Si cet email correspond à un achat, vous auriez déjà reçu ou pu récupérer un code. Vérifiez l'orthographe ou contactez le support.",
    });
  }

  return res.status(200).json({ found: true, code: user.secret_token, credit_balance: user.credit_balance });
};
