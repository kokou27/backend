/**
 * /api/tts — TTS haute qualité
 *
 * Stratégie en cascade (du moins cher au plus fiable) :
 * 1. Google Cloud TTS Standard si GOOGLE_TTS_API_KEY configuré
 *    → $4/1M chars, 4M chars/mois GRATUITS, qualité excellente
 *    → Ajouter dans Vercel : GOOGLE_TTS_API_KEY=<ta clé Google Cloud>
 * 2. Fallback : Google Translate proxy (gratuit, contre ToS, bloquable à grande échelle)
 *
 * Pour passer en production : activer Google Cloud Text-to-Speech API sur
 * console.cloud.google.com et créer une clé API séparée.
 */

// Codes langue ISO → codes Google TTS
const LANG_MAP = {
  fr: 'fr', en: 'en', es: 'es', de: 'de', it: 'it', pt: 'pt',
  ru: 'ru', ja: 'ja', ko: 'ko', zh: 'zh-CN', ar: 'ar',
  'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', 'pt-br': 'pt',
  'en-us': 'en', 'en-gb': 'en', 'fr-fr': 'fr',
};

export default async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).end();

  const rawText = String(req.query?.text || '').trim();
  const rawLang = String(req.query?.lang || 'en').toLowerCase().trim();

  if (!rawText) return res.status(400).json({ error: 'text requis' });

  // Sécurité : limite la taille du texte
  const text = rawText.slice(0, 200);
  const lang = LANG_MAP[rawLang] || LANG_MAP[rawLang.split('-')[0]] || 'en';

  try {
    // ── Option 1 : Google Cloud TTS officiel (meilleure qualité, fiable à grande échelle) ──
    if (process.env.GOOGLE_TTS_API_KEY) {
      const gcpRes = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input:       { text },
            voice:       { languageCode: lang, ssmlGender: 'NEUTRAL' },
            audioConfig: { audioEncoding: 'MP3', speakingRate: 0.92, pitch: 0 },
          }),
        }
      );

      if (gcpRes.ok) {
        const data = await gcpRes.json();
        if (data.audioContent) {
          const audioBuffer = Buffer.from(data.audioContent, 'base64');
          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('Content-Length', audioBuffer.length);
          return res.end(audioBuffer);
        }
      }
      console.warn('[TTS] Google Cloud TTS failed, fallback to proxy');
    }

    // ── Option 2 : Google Translate proxy (fallback, gratuit mais non officiel) ──
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob&ttsspeed=0.9`;

    const response = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    'https://translate.google.com/',
        'Accept':     'audio/mpeg,audio/*;q=0.9',
      },
    });

    if (!response.ok) {
      console.error('[TTS] Proxy error:', response.status);
      return res.status(502).json({ error: 'TTS indisponible' });
    }

    const audioBuffer = await response.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.end(Buffer.from(audioBuffer));

  } catch (err) {
    console.error('[TTS] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur TTS', detail: err.message });
  }
};
