/** Accounts: scrypt password hashing + random session tokens stored (hashed) in Postgres. */
import crypto from 'node:crypto';
import { query } from './db.js';
import { parseCookies, setCookie } from './http.js';

export const COOKIE = 'farvo_sid';
const SESSION_DAYS = 30;
const N = 16384, R = 8, P = 1, KEYLEN = 64;

const scrypt = (pw, salt) => new Promise((ok, no) =>
  crypto.scrypt(pw, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? no(e) : ok(k))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(pw, stored) {
  try {
    const [alg, n, r, p, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(s, 'base64'), want = Buffer.from(h, 'base64');
    const got = await new Promise((ok, no) =>
      crypto.scrypt(pw, salt, want.length, { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? no(e) : ok(k))));
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}

const sha = t => crypto.createHash('sha256').update(t).digest('hex');

export async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  if (Math.random() < 0.05) query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {}); // housekeeping
  setCookie(res, req, COOKIE, token, SESSION_DAYS * 86400);
}

export async function destroySession(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) await query('DELETE FROM sessions WHERE token_hash = $1', [sha(t)]);
  setCookie(res, req, COOKIE, '', 0);
}

/** Returns { id, email, name } or null. */
export async function getUser(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return null;
  const r = await query(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(t)]);
  return r.rows[0] ? { id: String(r.rows[0].id), email: r.rows[0].email, name: r.rows[0].name } : null;
}

export const publicUser = u => ({ id: u.id, email: u.email, name: u.name });
export const cleanEmail = e => String(e || '').trim().toLowerCase();
export const validEmail = e => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
