const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ✅ URL de confirmation — pointe vers un nouvel endpoint /api/confirm-link
const BACKEND_URL = 'https://backend-gamma-mocha-87.vercel.app';

async function ensureSecretToken(userId, existingToken) {
  if (existingToken) return existingToken;

  const generatedToken = require('crypto').randomUUID();
  const { error } = await supabase
    .from('users')
    .update({ secret_token: generatedToken })
    .eq('id', userId)
    .is('secret_token', null);

  // Si le update échoue ou n'affecte aucune ligne, on relit en base
  if (error) {
    const { data } = await supabase
      .from('users')
      .select('secret_token')
      .eq('id', userId)
      .single();
    return data?.secret_token || null;
  }

  return generatedToken;
}

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { extensionId, email } = req.body;

  if (!extensionId || !email) {
    return res.status(400).json({ error: 'extensionId et email requis' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  // ── Chercher l'utilisateur par email ──────────────────────────────────
  const { data: userByEmail } = await supabase
    .from('users')
    .select('id, extension_id, credit_balance, email, secret_token')
    .eq('email', normalizedEmail)
    .single();

  if (userByEmail) {
    // ✅ Même extensionId → déjà lié, retourner directement
    if (userByEmail.extension_id === extensionId) {
      const secretToken = await ensureSecretToken(userByEmail.id, userByEmail.secret_token);
      return res.status(200).json({
        success: true,
        credit_balance: userByEmail.credit_balance,
        email: normalizedEmail,
        secret_token: secretToken,
      });
    }

    // ⚠️ ExtensionId différent → envoyer un email de confirmation
    const token = require('crypto').randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min

    // Supprimer les anciens tokens pour cet email
    await supabase
      .from('link_tokens')
      .delete()
      .eq('email', normalizedEmail);

    // Créer le nouveau token
    await supabase.from('link_tokens').insert([{
      token,
      email: normalizedEmail,
      new_extension_id: extensionId,
      expires_at: expiresAt,
      created_at: new Date().toISOString(),
    }]);

    const confirmUrl = `${BACKEND_URL}/api/confirm-link?token=${token}`;

    // Envoyer l'email via Resend
    await resend.emails.send({
      from: 'SITT <onboarding@resend.dev>', // ← remplace par ton domaine vérifié sur Resend
      to: normalizedEmail,
      subject: '🔐 Confirme la liaison de ton extension SITT',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Confirmation requise</h2>
          <p>Une demande de liaison a été faite pour ton compte SITT.</p>
          <p>Clique sur le bouton ci-dessous pour confirmer :</p>
          <a href="${confirmUrl}"
             style="display:inline-block;background:#4A90E2;color:white;padding:12px 24px;
                    border-radius:6px;text-decoration:none;font-weight:bold;margin:16px 0;">
            ✅ Confirmer la liaison
          </a>
          <p style="color:#888;font-size:13px;">
            Ce lien expire dans 15 minutes.<br>
            Si tu n'es pas à l'origine de cette demande, ignore cet email.
          </p>
        </div>
      `,
    });

    console.log(`[Link] Email de confirmation envoyé à ${normalizedEmail}`);

    return res.status(200).json({
      success: false,
      pending_confirmation: true,
      message: 'Un email de confirmation a été envoyé. Vérifie ta boîte mail.',
    });
  }

  // ── Pas trouvé par email → chercher par extensionId ───────────────────
  const { data: userByExtId } = await supabase
    .from('users')
    .select('id, email, credit_balance, secret_token')
    .eq('extension_id', extensionId)
    .single();

  if (userByExtId && !userByExtId.email) {
    const secretToken = userByExtId.secret_token || require('crypto').randomUUID();
    const { error } = await supabase
      .from('users')
      .update({
        email: normalizedEmail,
        secret_token: secretToken,
        updated_at: new Date().toISOString(),
      })
      .eq('extension_id', extensionId);

    if (error) {
      return res.status(500).json({ error: 'Erreur mise à jour email' });
    }

    return res.status(200).json({
      success: true,
      credit_balance: userByExtId.credit_balance,
      email: normalizedEmail,
      secret_token: secretToken,
    });
  }

  // ── Aucun utilisateur trouvé → créer avec 0 crédits ──────────────────
  const secretToken = require('crypto').randomUUID();
  const { error: insertError } = await supabase
    .from('users')
    .insert([{
      extension_id: extensionId,
      email: normalizedEmail,
      secret_token: secretToken,
      credit_balance: 0,
      scans_today: 0,
      scans_this_minute: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }]);

  if (insertError) {
    return res.status(500).json({ error: 'Erreur création utilisateur' });
  }

  return res.status(200).json({
    success: true,
    credit_balance: 0,
    email: normalizedEmail,
    secret_token: secretToken,
  });
};