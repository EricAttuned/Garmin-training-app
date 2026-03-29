# RunForge — Adaptive Running Training for Garmin

A free, self-hosted alternative to Runna that generates adaptive training plans and pushes structured workouts directly to your Garmin watch.

## Features

- **Adaptive Training Plans** — Periodized plans (Base → Build → Peak → Taper) for 5K through Ultra 50K
- **VDOT-Based Pacing** — Training paces calculated from your recent race results using Jack Daniels' methodology
- **Garmin Integration** — Push structured workouts directly to your Garmin Fénix (or any Garmin watch)
- **Smart Adaptation** — Analyzes your recent Garmin activities and adjusts paces/volume based on:
  - Pace trends across easy and workout runs
  - Heart rate drift detection for fatigue
  - Training consistency tracking
- **Mobile-First UI** — Designed for your phone with PWA support (add to home screen)
- **Workout Calendar** — Full plan view with weekly breakdown by training phase

## Setup

### 1. Deploy to Netlify

Or manually:
```bash
git clone https://github.com/ericattuned/garmin-training-app.git
cd garmin-training-app
npm install
netlify deploy --prod
```

### 2. Get Garmin API Credentials

1. Go to [developer.garmin.com](https://developer.garmin.com/) and create a developer account
2. Register a new application
3. Request access to the **Health API** and **Training API** (for pushing workouts)
4. Note your **Consumer Key** and **Consumer Secret**
5. Set the OAuth callback URL to: `https://YOUR-SITE.netlify.app/api/garmin-callback`

### 3. Configure Environment Variables

In your Netlify dashboard → Site Settings → Environment Variables, add:

| Variable | Description |
|----------|-------------|
| `GARMIN_CONSUMER_KEY` | Your Garmin developer consumer key |
| `GARMIN_CONSUMER_SECRET` | Your Garmin developer consumer secret |
| `SITE_URL` | Your Netlify site URL (e.g., `https://my-app.netlify.app`) |

### 4. Connect Your Garmin

Open the app → Settings → Connect Garmin. This authorizes the app to read your activities and push workouts.

## How It Works

### Plan Generation

1. Choose your race distance and date
2. Optionally enter a goal time and/or recent race result
3. The engine estimates your VDOT and generates training paces
4. A periodized plan is created with appropriate workout types for each phase

### Workout Types

| Type | Description |
|------|-------------|
| Easy Run | Conversational pace, aerobic base building |
| Long Run | Extended aerobic effort |
| Tempo | Sustained threshold effort |
| Intervals | Hard repeats (400m–1000m) with recovery |
| Repetitions | Short, fast 200m repeats for speed |
| Race Pace | Extended segments at goal pace |
| Recovery | Very easy, short jog |

### Adaptation

When you tap "Adapt Plan," the app:
1. Fetches your last 30 days of Garmin activities
2. Analyzes pace trends, HR patterns, and consistency
3. Adjusts your VDOT estimate and recalculates training paces
4. Regenerates the remaining plan with updated targets

### Pushing to Garmin

- **Push Week**: Sends the next 7 days of workouts to your Garmin Connect account, which syncs to your watch
- **Push Single**: Sends an individual workout from the detail view
- Workouts appear as structured workouts on your Fénix with pace targets for each interval

## Tech Stack

- **Frontend**: Vanilla JS, mobile-first CSS (no framework needed)
- **Backend**: Netlify Functions (Node.js)
- **Storage**: Netlify Blobs (plans, user data, Garmin tokens)
- **Auth**: Garmin Connect OAuth 1.0a
- **APIs**: Garmin Health API (activities), Garmin Training API (push workouts)

## Local Development

```bash
npm install
netlify dev
```

The app runs at `http://localhost:8888`. Garmin OAuth won't work locally (requires HTTPS callback), but you can test plan generation without it.

## License

MIT
