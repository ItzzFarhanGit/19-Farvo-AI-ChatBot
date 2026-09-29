/**
 * POST /api/chat
 *  - signed in : { chatId, message, files? }   -> history is loaded from / saved to the database
 *  - guest     : { messages: [{role, content, files?}] }  -> stateless (browser keeps history)
 * GEMINI_API_KEY lives only in Vercel env vars and never reaches the browser.
 */
import { hasDb, query, tx } from '../lib/db.js';
import { getUser } from '../lib/auth.js';
import { askGemini } from '../lib/gemini.js';
import { send, readJson, methodNotAllowed, sameOrigin, limited, clientIp, route, UUID_RE } from '../lib/http.js';

const MAX_MESSAGES = 20, MAX_CHARS = 4000, MAX_FILES = 4, MAX_B64 = 4_000_000;
const OK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']);
const DAILY_LIMIT = () => parseInt(process.env.DAILY_LIMIT || '150', 10);

function checkFiles(list) {
  const files = (Array.isArray(list) ? list : []).slice(0, MAX_FILES);
  let total = 0;
  for (const f of files) {
    if (!f || !OK_TYPES.has(f.type) || typeof f.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(f.data)) return { error: 'Unsupported attachment.' };
    total += f.data.length;
  }
  if (total > MAX_B64) return { error: 'Attachments are too large.', status: 413 };
  return { files };
}

// Turns [{role, text, files?}] into Gemini "contents" (roles must alternate)
function toContents(turns, lastFiles) {
  const contents = [];
  turns.forEach((m, idx) => {
    const role = m.role === 'assistant' ? 'model' : 'user', parts = [];
    if (idx === turns.length - 1 && lastFiles) lastFiles.forEach(f => parts.push({ inlineData: { mimeType: f.type, data: f.data } }));
    parts.push({ text: (m.text || '').trim() || '(see attachment)' });
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts); else contents.push({ role, parts });
  });
  return contents;
}

const titleFrom = (text, files) => (String(text || '').replace(/\s+/g, ' ').trim() || (files[0] && files[0].name) || 'New chat').slice(0, 40);
const meta = files => files.map(f => ({
  name: String(f.name || 'file').slice(0, 80), type: f.type,
  ...(typeof f.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f.thumb) && f.thumb.length < 30000 ? { thumb: f.thumb } : {})
}));

export default route(async (req, res) => {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!sameOrigin(req)) return send(res, 403, { error: 'Blocked cross-site request.' });
  const key = process.env.GEMINI_API_KEY;
  if (!key) return send(res, 500, { error: 'Server is not configured (missing GEMINI_API_KEY).' });

  const ip = clientIp(req);
  if (limited('chat', ip, 12, 60000)) return send(res, 429, { error: 'Too many messages. Please wait a minute and try again.' });
  const body = await readJson(req);

  // ---------- Signed-in mode (database) ----------
  if (body.chatId !== undefined) {
    if (!hasDb()) return send(res, 503, { error: 'Database is not configured on this site yet.', code: 'no_db' });
    const user = await getUser(req);
    if (!user) return send(res, 401, { error: 'Your session expired. Please sign in again.', code: 'auth' });
    const chatId = String(body.chatId);
    if (!UUID_RE.test(chatId)) return send(res, 400, { error: 'Invalid chat id.' });

    const text = typeof body.message === 'string' ? body.message.slice(0, MAX_CHARS + 500) : '';
    const fc = checkFiles(body.files);
    if (fc.error) return send(res, fc.status || 400, { error: fc.error });
    if (!text.trim() && !fc.files.length) return send(res, 400, { error: 'Empty message.' });

    const lim = DAILY_LIMIT();
    if (lim > 0) {
      const c = await query(`SELECT count(*)::int AS n FROM messages m JOIN chats c ON c.id = m.chat_id
                             WHERE c.user_id = $1 AND m.role = 'user' AND m.created_at > now() - interval '1 day'`, [user.id]);
      if (c.rows[0].n >= lim) return send(res, 429, { error: `Daily limit reached (${lim} messages). Please try again tomorrow.` });
    }

    const ex = await query('SELECT user_id, title FROM chats WHERE id = $1', [chatId]);
    if (ex.rows[0] && String(ex.rows[0].user_id) !== user.id) return send(res, 404, { error: 'Chat not found.' });

    let turns = [];
    if (ex.rows[0]) {
      const h = await query('SELECT role, content, files FROM messages WHERE chat_id = $1 ORDER BY id DESC LIMIT $2', [chatId, MAX_MESSAGES - 1]);
      turns = h.rows.reverse().map(m => ({
        role: m.role,
        text: m.content + ((m.files || []).length ? ' [Earlier attachments: ' + m.files.map(f => f.name).join(', ') + ']' : '')
      }));
      while (turns.length && turns[0].role !== 'user') turns.shift();
    }
    turns.push({ role: 'user', text });

    const g = await askGemini(key, toContents(turns, fc.files));
    if (!g.ok) return send(res, g.status, { error: g.error, detail: g.detail });

    const title = titleFrom(text, fc.files);
    const saved = await tx(async q => {
      if (!ex.rows[0]) await q('INSERT INTO chats (id, user_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [chatId, user.id, title]);
      await q('INSERT INTO messages (chat_id, role, content, files) VALUES ($1, $2, $3, $4::jsonb)', [chatId, 'user', text, JSON.stringify(meta(fc.files))]);
      await q('INSERT INTO messages (chat_id, role, content) VALUES ($1, $2, $3)', [chatId, 'assistant', g.reply]);
      const u = await q(`UPDATE chats SET updated_at = now(), title = CASE WHEN title = 'New chat' THEN $3 ELSE title END
                         WHERE id = $1 AND user_id = $2 RETURNING title`, [chatId, user.id, title]);
      return u.rows[0];
    });
    return send(res, 200, { reply: g.reply, title: saved ? saved.title : title });
  }

  // ---------- Guest mode (stateless) ----------
  const { messages } = body;
  if (!Array.isArray(messages) || !messages.length) return send(res, 400, { error: 'No messages provided.' });
  const clean = messages.slice(-MAX_MESSAGES)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, text: m.content.slice(0, MAX_CHARS + 500), files: Array.isArray(m.files) ? m.files : [] }));
  while (clean.length && clean[0].role !== 'user') clean.shift();
  const last = clean[clean.length - 1];
  if (!last || last.role !== 'user') return send(res, 400, { error: 'Last message must be from the user.' });
  const fc = checkFiles(last.files);
  if (fc.error) return send(res, fc.status || 400, { error: fc.error });
  if (!last.text.trim() && !fc.files.length) return send(res, 400, { error: 'Empty message.' });

  const g = await askGemini(key, toContents(clean, fc.files));
  if (!g.ok) return send(res, g.status, { error: g.error, detail: g.detail });
  return send(res, 200, { reply: g.reply });
});
