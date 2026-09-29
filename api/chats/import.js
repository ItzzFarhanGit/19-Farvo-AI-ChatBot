/** POST /api/chats/import  { chats: [{id?, title, messages:[{role, content, files?}]}] }  (moves guest chats into the account) */
import { tx } from '../../lib/db.js';
import { getUser } from '../../lib/auth.js';
import { send, readJson, methodNotAllowed, sameOrigin, route, UUID_RE } from '../../lib/http.js';
import crypto from 'node:crypto';

export default route(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!sameOrigin(req)) return send(res, 403, { error: 'Blocked cross-site request.' });
  const user = await getUser(req);
  if (!user) return send(res, 401, { error: 'Please sign in.', code: 'auth' });
  const body = await readJson(req);
  const list = Array.isArray(body.chats) ? body.chats : [];
  return send(res, 200, { imported: await run(user, list) });
});

async function run(user, list) {
  const chats = list.slice(0, 50).filter(c => c && Array.isArray(c.messages) && c.messages.length);
  let n = 0;
  await tx(async q => {
    for (const c of chats) {
      const id = UUID_RE.test(String(c.id)) ? c.id : crypto.randomUUID();
      const title = String(c.title || 'Imported chat').slice(0, 60);
      const ins = await q('INSERT INTO chats (id, user_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING RETURNING id', [id, user.id, title]);
      if (!ins.rows[0]) continue;
      for (const m of c.messages.slice(0, 200)) {
        if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') continue;
        const files = (Array.isArray(m.files) ? m.files : []).slice(0, 4).map(f => ({
          name: String((f && f.name) || 'file').slice(0, 80), type: String((f && f.type) || ''),
          ...(f && typeof f.thumb === 'string' && f.thumb.length < 30000 && /^data:image\/jpeg;base64,/.test(f.thumb) ? { thumb: f.thumb } : {})
        }));
        await q('INSERT INTO messages (chat_id, role, content, files) VALUES ($1, $2, $3, $4::jsonb)', [id, m.role, m.content.slice(0, 20000), JSON.stringify(files)]);
      }
      n++;
    }
  });
  return n;
}
