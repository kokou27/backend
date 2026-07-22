import { normalizeInstallId } from '../_lib/install-id.js';

function parseCsvEnv(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

// TEST_MODE=1 sur Cloudflare → l'extension bascule vers les liens de paiement
// Lemon Squeezy en mode test (aucun débit réel). TEST_MODE=0 ou absent → prod.
const PROD_CHECKOUT_URLS = {
  starter:  'https://sitt.lemonsqueezy.com/checkout/buy/bfe53eab-45ca-4ce7-ae64-8ad4fbe7d963',
  standard: 'https://sitt.lemonsqueezy.com/checkout/buy/5286881f-5751-4cc2-b918-1f566ca400e2',
  pro:      'https://sitt.lemonsqueezy.com/checkout/buy/16b21f3a-bbe3-46c7-8a05-481901fbbacb',
};

const TEST_CHECKOUT_URLS = {
  starter:  'https://sitt.lemonsqueezy.com/checkout/buy/215b0afa-5d6e-4951-93c0-c0771ed5593d',
  standard: 'https://sitt.lemonsqueezy.com/checkout/buy/e9c0fbd9-6b7a-47a4-9f14-4038083e570f',
  pro:      'https://sitt.lemonsqueezy.com/checkout/buy/df6c585d-bea3-4576-a629-4ca38c934c19',
};

export default async (req, res) => {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const installId = normalizeInstallId(req.query?.installId || req.query?.extensionId);

  const devProEnabled = process.env.DEV_PRO_ENABLED === 'true';
  const devProAllowlist = parseCsvEnv(
    process.env.DEV_PRO_INSTALL_IDS || process.env.DEV_PRO_EXTENSION_IDS
  );
  const devProActive = Boolean(
    devProEnabled
    && installId
    && devProAllowlist.includes(installId)
  );
  const rawDevProEmail = typeof process.env.DEV_PRO_EMAIL === 'string'
    ? process.env.DEV_PRO_EMAIL.trim()
    : '';
  const devProEmail = devProActive && rawDevProEmail ? rawDevProEmail : null;

  const testMode = (process.env.TEST_MODE || '').trim() === 'true';

  res.status(200).json({
    buy_button_enabled: process.env.BUY_BUTTON_ENABLED === 'true',
    dev_pro_active: devProActive,
    dev_pro_email: devProEmail,
    test_mode: testMode,
    checkout_urls: testMode ? TEST_CHECKOUT_URLS : PROD_CHECKOUT_URLS,
    // DEBUG temporaire — à retirer une fois le diagnostic terminé
    debug_ping_test: process.env.PING_TEST ?? null,
    debug_test_mode_raw: process.env.TEST_MODE ?? null,
  });
};
