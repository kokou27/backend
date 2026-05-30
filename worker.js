/**
 * SITT Backend — Cloudflare Worker
 * Remplace Vercel serverless functions.
 *
 * Avantages vs Vercel Hobby :
 * - 3M requêtes/mois GRATUITES (vs 1M Vercel)
 * - Usage commercial AUTORISÉ (Vercel Hobby interdit le commercial)
 * - Edge network mondial → ~15ms latence (vs ~300ms Vercel)
 * - Pas de cold start
 */

import handlePageTranslate from './api/page-translate.js';
import handleOcr          from './api/ocr.js';
import handleTrialOcr     from './api/trial-ocr.js';
import handleCredits      from './api/credits.js';
import handleConfig       from './api/config.js';
import handleLink         from './api/link.js';
import handleConfirmLink  from './api/confirm-link.js';
import handleWebhook      from './api/webhook.js';
import handleActivate     from './api/activate.js';
import handlePurchase     from './api/purchase.js';
import handleContact      from './api/contact.js';
import handleTts          from './api/tts.js';

// ── ROUTES ──────────────────────────────────────────────────────
const ROUTES = {
  '/api/page-translate': handlePageTranslate,
  '/api/ocr':            handleOcr,
  '/api/trial-ocr':      handleTrialOcr,
  '/api/credits':        handleCredits,
  '/api/config':         handleConfig,
  '/api/link':           handleLink,
  '/api/confirm-link':   handleConfirmLink,
  '/api/webhook':        handleWebhook,
  '/api/activate':       handleActivate,
  '/api/purchase':       handlePurchase,
  '/api/contact':        handleContact,
  '/api/tts':            handleTts,
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── COMPAT : CF Request/Response → Express-like (req, res) ─────
async function buildReq(request, url) {
  let body    = {};
  let rawBody = '';
  const ct = request.headers.get('content-type') || '';

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    rawBody = await request.text(); // lire une fois comme texte brut
    if (ct.includes('application/json') && rawBody) {
      try { body = JSON.parse(rawBody); } catch {}
    }
  }

  return {
    method:  request.method,
    url:     url.toString(),
    body,
    rawBody, // pour les webhooks qui vérifient la signature HMAC
    query:   Object.fromEntries(url.searchParams.entries()),
    headers: new Proxy({}, {
      get: (_, k) => request.headers.get(String(k)),
    }),
  };
}

function buildRes() {
  let _status  = 200;
  let _headers = { ...CORS, 'Content-Type': 'application/json' };
  let _body    = null;
  let _done    = false;

  const res = {
    status(code)       { _status = code; return res; },
    setHeader(k, v)    { _headers[k] = String(v); return res; },
    json(data)         { _body = JSON.stringify(data); _done = true; return res; },
    send(data)         { _body = data; _done = true; return res; },
    end(data)          { _body = data ?? null; _done = true; return res; },
    // helpers pour vérifier l'état
    _isDone:  () => _done,
    _build:   () => new Response(_body, { status: _status, headers: _headers }),
  };
  return res;
}

// ── WORKER ENTRY POINT ──────────────────────────────────────────
let envInjected = false;

export default {
  async fetch(request, env) {
    // 1. Injecter les variables d'env CF dans process.env (une seule fois par isolate)
    //    Sûr car les valeurs d'env CF sont statiques (jamais différentes d'une requête à l'autre)
    if (!envInjected) {
      Object.assign(process.env, env);
      envInjected = true;
    }

    const url = new URL(request.url);

    // 2. CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS });
    }

    // 3. Route
    const handler = ROUTES[url.pathname];
    if (!handler) {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // 4. Exécuter le handler avec la couche de compat
    try {
      const req = await buildReq(request, url);
      const res = buildRes();
      await handler(req, res);
      return res._build();
    } catch (err) {
      console.error('[Worker] Handler error:', err);
      return new Response(JSON.stringify({ error: 'Internal Server Error', detail: err.message }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }
  },
};
