/** GET /api/chats/:id (messages)   PATCH {title} (rename)   DELETE (remove chat) */
import { query } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';
import { send, readJson, methodNotAllowed, sameOrigin, route, lastSegment, UUID_RE } from '../../lib/http.js';

export default route(async (req, res) => {
  if (!['GET', 'PATCH', 'DELETE'].includes(req.method)) return methodNotAllowed(res, 'GET, PATCH, DELETE');
  const user = await getUser(req);
  if (!user) return send(res, 401, { error: 'Please sign in.', code: 'auth' });
  const id = (req.query && req.query.id) || lastSegment(req);
  if (!UUID_RE.test(String(id))) return send(res, 400, { error: 'Invalid chat id.' });

  if (req.method === 'GET') {
    const c = await query('SELECT id, title, updated_at FROM chats WHERE id = $1 AND user_id = $2', [id, user.id]);
    if (!c.rows[0]) return send(res, 404, { error: 'Chat not found.' });
    const m = await query('SELECT role, content, files FROM messages WHERE chat_id = $1 ORDER BY id ASC LIMIT 1000', [id]);
    return send(res, 200, {
      chat: { id: c.rows[0].id, title: c.rows[0].title, updated: new Date(c.rows[0].updated_at).getTime() },
      messages: m.rows.map(x => ({ role: x.role, content: x.content, files: x.files || [] }))
    });
  }

  if (!sameOrigin(req)) return send(res, 403, { error: 'Blocked cross-site request.' });
  if (req.method === 'PATCH') {
    const title = String((await readJson(req)).title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!title) return send(res, 400, { error: 'Title cannot be empty.' });
    const r = await query('UPDATE chats SET title = $3 WHERE id = $1 AND user_id = $2 RETURNING id', [id, user.id, title]);
    return r.rows[0] ? send(res, 200, { ok: true, title }) : send(res, 404, { error: 'Chat not found.' });
  }
  const r = await query('DELETE FROM chats WHERE id = $1 AND user_id = $2 RETURNING id', [id, user.id]);
  return r.rows[0] ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Chat not found.' });
});
