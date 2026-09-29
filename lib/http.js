/** Small helpers shared by all API routes (plain Node req/res, works on Vercel). */

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export const methodNotAllowed = (res, allow) => {
  res.setHeader('Allow', allow);
  return send(res, 405, { error: 'Method not allowed.' });
};

export async function readJson(req) {
  let b = req.body;
  if (b === undefined) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    b = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { b = b ? JSON.parse(b) : {}; } catch (e) { b = {}; } }
  return b && typeof b === 'object' ? b : {};
}

export function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* skip */ } }
  });
  return out;
}

export const isHttps = req =>
  String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || !!process.env.VERCEL;

export function setCookie(res, req, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export const clientIp = req =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';

/** Block cross-site state-changing requests (CSRF defence on top of SameSite=Lax). */
export function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === (req.headers['x-forwarded-host'] || req.headers.host); }
  catch (e) { return false; }
}

// Best-effort in-memory rate limiter (resets when a serverless instance restarts)
const buckets = new Map();
export function limited(bucket, key, max, windowMs) {
  const k = bucket + ':' + key, now = Date.now();
  const win = (buckets.get(k) || []).filter(t => now - t < windowMs);
  win.push(now); buckets.set(k, win);
  if (buckets.size > 2000) buckets.clear();
  return win.length > max;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function lastSegment(req) {
  try { return decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/\/+$/, '').split('/').pop()); }
  catch (e) { return ''; }
}

/** Wrap a handler: catches errors and maps "no database" to a clear 503. */
export const route = fn => async (req, res) => {
  try { return await fn(req, res); }
  catch (e) {
    if (e && e.code === 'NO_DB') return send(res, 503, { error: 'Database is not configured on this site yet.', code: 'no_db' });
    console.error(e);
    return send(res, 500, { error: 'Server error. Please try again.' });
  }
};
