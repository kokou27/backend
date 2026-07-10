// ROBOFLOW_API_KEY  → wrangler secret put ROBOFLOW_API_KEY
// ROBOFLOW_MODEL_URL → var dans wrangler.toml, ex: https://detect.roboflow.com/workspace/model/version
//
// Protégé par extensionId + limite/minute (checkRateLimit) : sans ça, la route
// était un proxy gratuit et illimité vers une clé Roboflow payante.
import { normalizeInstallId } from '../_lib/install-id.js';
import { checkRateLimit } from '../_lib/rate-limit.js';

export default async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { imageBase64, imageWidth, imageHeight, extensionId: extensionIdRaw } = req.body;
    const extensionId = normalizeInstallId(extensionIdRaw);
    if (!extensionId) return res.status(401).json({ error: 'extensionId requis (32 hex)' });

    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length > 6_000_000) {
        return res.status(400).json({ error: 'imageBase64 invalide' });
    }

    const gate = await checkRateLimit(extensionId, { freeLimit: 5 });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const apiKey  = process.env.ROBOFLOW_API_KEY;
    const modelUrl = process.env.ROBOFLOW_MODEL_URL;

    if (!apiKey || !modelUrl) {
        return res.status(503).json({ error: 'ROBOFLOW_API_KEY ou ROBOFLOW_MODEL_URL manquant' });
    }

    const W = Math.max(1, Number(imageWidth) || 1);
    const H = Math.max(1, Number(imageHeight) || 1);

    try {
        // Roboflow accepte le base64 directement via query param ou form-data
        const url = `${modelUrl}?api_key=${apiKey}&confidence=10&overlap=30`;

        const rfRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `image=${encodeURIComponent(imageBase64)}`,
        });

        if (!rfRes.ok) {
            const txt = await rfRes.text().catch(() => '');
            return res.status(502).json({ error: `Roboflow HTTP ${rfRes.status}`, detail: txt.slice(0, 200) });
        }

        const data = await rfRes.json();

        // Roboflow retourne: { predictions: [{x, y, width, height, confidence, class}], image:{width,height} }
        // x/y = CENTRE de la bbox (pas le coin supérieur gauche)
        const imgW = data?.image?.width  || W;
        const imgH = data?.image?.height || H;

        const bubbles = (data?.predictions || [])
            .filter(p => (p.confidence ?? 1) >= 0.10)
            .map(p => {
                const xmin = (p.x - p.width  / 2);
                const ymin = (p.y - p.height / 2);
                const xmax = (p.x + p.width  / 2);
                const ymax = (p.y + p.height / 2);
                return {
                    label: p.class || 'bubble',
                    score: Math.round((p.confidence ?? 0.9) * 100) / 100,
                    x:  xmin / imgW,  y:  ymin / imgH,
                    w:  p.width  / imgW, h: p.height / imgH,
                    cx: p.x / imgW,   cy: p.y / imgH,
                };
            });

        return res.status(200).json({ success: true, bubbles });
    } catch (err) {
        return res.status(500).json({ error: 'Network error', detail: err.message });
    }
};
