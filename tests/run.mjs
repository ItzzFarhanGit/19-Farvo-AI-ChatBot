// End-to-end API test with an in-memory Postgres (PGlite) and a mocked Gemini.
// Run once with:  npm i --no-save @electric-sql/pglite && node tests/run.mjs
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { _setPool } from '../lib/db.js';

const pg = new PGlite();
const q = (t, p) => (p && p.length ? pg.query(t, p) : pg.exec(t).then(r => r[r.length - 1] || { rows: [] }));
_setPool({ query: q, connect: async () => ({ query: q, release() {} }), on() {} });
process.env.GEMINI_API_KEY = 'test'; process.env.VERCEL = '1';

let geminiCalls = [];
globalThis.fetch = async (url, opt) => {
  const b = JSON.parse(opt.body); geminiCalls.push(b.contents);
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Reply #' + geminiCalls.length }] } }] }) };
};

const { default: auth } = await import('../api/auth/[action].js');
const { default: chat } = await import('../api/chat.js');
const { default: chats } = await import('../api/chats/index.js');
const { default: one } = await import('../api/chats/[id].js');
const { default: imp } = await import('../api/chats/import.js');
const { default: health } = await import('../api/health.js');

async function call(handler, method, url, body, cookie, query = {}) {
  const req = { method, url, query, headers: { host: 'x.app', origin: 'https://x.app', 'x-forwarded-proto': 'https', 'x-forwarded-for': '1.2.3.4', ...(cookie ? { cookie } : {}) }, body };
  let status, out = '', headers = {};
  const res = { setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: s => { out = s; }, set statusCode(v) { status = v; } };
  await handler(req, res);
  return { status, data: JSON.parse(out), headers };
}
const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let r = await call(health, 'GET', '/api/health'); assert.equal(r.status, 200); assert.equal(r.data.database, 'connected');
r = await call(auth, 'GET', '/api/auth/me', undefined, '', { action: 'me' }); assert.equal(r.data.user, null); assert.equal(r.data.dbEnabled, true);
r = await call(auth, 'POST', '/api/auth/register', { email: 'bad', password: 'longenough1' }, '', { action: 'register' }); assert.equal(r.status, 400);
r = await call(auth, 'POST', '/api/auth/register', { email: 'a@b.co', password: 'short' }, '', { action: 'register' }); assert.equal(r.status, 400);
r = await call(auth, 'POST', '/api/auth/register', { email: 'Farhan@Test.com', password: 'password123', name: 'Farhan' }, '', { action: 'register' });
assert.equal(r.status, 201); assert.equal(r.data.user.email, 'farhan@test.com');
assert.match(r.headers['set-cookie'], /HttpOnly.*Secure|Secure.*HttpOnly/); assert.match(r.headers['set-cookie'], /SameSite=Lax/);
const cookie = r.headers['set-cookie'].split(';')[0];
r = await call(auth, 'POST', '/api/auth/register', { email: 'farhan@test.com', password: 'password123' }, '', { action: 'register' }); assert.equal(r.status, 409);
r = await call(auth, 'POST', '/api/auth/login', { email: 'farhan@test.com', password: 'wrongpass1' }, '', { action: 'login' }); assert.equal(r.status, 401);
r = await call(auth, 'POST', '/api/auth/login', { email: 'nobody@test.com', password: 'wrongpass1' }, '', { action: 'login' }); assert.equal(r.status, 401);
r = await call(auth, 'GET', '/api/auth/me', undefined, cookie, { action: 'me' }); assert.equal(r.data.user.name, 'Farhan');
console.log('auth ok');

