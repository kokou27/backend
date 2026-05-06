function setCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseCsvEnv(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export default async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const extensionId = typeof req.query?.extensionId === 'string'
    ? req.query.extensionId.trim()
    : '';

  const devProEnabled = process.env.DEV_PRO_ENABLED === 'true';
  const devProAllowlist = parseCsvEnv(process.env.DEV_PRO_EXTENSION_IDS);
  const devProActive = Boolean(
    devProEnabled
    && extensionId
    && devProAllowlist.includes(extensionId)
  );
  const rawDevProEmail = typeof process.env.DEV_PRO_EMAIL === 'string'
    ? process.env.DEV_PRO_EMAIL.trim()
    : '';
  const devProEmail = devProActive && rawDevProEmail ? rawDevProEmail : null;

  res.status(200).json({
    buy_button_enabled: process.env.BUY_BUTTON_ENABLED === 'true',
    dev_pro_active: devProActive,
    dev_pro_email: devProEmail,
  });
};
