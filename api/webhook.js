import crypto from 'node:crypto';
import { getSupabase } from '../_lib/supabase.js';

const CREDITS_MAP = {
  '1033500': 1000,  // Pack Découverte — 4,99$ (prod)
  '1033534': 3000,  // Pack Standard   — 9,99$ (prod)
  '1033536': 10000, // Pack Pro        — 19,99$ (prod)
  '1036925': 1000,  // Pack Découverte — test
  '1036927': 3000,  // Pack Standard   — test
  '1036926': 10000, // Pack Pro        — test
  '1626299': 1000,  // Pack Découverte  — test
  '1626300': 10000, // Pack Pro         — test
  '1626301': 3000,  // Pack Standard   — test
  '1345390': 1000,  // Ancien variant de test
};

function isUniqueViolation(error) {
  if (!error) return false;
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  return code === '23505' || message.includes('duplicate key') || message.includes('unique constraint');
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function getUserBalanceById(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('credit_balance')
    .eq('id', userId)
    .maybeSingle();

  if (error) return { balance: null, error };

  const balance = Number.isFinite(Number(data?.credit_balance))
    ? Number(data.credit_balance)
    : null;

  return { balance, error: null };
}

async function adjustCreditsWithOptimisticRetry(userId, amountInput, maxAttempts = 3) {
  const supabase = getSupabase();
  const delta = Math.floor(safeNumber(amountInput, 0));
  if (delta === 0) {
    return getUserBalanceById(userId);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await getUserBalanceById(userId);
    if (current.error || !Number.isFinite(current.balance)) {
      return {
        balance: null,
        error: current.error || { message: 'balance_unavailable' },
      };
    }

    const currentBalance = Math.max(0, Math.floor(safeNumber(current.balance, 0)));
    const targetBalance = Math.max(0, currentBalance + delta);

    const { data, error } = await supabase
      .from('users')
      .update({
        credit_balance: targetBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .eq('credit_balance', currentBalance)
      .select('credit_balance')
      .maybeSingle();

    if (!error && data && Number.isFinite(Number(data.credit_balance))) {
      return {
        balance: Number(data.credit_balance),
        error: null,
      };
    }

    if (error) {
      return {
        balance: null,
        error,
      };
    }
  }

  return {
    balance: null,
    error: { message: 'optimistic_retry_exhausted' },
  };
}

async function incrementCreditsAtomic(userId, amount) {
  const supabase = getSupabase();
  const amountInput = Math.floor(safeNumber(amount, 0));
  if (amountInput === 0) {
    return getUserBalanceById(userId);
  }

  const { error: rpcError } = await supabase.rpc('increment_credits', {
    user_id_input: userId,
    amount_input: amountInput,
  });

  if (rpcError) {
    const fallbackResult = await adjustCreditsWithOptimisticRetry(userId, amountInput, 3);
    if (!fallbackResult.error) return fallbackResult;
    return {
      balance: null,
      error: rpcError,
    };
  }

  return getUserBalanceById(userId);
}

// CF Workers: bodyParser not needed (handled by worker.js compat layer)

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function extractVariantId(payload) {
  const orderItems = payload?.included?.filter(i => i.type === 'order-items') || [];
  if (orderItems.length > 0) {
    const vid = String(orderItems[0]?.attributes?.variant_id || '');
    if (vid) return vid;
  }
  const firstItem = payload?.data?.attributes?.first_order_item;
  if (firstItem?.variant_id) return String(firstItem.variant_id);
  return '';
}

export default async (req, res) => {
  const supabase = getSupabase();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = req.rawBody || '';
  const signature = req.headers['x-signature'];
  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

  if (!signature) return res.status(401).json({ error: 'Signature manquante' });
  if (!secret) return res.status(500).json({ error: 'LEMON_SQUEEZY_WEBHOOK_SECRET non configuré' });

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(rawBody);
  if (hmac.digest('hex') !== signature) return res.status(401).json({ error: 'Signature invalide' });

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error('JSON parse error:', err.message);
    return res.status(400).json({ error: 'Payload malformé' });
  }
  const event = req.headers['x-event-name'];

  if (event !== 'order_created') return res.status(200).json({ received: true, skipped: true });

  const order      = payload?.data?.attributes;
  const orderId    = String(payload?.data?.id || '');
  const email      = order?.user_email?.toLowerCase().trim();
  const status     = order?.status;
  const variantId  = extractVariantId(payload);
  // extension_id passé via checkout[custom][extension_id]
  const extensionId = String(payload?.meta?.custom_data?.extension_id || '').trim();

  if (status !== 'paid' || !email || !variantId) {
    return res.status(200).json({ received: true, skipped: true });
  }

  const creditsToAdd = CREDITS_MAP[variantId];
  if (!creditsToAdd) return res.status(400).json({ error: `Variant inconnu: ${variantId}` });

  // ✅ 1. DÉDUPLICATION
  const { error: lockError } = await supabase
    .from('processed_orders')
    .insert([{ order_id: orderId }]);

  if (lockError) {
    if (isUniqueViolation(lockError)) {
      console.warn(`⚠️ Commande ${orderId} déjà traitée.`);
      return res.status(200).json({ success: true, reason: 'already_processed' });
    }
    console.error('Erreur verrouillage processed_orders:', lockError);
    return res.status(500).json({ error: 'Erreur de verrouillage commande' });
  }

  // ✅ 2. RECHERCHE UTILISATEUR — extension_id en priorité, email en fallback
  let user = null;

  // 2a. Chercher par extension_id (le plus fiable — identifie le navigateur exact)
  if (extensionId) {
    const { data } = await supabase
      .from('users')
      .select('id, credit_balance, email')
      .eq('extension_id', extensionId)
      .maybeSingle();
    if (data) {
      user = data;
      // Mettre à jour l'email si pas encore défini
      if (!data.email && email) {
        await supabase.from('users').update({ email }).eq('id', data.id);
      }
      console.log(`🔍 User trouvé par extension_id: ${extensionId}`);
    }
  }

  // 2b. Fallback : chercher par email
  if (!user && email) {
    const { data } = await supabase
      .from('users')
      .select('id, credit_balance, email')
      .eq('email', email)
      .maybeSingle();
    if (data) {
      user = data;
      console.log(`🔍 User trouvé par email: ${email}`);
    }
  }

  // ✅ 3. TRAITEMENT DES CRÉDITS
  if (user) {
    const incrementResult = await incrementCreditsAtomic(user.id, creditsToAdd);
    if (incrementResult.error) {
      console.error('Erreur credit webhook increment:', incrementResult.error);
      await supabase.from('processed_orders').delete().eq('order_id', orderId);
      return res.status(500).json({ error: 'Impossible de crediter le compte' });
    }

    // Ajouter le secret_token si absent
    await supabase
      .from('users')
      .update({ secret_token: crypto.randomUUID() })
      .eq('id', user.id)
      .is('secret_token', null);

    const newBalance = Number.isFinite(incrementResult.balance)
      ? incrementResult.balance
      : (user.credit_balance || 0) + creditsToAdd;

    const { error: txError } = await supabase.from('transactions').insert([{
      user_id: user.id,
      type: 'purchase',
      amount: creditsToAdd,
      credit_balance_after: newBalance,
      metadata: { variant_id: variantId, order_id: orderId, extension_id: extensionId },
      created_at: new Date().toISOString(),
    }]);

    if (txError) console.error('Erreur insertion transaction webhook (non bloquante):', txError);

    console.log(`✅ Crédité : ${email || extensionId} (+${creditsToAdd}) → solde: ${newBalance}`);

  } else {
    // 3b. Nouveau compte : créer avec extension_id ET email
    const { error: createUserError } = await supabase.from('users').insert([{
      email:             email,
      extension_id:      extensionId || null,
      credit_balance:    creditsToAdd,
      secret_token:      crypto.randomUUID(),
      scans_today:       0,
      scans_this_minute: 0,
      created_at:        new Date().toISOString(),
    }]);

    if (createUserError) {
      console.error('Erreur creation utilisateur webhook:', createUserError);
      await supabase.from('processed_orders').delete().eq('order_id', orderId);
      return res.status(500).json({ error: 'Impossible de creer le compte utilisateur' });
    }

    console.log(`✅ Nouveau compte : ${email} (extension: ${extensionId || 'inconnu'})`);
  }

  return res.status(200).json({ success: true });
};