// chat: needs login, saves to DB, keeps history
r = await call(chat, 'POST', '/api/chat', { chatId: U, message: 'hi' }); assert.equal(r.status, 401); assert.equal(r.data.code, 'auth');
r = await call(chat, 'POST', '/api/chat', { chatId: U, message: 'Hello there, how are you today?' }, cookie); assert.equal(r.status, 200); assert.equal(r.data.reply, 'Reply #1');
assert.equal(r.data.title, 'Hello there, how are you today?');
r = await call(chat, 'POST', '/api/chat', { chatId: U, message: 'second' }, cookie); assert.equal(r.data.reply, 'Reply #2');
assert.deepEqual(geminiCalls[1].map(c => c.role), ['user', 'model', 'user']);   // history came from the DB
r = await call(chats, 'GET', '/api/chats', undefined, cookie); assert.equal(r.data.chats.length, 1); assert.equal(r.data.chats[0].id, U);
r = await call(one, 'GET', '/api/chats/' + U, undefined, cookie, { id: U }); assert.equal(r.data.messages.length, 4); assert.equal(r.data.messages[3].content, 'Reply #2');
r = await call(one, 'PATCH', '/api/chats/' + U, { title: 'Renamed' }, cookie, { id: U }); assert.equal(r.data.title, 'Renamed');
console.log('chat + history ok');

// isolation: second user cannot touch first user's chat
r = await call(auth, 'POST', '/api/auth/register', { email: 'other@test.com', password: 'password123' }, '', { action: 'register' });
const cookie2 = r.headers['set-cookie'].split(';')[0];
r = await call(chat, 'POST', '/api/chat', { chatId: U, message: 'steal' }, cookie2); assert.equal(r.status, 404);
r = await call(one, 'GET', '/api/chats/' + U, undefined, cookie2, { id: U }); assert.equal(r.status, 404);
r = await call(one, 'DELETE', '/api/chats/' + U, undefined, cookie2, { id: U }); assert.equal(r.status, 404);
r = await call(chats, 'GET', '/api/chats', undefined, cookie2); assert.equal(r.data.chats.length, 0);
console.log('isolation ok');

// failed Gemini call must not leave a half-saved chat
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'bad' } }) });
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
r = await call(chat, 'POST', '/api/chat', { chatId: U2, message: 'x' }, cookie2); assert.equal(r.status, 502);
r = await call(chats, 'GET', '/api/chats', undefined, cookie2); assert.equal(r.data.chats.length, 0);
globalThis.fetch = realFetch;

// guest mode (stateless) still works
r = await call(chat, 'POST', '/api/chat', { messages: [{ role: 'user', content: 'guest hi' }] }); assert.equal(r.status, 200);

// CSRF: cross-origin POST rejected
{ const req = { method: 'POST', url: '/api/chat', headers: { host: 'x.app', origin: 'https://evil.com' }, body: { messages: [] } };
  let st; await chat(req, { setHeader() {}, end() {}, set statusCode(v) { st = v; } }); assert.equal(st, 403); }

// import guest chats
r = await call(imp, 'POST', '/api/chats/import', { chats: [{ id: 'not-a-uuid', title: 'Old', messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }, { title: 'empty', messages: [] }] }, cookie2);
assert.equal(r.data.imported, 1);
r = await call(chats, 'GET', '/api/chats', undefined, cookie2); assert.equal(r.data.chats[0].title, 'Old');

// logout, delete all, delete account
r = await call(auth, 'POST', '/api/auth/logout', {}, cookie, { action: 'logout' });
r = await call(chats, 'GET', '/api/chats', undefined, cookie); assert.equal(r.status, 401);
r = await call(chats, 'DELETE', '/api/chats', undefined, cookie2); r = await call(chats, 'GET', '/api/chats', undefined, cookie2); assert.equal(r.data.chats.length, 0);
r = await call(auth, 'POST', '/api/auth/delete', { password: 'nope' }, cookie2, { action: 'delete' }); assert.equal(r.status, 401);
r = await call(auth, 'POST', '/api/auth/delete', { password: 'password123' }, cookie2, { action: 'delete' }); assert.equal(r.status, 200);
r = await call(auth, 'GET', '/api/auth/me', undefined, cookie2, { action: 'me' }); assert.equal(r.data.user, null);
console.log('ALL BACKEND TESTS PASSED');
process.exit(0);
