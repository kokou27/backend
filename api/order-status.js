import { getSupabase } from '../_lib/supabase.js';

export default async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const fetchToken = String(req.query?.fetch_token || '').trim();
  if (!fetchToken) return res.status(400).json({ error: 'fetch_token requis' });

  const supabase = getSupabase();

  const { data: tx, error } = await supabase
    .from('transactions')
    .select('user_id, amount, metadata')
    .eq('metadata->>fetch_token', fetchToken)
    .eq('type', 'purchase')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Erreur serveur' });
  if (!tx) return res.status(200).json({ status: 'pending' });

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('secret_token, credit_balance')
    .eq('id', tx.user_id)
    .maybeSingle();

  if (userError || !user) return res.status(200).json({ status: 'pending' });

  return res.status(200).json({
    status: 'ready',
    code: user.secret_token,
    credits_added: tx.amount,
    credit_balance: user.credit_balance,
  });
};
