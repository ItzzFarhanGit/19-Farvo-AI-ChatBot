/** GET /api/chats -> my chat list     DELETE /api/chats -> delete ALL my chats */
import { query } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';
import { send, methodNotAllowed, sameOrigin, route } from '../../lib/http.js';

export default route(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'DELETE') return methodNotAllowed(res, 'GET, DELETE');
  const user = await getUser(req);
  if (!user) return send(res, 401, { error: 'Please sign in.', code: 'auth' });
  if (req.method === 'GET') {
    const r = await query('SELECT id, title, updated_at FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 300', [user.id]);
    return send(res, 200, { chats: r.rows.map(c => ({ id: c.id, title: c.title, updated: new Date(c.updated_at).getTime() })) });
  }
  if (!sameOrigin(req)) return send(res, 403, { error: 'Blocked cross-site request.' });
  await query('DELETE FROM chats WHERE user_id = $1', [user.id]);
  return send(res, 200, { ok: true });
});
