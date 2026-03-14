# Whoer Live v4 — Vercel Edition

IP checker & privacy score tool. Fully compatible with Vercel serverless.

## What's new in v4
- ✅ Vercel serverless compatible (no `app.listen`)
- ✅ SQLite replaced with Vercel KV (Redis) — falls back to in-memory for local dev
- ✅ HTTPS IP lookups (ipapi.co primary, ip-api.com fallback)
- ✅ WebRTC leak detection (real browser test via STUN)
- ✅ Audio fingerprinting
- ✅ Font probe fingerprinting
- ✅ Language mismatch detection
- ✅ Richer scoring with labelled risk/warning breakdown
- ✅ Redesigned UI with loading overlay, inline score, fingerprint grid

## Deploy to Vercel

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Clone / unzip and install deps
```bash
cd whoer-vercel
npm install
```

### 3. Deploy
```bash
vercel
```
Follow the prompts. Select your account and project name.

### 4. Set up Vercel KV (optional but recommended)
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **Storage** → **Create Database** → **KV**
3. Connect it to your project
4. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically

Without KV, the app works perfectly — it just doesn't persist reports between serverless invocations.

### 5. Production deploy
```bash
vercel --prod
```

## Local development
```bash
npm start
# or
vercel dev
```
App runs at http://localhost:3000

## Environment variables
See `.env.example` for required vars.

## Project structure
```
whoer-vercel/
├── api/
│   └── index.js          ← Express app (serverless export)
├── views/
│   └── scan.ejs          ← Main page template
├── public/
│   ├── css/style.css     ← Styles
│   └── js/fp.js          ← Client fingerprint + WebRTC
├── vercel.json           ← Vercel routing config
├── package.json
└── .env.example
```
