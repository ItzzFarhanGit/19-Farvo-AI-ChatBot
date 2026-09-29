/** POST /api/auth/register | login | logout | delete   GET /api/auth/me */
import { query, hasDb } from '../../lib/db.js';
import { send, readJson, methodNotAllowed, sameOrigin, limited, clientIp, route, lastSegment } from '../../lib/http.js';
import { hashPassword, verifyPassword, createSession, destroySession, getUser, publicUser, cleanEmail, validEmail } from '../../lib/auth.js';

const DUMMY = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==';

export default route(async (req, res) => {
  const action = (req.query && req.query.action) || lastSegment(req);

  if (action === 'me') {
    if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
    if (!hasDb()) return send(res, 200, { user: null, dbEnabled: false });
    const user = await getUser(req);
    return send(res, 200, { user: user ? publicUser(user) : null, dbEnabled: true });
  }

  if (req.method !== 'POST') return methodNotAllowed(res, 'GET, POST');
  if (!sameOrigin(req)) return send(res, 403, { error: 'Blocked cross-site request.' });
  if (!hasDb()) return send(res, 503, { error: 'Accounts are not enabled on this site yet.', code: 'no_db' });
  const body = await readJson(req);

  if (action === 'register') {
    if (limited('reg', clientIp(req), 6, 3600000)) return send(res, 429, { error: 'Too many sign-ups from your network. Try again later.' });
    const email = cleanEmail(body.email), name = String(body.name || '').trim().slice(0, 60), pw = String(body.password || '');
    if (!validEmail(email)) return send(res, 400, { error: 'Please enter a valid email address.' });
    if (pw.length < 8 || pw.length > 128) return send(res, 400, { error: 'Password must be 8 to 128 characters.' });
    const hash = await hashPassword(pw);
    const r = await query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING id, email, name',
      [email, name || email.split('@')[0], hash]);
    if (!r.rows[0]) return send(res, 409, { error: 'An account with this email already exists. Try signing in.' });
    const u = { id: String(r.rows[0].id), email: r.rows[0].email, name: r.rows[0].name };
    await createSession(req, res, u.id);
    return send(res, 201, { user: publicUser(u) });
  }

  if (action === 'login') {
    if (limited('login', clientIp(req), 10, 60000)) return send(res, 429, { error: 'Too many attempts. Please wait a minute.' });
    const email = cleanEmail(body.email), pw = String(body.password || '');
    const r = await query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email]);
    const row = r.rows[0];
    const ok = await verifyPassword(pw.slice(0, 128), row ? row.password_hash : DUMMY);
    if (!row || !ok) return send(res, 401, { error: 'Incorrect email or password.' });
    await createSession(req, res, row.id);
    return send(res, 200, { user: publicUser({ id: String(row.id), email: row.email, name: row.name }) });
  }

  if (action === 'logout') {
    await destroySession(req, res);
    return send(res, 200, { ok: true });
  }

  if (action === 'delete') {          // delete my account + all my chats
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: 'Please sign in first.', code: 'auth' });
    const r = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!r.rows[0] || !(await verifyPassword(String(body.password || '').slice(0, 128), r.rows[0].password_hash)))
      return send(res, 401, { error: 'Incorrect password.' });
    await query('DELETE FROM users WHERE id = $1', [user.id]);   // cascades to sessions, chats, messages
    await destroySession(req, res);
    return send(res, 200, { ok: true });
  }

  return send(res, 404, { error: 'Unknown action.' });
});
