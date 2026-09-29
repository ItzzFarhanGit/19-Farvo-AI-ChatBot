# Farvo AI — Gemini chatbot + Postgres database (Vercel)

Static frontend + Vercel serverless API + PostgreSQL (Neon).
- **Guests**: chat instantly, history stays in the browser.
- **Signed-in users**: register / login, chats saved in the database and available on every device.
- Guest chats are imported into the account automatically on first sign-in.
- Phone-friendly (works on old Android browsers too), dark/light theme, image/PDF attachments, Markdown + code copy.

## Deploy (all free)

1. **Gemini key** — https://aistudio.google.com/apikey
2. **Push this folder to GitHub.**
3. **Vercel** → Add New → Project → import the repo → Framework **Other** → no build command → *don't deploy yet*.
4. **Database** — in the Vercel project: **Storage → Create Database → Neon (Postgres)** → connect to this project.
   Vercel adds `DATABASE_URL` automatically. (Supabase also works: put its Postgres connection string in `DATABASE_URL`.)
5. **Settings → Environment Variables** → add `GEMINI_API_KEY` = your key.
6. **Deploy.** Tables are created automatically on the first request (`db/schema.sql` is there for reference).
7. Open `https://YOUR-APP.vercel.app/api/health` — should show `"database":"connected"` and `"gemini_key":true`.

Tip: Settings → Functions → set the region close to your Neon database (e.g. Singapore) for faster replies.
Added the variables after deploying? Redeploy once.

## Environment variables

| Name | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Google AI Studio key |
| `DATABASE_URL` | for accounts | Postgres URL (added by Neon integration). Without it the app still works in guest mode |
| `GEMINI_MODEL` | no | default `gemini-3.8-flash` (falls back to 3.5-flash, 3.5-flash-lite, 3.1-flash-lite) |
| `DAILY_LIMIT` | no | messages per user per day, default 150 (0 = unlimited) |
| `DEBUG_ERRORS` | no | `1` shows the exact Gemini error in chat while debugging |

## Local run
```
npm install
cp .env.example .env.local   # fill values
npx vercel dev
```

## API
`POST /api/auth/register|login|logout|delete` · `GET /api/auth/me` · `POST /api/chat` · `GET|DELETE /api/chats` ·
`GET|PATCH|DELETE /api/chats/:id` · `POST /api/chats/import` · `GET /api/health`

## Security notes
Passwords hashed with scrypt; sessions are random tokens stored hashed in the DB (HttpOnly, Secure, SameSite=Lax cookie);
every chat query is scoped to the signed-in user; cross-site POSTs are rejected; the Gemini key never reaches the browser.
The in-memory rate limit is best-effort — for heavy public traffic add Redis (Upstash) rate limiting.

## Tests
`npm test` runs API tests against an in-memory Postgres with a mocked Gemini.
