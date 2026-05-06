import { getSupabase } from '../_lib/supabase.js';

function setCors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const OCR_LANG_NAMES = {
    eng: 'English',
    fra: 'French',
    spa: 'Spanish',
    deu: 'German',
    jpn: 'Japanese',
    jpn_vert: 'Japanese (vertical)',
    kor: 'Korean',
    chi_sim: 'Chinese',
    chi_tra: 'Chinese (traditional)',
    ara: 'Arabic',
    ita: 'Italian',
    por: 'Portuguese',
    rus: 'Russian',
};

function buildPrompt(rawText, langName) {
    return `You are an OCR correction assistant. The following text was extracted by Tesseract OCR from a manga/manhwa speech bubble and contains recognition errors (wrong letters, missing apostrophes, numbers instead of letters, etc.).

Original language: ${langName}

Raw OCR text:
${rawText}

Rules:
- Return ONLY the corrected text, nothing else
- No explanations, no quotes, no markdown
- Preserve line breaks
- Preserve the original language
- Fix only OCR errors (0->O, 1->I, 8->B, 6->G, etc.), do not rephrase
- If the text looks correct already, return it as-is`;
}

export default async (req, res) => {
  const supabase = getSupabase();
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
        extensionId,
        rawText,
        lang = 'eng',
        secretToken,
    } = req.body || {};

    if (!extensionId || typeof extensionId !== 'string') {
        return res.status(400).json({ error: 'extensionId requis' });
    }

    if (!rawText || typeof rawText !== 'string' || rawText.length > 10000) {
        return res.status(400).json({ error: 'Texte invalide' });
    }

    if (!lang || typeof lang !== 'string' || !/^[a-z]{3}(_[a-z]+)?$/i.test(lang)) {
        return res.status(400).json({ error: 'Langue invalide' });
    }

    const { data: user, error: userFetchError } = await supabase
        .from('users')
        .select('id, secret_token, credit_balance')
        .eq('extension_id', extensionId)
        .maybeSingle();

    if (userFetchError) {
        console.error('Erreur récupération user correct-text:', userFetchError);
        return res.status(500).json({ error: 'Erreur récupération utilisateur' });
    }

    if (!user) {
        return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    if (user.secret_token && user.secret_token !== secretToken) {
        return res.status(401).json({
            error: 'unauthorized',
            message: 'Token invalide. Reliez votre compte pour synchroniser la session.',
        });
    }

    if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: 'Gemini non configuré' });
    }

    const langName = OCR_LANG_NAMES[lang] || OCR_LANG_NAMES[lang.toLowerCase()] || 'English';
    const prompt = buildPrompt(rawText, langName);

    try {
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: 400,
                        temperature: 0.1,
                    },
                }),
            }
        );

        const data = await geminiRes.json();
        if (!geminiRes.ok || data?.error) {
            const message = data?.error?.message || `HTTP ${geminiRes.status}`;
            return res.status(502).json({ error: 'Gemini Error', message });
        }

        const corrected = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!corrected) {
            return res.status(502).json({ error: 'Réponse vide de Gemini' });
        }

        return res.status(200).json({ success: true, corrected });
    } catch (err) {
        console.error('Erreur réseau correct-text:', err);
        return res.status(500).json({ error: 'Network Error', detail: err.message });
    }
};
