# 🤖 Farvo AI Chatbot

**Farvo AI** is a Gemini-powered AI chatbot by **Farvo Digital**, with user accounts and saved chat history. It runs on Vercel serverless functions and stores data in a Neon PostgreSQL database.

🔗 **Live demo:** https://farvo-ai-chatbot.vercel.app

---

## ✨ Features

- 💬 AI chat powered by **Google Gemini**
- 🔐 Sign up and log in with email and password (passwords are hashed, sessions use hashed tokens)
- 🗂️ Chat history saved per user in **PostgreSQL**
- 📱 Responsive chat interface for desktop and mobile
- ⏱️ Configurable daily message limit
- ☁️ Serverless deployment on **Vercel**

---

## 🛠️ Tech Stack

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Frontend   | HTML, CSS, JavaScript               |
| Backend    | Node.js serverless functions (`/api`) |
| AI         | Google Gemini API                   |
| Database   | Neon (Serverless PostgreSQL)        |
| Hosting    | Vercel                              |

---

## 📁 Project Structure

```
19-Farvo-AI-ChatBot/
├── api/            # Serverless API routes
├── assets/         # Images and static assets
├── css/            # Stylesheets
├── db/             # Database schema (schema.sql)
├── js/             # Frontend scripts
├── lib/            # Shared backend helpers
├── tests/          # Tests
├── chat.html       # Chat page
├── index.html      # Landing / login page
├── vercel.json     # Vercel configuration
├── package.json
└── .env.example    # Environment variable template
```

---

## 🗄️ Database

The app uses PostgreSQL with 4 tables:

| Table      | Purpose                               |
| ---------- | ------------------------------------- |
| `users`    | User accounts (email, password hash)  |
| `sessions` | Login sessions (hashed tokens, expiry) |
| `chats`    | Chat conversations per user           |
| `messages` | User and assistant messages per chat  |

The schema is in `db/schema.sql`. The app creates the tables automatically on the first request, or you can run the file manually in the Neon SQL Editor.

---

## ⚙️ Environment Variables

Copy `.env.example` to `.env.local` for local development. On Vercel, add these under **Settings → Environment Variables**.

| Variable         | Required | Description                                             |
| ---------------- | -------- | ------------------------------------------------------- |
| `GEMINI_API_KEY` | ✅       | Google Gemini API key (https://aistudio.google.com/apikey) |
| `DATABASE_URL`   | ✅       | PostgreSQL connection string (Vercel adds it when you connect Neon) |
| `GEMINI_MODEL`   | Optional | Gemini model name to use                                |
| `DAILY_LIMIT`    | Optional | Max messages per day (default in `.env.example`)        |
| `DEBUG_ERRORS`   | Optional | Set to `1` to show exact Gemini error text while debugging. Remove in production. |

> ⚠️ Never commit your real `.env` file or API keys to GitHub.

---

## 🚀 Deploy on Vercel

1. Push this repo to GitHub.
2. Go to https://vercel.com/new and **Import** the repository.
3. Framework Preset: **Other**.
4. In your Vercel project, open **Storage → Create Database → Neon**, then **Connect Project**. `DATABASE_URL` is added automatically.
5. Under **Settings → Environment Variables**, add `GEMINI_API_KEY` (Production, Preview and Development).
6. Click **Deploy** (or **Redeploy** after adding variables).
7. Open your live URL, sign up, and start chatting.

---

## 💻 Run Locally

```bash
# 1. Clone the repo
git clone https://github.com/ItzzFarhanGit/19-Farvo-AI-ChatBot.git
cd 19-Farvo-AI-ChatBot

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env.local
# then fill in GEMINI_API_KEY and DATABASE_URL

# 4. Run with the Vercel CLI
npm i -g vercel
vercel dev
```

---

## 🧩 Troubleshooting

- **Chat gives no reply:** check that `GEMINI_API_KEY` is set for Production and that you redeployed after adding it. Set `DEBUG_ERRORS=1` temporarily to see the exact error.
- **"Model not found" error:** set `GEMINI_MODEL` to a model available for your API key (see Google AI Studio).
- **Sign up fails:** check `DATABASE_URL` in Environment Variables and confirm the tables exist in the `public` schema.
- **Env variable changes not applied:** Vercel needs a new deployment. Use **Deployments → ⋯ → Redeploy**.

---

## 👨‍💻 Author

**Mohamed Farhan** — Full Stack Web Developer & UI/UX Designer (**FARVO**)

- 🔗 LinkedIn: https://linkedin.com/in/mohamedfarhan-it
- 🐙 GitHub: [@ItzzFarhanGit](https://github.com/ItzzFarhanGit)

---

## 📄 License

This project is for learning and portfolio purposes. Add a license file if you plan to open-source it.
