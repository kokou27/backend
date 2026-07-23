import { getSupabase } from '../_lib/supabase.js';
import { normalizeInstallId } from '../_lib/install-id.js';

const MAX_ACTIVATIONS = 3; // Nombre d'appareils DISTINCTS max par code

export default async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { activation_code, extension_id: extension_id_raw } = req.body;
  const extension_id = normalizeInstallId(extension_id_raw);

  if (!activation_code || typeof activation_code !== 'string' || activation_code.length < 10) {
    return res.status(400).json({ error: 'Code d\'activation invalide' });
  }

  if (!extension_id) {
    return res.status(400).json({ error: 'Invalid install ID (expected 32 hex chars)' });
  }

  const supabase = getSupabase();

  const { data: user, error } = await supabase
    .from('users')
    .select('id, credit_balance, email, activation_count')
    .eq('secret_token', activation_code.trim())
    .maybeSingle();

  if (error) return res.status(500).json({ error: 'Erreur serveur' });
  if (!user) return res.status(404).json({
    error: 'Code invalide',
    message: 'Code d\'activation introuvable. Vérifiez votre email.',
  });

  // Cet appareil a-t-il déjà été vu pour ce compte ?
  const { data: existingDevice } = await supabase
    .from('activation_devices')
    .select('extension_id')
    .eq('user_id', user.id)
    .eq('extension_id', extension_id)
    .maybeSingle();

  if (!existingDevice) {
    const { count } = await supabase
      .from('activation_devices')
      .select('extension_id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if ((count || 0) >= MAX_ACTIVATIONS) {
      return res.status(403).json({
        error: 'activation_limit',
        message: `Ce code a déjà été activé sur ${MAX_ACTIVATIONS} appareils différents. Contactez le support.`,
      });
    }

    const { error: insertError } = await supabase
      .from('activation_devices')
      .insert([{ user_id: user.id, extension_id }]);

    if (insertError) {
      console.error('Erreur enregistrement appareil:', insertError);
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  await supabase.from('users')
    .update({ extension_id, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  return res.status(200).json({
    success: true,
    credit_balance: user.credit_balance,
    email: user.email,
    message: `Compte activé — ${user.credit_balance} crédits disponibles.`,
  });
};
