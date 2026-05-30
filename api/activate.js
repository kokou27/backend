import { getSupabase } from '../_lib/supabase.js';

const MAX_ACTIVATIONS = 3; // Même code utilisable sur max 3 appareils (reinstall inclus)

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { activation_code, extension_id } = req.body;

  if (!activation_code || typeof activation_code !== 'string' || activation_code.length < 10) {
    return res.status(400).json({ error: 'Code d\'activation invalide' });
  }
  if (!extension_id || typeof extension_id !== 'string' || extension_id.length < 5) {
    return res.status(400).json({ error: 'extension_id requis' });
  }

  const supabase = getSupabase();

  // Trouver le compte par secret_token
  const { data: user, error } = await supabase
    .from('users')
    .select('id, credit_balance, email, extension_id, activation_count')
    .eq('secret_token', activation_code.trim())
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Erreur serveur' });
  if (!user) return res.status(404).json({
    error: 'Code invalide',
    message: 'Code d\'activation introuvable. Vérifiez votre email.',
  });

  // Si déjà activé sur ce même appareil → OK sans compter
  const isSameDevice = user.extension_id === extension_id;
  const activationCount = user.activation_count || 0;

  // Bloquer si trop d'appareils différents (fraude probable)
  if (!isSameDevice && activationCount >= MAX_ACTIVATIONS) {
    return res.status(403).json({
      error: 'activation_limit',
      message: `Ce code a déjà été activé sur ${MAX_ACTIVATIONS} appareils. Contactez le support.`,
    });
  }

  // Lier ce code à l'extension_id actuel, incrémenter le compteur si nouvel appareil
  await supabase.from('users')
    .update({
      extension_id,
      activation_count: isSameDevice ? activationCount : activationCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  return res.status(200).json({
    success: true,
    credit_balance: user.credit_balance,
    email: user.email,
    message: `Compte activé — ${user.credit_balance} crédits disponibles.`,
  });
};
