# WC2026 Sweepstake Tracker

World Cup 2026 sweepstake survival tracker. Stay under 21 goals or you're out.

---

## Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **API-Football** for live match data (free tier, 100 req/day)
- **Vercel** for hosting

---

## Local development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.local.example .env.local
# Edit .env.local — leave FOOTBALL_API_KEY blank to use mock data

# 3. Run
npm run dev
# Open http://localhost:3000
```

Without an API key, mock data is served automatically — no quota needed during development.

---

## GitHub → Vercel deployment

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/wc2026-sweepstake.git
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repo
3. Framework preset: **Next.js** (auto-detected)
4. Add **Environment Variables**:

| Name | Value |
|------|-------|
| `FOOTBALL_API_KEY` | Your API-Football key |
| `FOOTBALL_API_HOST` | `v3.football.api-sports.io` |
| `FOOTBALL_TOURNAMENT_ID` | `1` (confirm at launch — see below) |
| `FOOTBALL_SEASON` | `2026` |

5. Click **Deploy**

---

## Football API setup

1. Sign up free at [api-football.com](https://www.api-football.com/) or via [RapidAPI](https://rapidapi.com/api-sports/api/api-football)
2. Free plan: **100 requests/day** — more than enough with caching
3. Get your key and add it to Vercel environment variables

> **Important:** Confirm the World Cup 2026 league ID before the tournament starts.
> Visit `https://v3.football.api-sports.io/leagues?name=FIFA+World+Cup` with your key.
> It's historically `1` but worth verifying.

---

## Updating entries

Edit `data/entries.json` — one object per entry, 3 teams each:

```json
{ "name": "James", "teams": ["England", "Brazil", "Japan"] }
```

Team names must match exactly (or add to `NAME_MAP` in `lib/football-api.ts`).

---

## Caching

| State | Refresh interval |
|-------|-----------------|
| No match today | 6 hours |
| Match day (pre-kickoff) | 30 minutes |
| Live match | 5 minutes |
| Tournament over | 6 hours |

Frontend polls `/api/sweepstake` every 60 seconds.
The API route returns cached data if still valid — only hits the football API when stale.

**Upgrade to Vercel KV** for cache persistence across serverless cold starts:
See the comment block at the top of `lib/cache.ts`.

---

## Goal counting rules

- ✅ Normal time goals
- ✅ Extra time goals
- ❌ Penalty shootout goals (excluded)
- ❌ Postponed / cancelled matches (ignored)

---

## Status thresholds

| Goals | Status |
|-------|--------|
| 0–14 | Safe |
| 15–18 | Warning |
| 19–21 | Danger |
| 22+ | Bust |

Change in `lib/utils.ts`.
