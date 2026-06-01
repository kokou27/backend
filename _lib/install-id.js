/** Normalise stt_install_id (accepte anciens formats u-{uuid} et UUID avec tirets). */
export function normalizeInstallId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (s.startsWith('u-')) s = s.slice(2);
  s = s.replace(/-/g, '');
  if (!/^[a-z0-9]{32}$/.test(s)) return null;
  return s;
}

export function isValidInstallId(raw) {
  return normalizeInstallId(raw) !== null;
}
