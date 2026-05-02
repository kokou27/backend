const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
);

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { token } = req.query;

    if (!token) {
        return res.status(400).send(errorPage('Token manquant.'));
    }

    // ── Chercher le token ─────────────────────────────────────────────────
    const { data: linkToken, error: tokenError } = await supabase
        .from('link_tokens')
        .select('*')
        .eq('token', token)
        .single();

    if (tokenError) {
      console.error('[ConfirmLink] token lookup error', tokenError);
      return res.status(500).send(errorPage('Erreur serveur. Réessaie plus tard.'));
    }

    if (!linkToken) {
        return res.status(404).send(errorPage('Lien invalide ou déjà utilisé.'));
    }

    // ── Vérifier l'expiration ─────────────────────────────────────────────
    if (new Date() > new Date(linkToken.expires_at)) {
      const { error: deleteError } = await supabase.from('link_tokens').delete().eq('token', token);
      if (deleteError) {
        console.warn('[ConfirmLink] token delete error after expiration', deleteError);
      }
        return res.status(410).send(errorPage('Ce lien a expiré. Recommence depuis l\'extension.'));
    }

    // ── Appliquer la liaison ──────────────────────────────────────────────
    const { data: updatedUsers, error: updateError } = await supabase
        .from('users')
        .update({
            extension_id: linkToken.new_extension_id,
            updated_at: new Date().toISOString(),
        })
      .eq('email', linkToken.email)
      .select('id');

    if (updateError) {
      console.error('[ConfirmLink] update error', updateError);
        return res.status(500).send(errorPage('Erreur serveur. Réessaie plus tard.'));
    }

    if (!updatedUsers || updatedUsers.length === 0) {
      return res.status(404).send(errorPage('Compte introuvable pour ce lien.'));
    }

    // ── Supprimer le token utilisé ────────────────────────────────────────
    const { error: deleteError } = await supabase.from('link_tokens').delete().eq('token', token);
    if (deleteError) {
      console.warn('[ConfirmLink] token delete error', deleteError);
    }

    console.log(`[ConfirmLink] ✅ ${linkToken.email} → ${linkToken.new_extension_id}`);

    return res.status(200).send(successPage(linkToken.email));
};

function successPage(email) {
    return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>SITT — Liaison confirmée</title>
<style>
  body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; border-radius: 12px; padding: 40px; text-align: center;
          max-width: 400px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  h2 { color: #1a1a1a; margin-bottom: 8px; }
  p { color: #666; line-height: 1.6; }
  .check { font-size: 48px; margin-bottom: 16px; }
  .email { color: #4A90E2; font-weight: 500; }
</style>
</head>
<body>
  <div class="card">
    <div class="check">✅</div>
    <h2>Liaison confirmée !</h2>
    <p>Ton compte <span class="email">${email}</span> est maintenant lié à cette extension.</p>
    <p>Tu peux fermer cette page et retourner dans l'extension.</p>
  </div>
</body>
</html>`;
}

function errorPage(message) {
    return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>SITT — Erreur</title>
<style>
  body { font-family: sans-serif; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #f5f5f5; }
  .card { background: white; border-radius: 12px; padding: 40px; text-align: center;
          max-width: 400px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  h2 { color: #1a1a1a; margin-bottom: 8px; }
  p { color: #666; }
  .icon { font-size: 48px; margin-bottom: 16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h2>Lien invalide</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}