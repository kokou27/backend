/**
 * /api/tts — Proxy TTS haute qualité
 * Utilise Google Translate TTS (gratuit, multi-langue, bien meilleur que browser TTS)
 * Langues supportées : toutes les langues Google Translate
 */

function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Codes langue ISO → codes Google TTS
const LANG_MAP = {
  fr: 'fr', en: 'en', es: 'es', de: 'de', it: 'it', pt: 'pt',
  ru: 'ru', ja: 'ja', ko: 'ko', zh: 'zh-CN', ar: 'ar',
  'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', 'pt-br': 'pt',
  'en-us': 'en', 'en-gb': 'en', 'fr-fr': 'fr',
};

module.exports = async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).end();

  const rawText = String(req.query?.text || '').trim();
  const rawLang = String(req.query?.lang || 'en').toLowerCase().trim();

  if (!rawText) return res.status(400).json({ error: 'text requis' });

  // Sécurité : limite la taille du texte
  const text = rawText.slice(0, 200);
  const lang = LANG_MAP[rawLang] || LANG_MAP[rawLang.split('-')[0]] || 'en';

  try {
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob&ttsspeed=0.9`;

    const response = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    'https://translate.google.com/',
        'Accept':     'audio/mpeg,audio/*;q=0.9',
      },
    });

    if (!response.ok) {
      console.error('[TTS] Google TTS error:', response.status);
      return res.status(502).json({ error: 'TTS indisponible', status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();

    // Cache 1h côté client (même texte = même audio)
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.end(Buffer.from(audioBuffer));

  } catch (err) {
    console.error('[TTS] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur serveur TTS', detail: err.message });
  }
};
