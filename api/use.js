/**
 * POST /api/use
 * Single gate for all AI features.
 * Backend decides: FREE quota OR paid credits.
 * Never trust the client for entitlements.
 */
import { getSupabase } from '../_lib/supabase.js';

const DAILY_FREE_LIMIT = parseInt(process.env.DAILY_TRIAL_LIMIT || '2', 10);
const AI_FEATURES = ['smart_click', 'zone_ai', 'ocr_quality'];
const GEMINI_MODEL = process.env.GEMINI_MODEL_DEFAULT || 'gemini-2.5-flash';
const MIN_VERSION = '2.4.0'; // Versions antérieures utilisaient l'ancienne architecture

function compareVersion(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function buildGeminiPrompt(lang, targetLang, feature) {
  const langNames = { eng:'English', fra:'French', jpn:'Japanese', jpn_vert:'Japanese', kor:'Korean', chi_sim:'Chinese', chi_tra:'Chinese', spa:'Spanish', deu:'German', ara:'Arabic', por:'Portuguese', rus:'Russian', ita:'Italian' };
  const targetNames = { en:'English', fr:'French', ja:'Japanese', ko:'Korean', zh:'Chinese', es:'Spanish', de:'German', ar:'Arabic', pt:'Portuguese', ru:'Russian', it:'Italian' };
  const src = langNames[lang] || 'auto-detect';
  const tgt = targetNames[targetLang] || 'French';

  if (feature === 'smart_click' || feature === 'zone_ai') {
    return `You are a manga/comic speech bubble translator.
This image shows a cropped portion of a manga/comic page — it may contain one or more speech bubbles with text inside them.
Your task:
1. Read ALL handwritten or printed text visible anywhere in the image (inside bubbles, captions, sound effects).
2. Join all found text into a single string for "text".
3. Translate that text from ${src} to ${tgt} for "translated".
4. If the image has absolutely no text at all, return { "text": "", "translated": "" }.

CRITICAL: Do NOT return empty if there is any text visible, even partially. Include all text you can read.
Return ONLY valid JSON with no markdown: { "text": "...", "translated": "..." }`;
  }

  // ocr_quality — full page or selection
  return `You are a manga/comic OCR and translator.
Read ALL text visible in this image: speech bubbles, captions, sound effects, titles.
IGNORE website UI, navigation bars, buttons — only extract text that is part of the comic artwork.
Detect source language automatically (${src} hint).
Translate everything to ${tgt}.
Join all text into one string. Return ONLY valid JSON: { "text": "original", "translated": "translated" }
If truly no text: { "text": "", "translated": "" }`;
}

export default async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { extension_id, feature, imageBase64, lang = 'eng', targetLang = 'fr', version } = req.body || {};

  // ── Check version minimum ────────────────────────────────────────────────
  if (version && compareVersion(version, MIN_VERSION) < 0) {
    return res.status(426).json({
      error: 'UPDATE_REQUIRED',
      message: `Mettez à jour SITT (v${MIN_VERSION}+) pour continuer à utiliser la traduction IA.`,
      min_version: MIN_VERSION,
    });
  }

  // ── Validation inputs ────────────────────────────────────────────────────
  if (!extension_id || typeof extension_id !== 'string' || extension_id.length < 5) {
    return res.status(400).json({ error: 'extension_id requis' });
  }
  if (!AI_FEATURES.includes(feature)) {
    return res.status(400).json({ error: 'feature invalide', valid: AI_FEATURES });
  }
  if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length > 6_000_000) {
    return res.status(400).json({ error: 'imageBase64 invalide ou trop grande' });
  }

  const supabase = getSupabase();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();

  // ── Récupérer ou créer l'utilisateur ────────────────────────────────────
  let { data: user } = await supabase
    .from('users')
    .select('id, credit_balance, scans_today, last_scan_date, scans_this_minute, last_scan_minute')
    .eq('extension_id', extension_id)
    .maybeSingle();

  const hasPaidCredits = user && (user.credit_balance || 0) > 0;
  const scansTodayRaw = user?.last_scan_date === today ? (user.scans_today || 0) : 0;
  const lastMinute = user?.last_scan_minute ? new Date(user.last_scan_minute) : null;
  const secondsElapsed = lastMinute ? (now - lastMinute) / 1000 : 999;
  const scansThisMinute = secondsElapsed < 60 ? (user?.scans_this_minute || 0) : 0;
  const perMinuteLimit = hasPaidCredits ? 15 : 3;

  // ── Rate limit (par minute) ──────────────────────────────────────────────
  if (scansThisMinute >= perMinuteLimit) {
    return res.status(429).json({ error: 'RATE_LIMIT', message: 'Trop rapide — attendez 1 minute.' });
  }

  // ── Vérification quota/crédits ───────────────────────────────────────────
  if (hasPaidCredits) {
    // Paid: décrémenter avec verrou optimiste
    const newBalance = (user.credit_balance || 0) - 1;
    const { data: updated } = await supabase.from('users')
      .update({
        credit_balance: newBalance,
        scans_today: scansTodayRaw + 1,
        last_scan_date: today,
        scans_this_minute: scansThisMinute + 1,
        last_scan_minute: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', user.id)
      .eq('credit_balance', user.credit_balance)
      .select('credit_balance');

    if (!updated || updated.length === 0) {
      return res.status(409).json({ error: 'CONFLICT', message: 'Requête simultanée — réessayez.' });
    }
  } else {
    // Free: vérifier quota journalier via RPC atomique
    // S'assurer que la ligne trial_usage existe
    await supabase.from('trial_usage').upsert(
      [{ extension_id, scans_today: 0, last_scan_date: today, created_at: now.toISOString(), updated_at: now.toISOString() }],
      { onConflict: 'extension_id', ignoreDuplicates: true }
    );

    const { data: trial, error: rpcError } = await supabase
      .rpc('increment_trial_scan', { ext_id: extension_id, today_date: today });

    if (rpcError || !trial || typeof trial.allowed === 'undefined') {
      console.error('RPC error:', rpcError);
      return res.status(500).json({ error: 'SERVER_ERROR' });
    }
    if (!trial.allowed) {
      return res.status(402).json({
        error: 'LIMIT_REACHED',
        message: 'Limite quotidienne atteinte. Revenez demain ou obtenez des crédits.',
        scans_today: trial.scans_today,
        scans_remaining: 0,
      });
    }

    // Mettre à jour rate limit même pour free
    if (user) {
      await supabase.from('users').update({
        scans_this_minute: scansThisMinute + 1,
        last_scan_minute: now.toISOString(),
        updated_at: now.toISOString(),
      }).eq('id', user.id);
    }
  }

  // ── Appel Gemini ─────────────────────────────────────────────────────────
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return res.status(503).json({ error: 'SERVER_ERROR', message: 'Clé API manquante' });

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: buildGeminiPrompt(lang, targetLang, feature) },
            { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
          ]}],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );

    const geminiData = await geminiRes.json();

    // Log Gemini errors for debugging
    if (!geminiRes.ok) {
      console.error('[use.js] Gemini HTTP error:', geminiRes.status, JSON.stringify(geminiData).slice(0, 200));
      return res.status(502).json({ error: 'GEMINI_ERROR', message: `Gemini error ${geminiRes.status}` });
    }

    // Check safety blocking
    const blockReason = geminiData?.promptFeedback?.blockReason;
    if (blockReason) {
      console.warn('[use.js] Gemini blocked:', blockReason);
      // Return safe fallback for blocked content
      return res.status(200).json({ success: true, text: '', translated: '', blocked: true });
    }

    const candidate = geminiData?.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY') {
      console.warn('[use.js] Gemini no candidate or safety stop');
      return res.status(200).json({ success: true, text: '', translated: '', blocked: true });
    }

    const raw = candidate?.content?.parts?.[0]?.text || '';
    console.log('[use.js] Gemini raw response:', raw.slice(0, 100));

    const jsonStr = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();

    let result = { text: '', translated: '' };
    try {
      result = JSON.parse(jsonStr);
    } catch (_) {
      // Raw text, not JSON — use directly
      if (raw.trim()) result = { text: raw.trim(), translated: raw.trim() };
    }

    // Récupérer le solde à jour
    const finalBalance = hasPaidCredits
      ? ((user.credit_balance || 0) - 1)
      : null;
    const scansRemaining = !hasPaidCredits
      ? Math.max(0, DAILY_FREE_LIMIT - (scansTodayRaw + 1))
      : null;

    return res.status(200).json({
      success: true,
      text: result.text || '',
      translated: result.translated || result.text || '',
      credits_remaining: finalBalance,
      scans_remaining: scansRemaining,
    });

  } catch (err) {
    console.error('Gemini error:', err.message);
    return res.status(502).json({ error: 'GEMINI_ERROR', message: 'Erreur IA — réessayez.' });
  }
};
