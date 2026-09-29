/**
 * PostgreSQL access (works with Neon, Supabase, Vercel Postgres, any Postgres).
 * Reads the connection string from DATABASE_URL (or POSTGRES_URL).
 * Tables are created automatically on the first request.
 */
import pg from 'pg';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS chats_user_updated_idx ON chats(user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY, chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')), content TEXT NOT NULL DEFAULT '',
  files JSONB NOT NULL DEFAULT '[]'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id, id);
`;

let pool = null;
let ready = null;

export const connectionString = () =>
  process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || '';

export const hasDb = () => !!pool || !!connectionString();

function makePool() {
  const raw = connectionString();
  let cs = raw, local = false;
  try {
    const u = new URL(raw);
    local = ['localhost', '127.0.0.1'].includes(u.hostname);
    // pg lets the URL override the ssl option, so strip these and set ssl ourselves
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    cs = u.toString();
  } catch (e) { /* keep raw */ }
  return new pg.Pool({
    connectionString: cs,
    ssl: local ? false : { rejectUnauthorized: false },
    max: 3,                       // serverless: keep the pool tiny
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });
}

function getPool() {
  if (!pool) {
    if (!connectionString()) throw Object.assign(new Error('Database is not configured.'), { code: 'NO_DB' });
    pool = makePool();
    pool.on('error', e => console.error('pg pool error', e.message));
  }
  return pool;
}

async function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      try { await getPool().query(SCHEMA); }
      catch (e) {
        // two cold starts creating tables at once can collide once; retry
        await new Promise(r => setTimeout(r, 300));
        await getPool().query(SCHEMA);
      }
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

export async function query(text, params) {
  await ensureSchema();
  return getPool().query(text, params);
}

/** Run several statements atomically: tx(async q => { await q('...'); ... }) */
export async function tx(fn) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn((t, p) => client.query(t, p));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (x) { /* ignore */ }
    throw e;
  } finally { client.release(); }
}

// Test hook: inject any pg-compatible pool ({ query, connect })
export function _setPool(p) { pool = p; ready = null; }
