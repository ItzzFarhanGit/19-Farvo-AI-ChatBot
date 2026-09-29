/** Google Gemini REST call with model fallback (each model has separate capacity). */
const MODELS = () => [...new Set([
  process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'
])];

export const SYSTEM = () =>
  'You are Farvo AI, the friendly assistant built by Farvo Digital. Be clear, helpful and concise. ' +
  'Use Markdown for lists and code. Reply in the same language the user writes in (including Tamil, Tanglish, Sinhala, English). ' +
  `Today's date is ${new Date().toISOString().slice(0, 10)}.`;

// Exact provider error text is only shown when DEBUG_ERRORS=1 or outside production
const dbg = d => (process.env.DEBUG_ERRORS === '1' || process.env.VERCEL_ENV !== 'production' ? (d && d.error && d.error.message) : undefined);

export async function askGemini(key, contents) {
  const deadline = Date.now() + 55000;
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const models = MODELS();
  let r = null, d = {}, timedOut = false;

  outer: for (let i = 0; i < models.length; i++) {
    for (let attempt = 0; attempt < (i === 0 ? 2 : 1); attempt++) {
      const left = deadline - Date.now();
      if (left < 3000) break outer;
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${models[i]}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM() }] }, contents, generationConfig: { maxOutputTokens: 16384 } }),
          signal: AbortSignal.timeout(Math.min(28000, left))
        });
        d = await r.json().catch(() => ({}));
      } catch (e) { timedOut = true; r = null; break; }   // timeout -> try next model
      timedOut = false;
      if (r.ok || ![404, 429, 500, 503].includes(r.status)) break outer;
      console.error(`Gemini ${models[i]} -> ${r.status}: ${d.error && d.error.message}`);
      if (r.status === 503 && attempt === 0 && i === 0) await sleep(800); else break;
    }
  }

  if (!r) return { ok: false, status: 504, error: timedOut ? 'The AI took too long to answer. Please try again.' : 'Could not reach the AI service. Please try again.' };
  if (r.status === 429 || r.status === 503) return { ok: false, status: r.status, error: 'The AI is very busy right now. Please try again in a few seconds.', detail: dbg(d) };
  if (!r.ok) {
    console.error('Gemini error', r.status, d.error && d.error.message);
    const setup = r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test((d.error && d.error.message) || ''));
    return { ok: false, status: 502, error: setup ? 'The AI service is not set up correctly (API key problem). Please tell the site owner.' : 'The AI service had a problem. Please try again.', detail: dbg(d) };
  }
  const cand = d.candidates && d.candidates[0];
  const reply = cand && cand.content && cand.content.parts
    ? cand.content.parts.filter(p => !p.thought).map(p => p.text || '').join('').trim() : '';
  if (!reply) {
    return { ok: false, status: 502, error:
      cand && cand.finishReason === 'MAX_TOKENS' ? 'The answer was too long to finish. Try a shorter question.'
      : d.promptFeedback && d.promptFeedback.blockReason ? 'That request was blocked by safety filters. Try rephrasing.'
      : 'The model returned an empty response. Please try again.' };
  }
  return { ok: true, reply };
}
