/** GET /api/health  -> quick deployment check (no secrets are returned). */
import { query, hasDb } from '../lib/db.js';
import { send, route } from '../lib/http.js';

export default route(async (req, res) => {
  const out = { ok: true, gemini_key: !!process.env.GEMINI_API_KEY, database_url: hasDb(), database: 'not configured' };
  if (hasDb()) {
    try { await query('SELECT 1'); out.database = 'connected'; }
    catch (e) { out.ok = false; out.database = 'error: ' + String(e.message).slice(0, 120); }
  }
  if (!out.gemini_key) out.ok = false;
  return send(res, out.ok ? 200 : 503, out);
});
