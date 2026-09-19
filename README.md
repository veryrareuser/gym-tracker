# Gym Tracker

A mobile-first PWA to track your gym progress. Built with React + Vite + Tailwind CSS, backed by Supabase for cloud sync with localStorage offline fallback.

## Features

- 🔐 Password-protected (password: configured in `src/App.jsx`)
- 💪 Log workouts with per-set weight + reps tracking
- 📅 Session history with monthly grouping
- 📈 Analytics: weight progression charts, volume per session, personal records
- 🏋️ Manage your exercise list (add, edit, delete)
- 📡 Syncs across all devices via Supabase
- 📴 Works offline with localStorage cache

## Tech Stack

- React 19 + Vite 8
- Tailwind CSS v4
- React Router v6 (hash mode for GitHub Pages)
- Supabase (free tier) for cloud sync
- Recharts for analytics
- Lucide React for icons
- gh-pages for deployment

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up Supabase
1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `supabase-schema.sql`
3. Copy your **Project URL** and **anon public key** from Project Settings → API

### 3. Configure environment variables
Edit `.env.local`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

> **Note:** Without these variables, the app works fine using localStorage only (single device).

### 4. Run locally
```bash
npm run dev
```

### 5. Deploy to GitHub Pages
1. Create a GitHub repository named `gym-tracker`
2. Push this folder to the repo
3. Run:
```bash
npm run deploy
```
4. In GitHub repo settings → Pages → set source to `gh-pages` branch

Your app will be live at `https://YOUR_USERNAME.github.io/gym-tracker/`

> For Supabase env vars on GitHub Pages, add them as **Repository Secrets** and use a GitHub Actions workflow, or simply hardcode them in `.env.local` before building (the anon key is safe to expose publicly).

## Changing the Password

Open `src/App.jsx` and change:
```js
const PASSWORD = '200740'
```

## Data Structure

See `supabase-schema.sql` for the full relational schema. All data is also mirrored to `localStorage` keys:
- `gym_exercises` — exercise definitions
- `gym_sessions` — all workout sessions with nested logs and sets
