# Move

**Pre-departure intelligence. One tap tells you whether to leave now.**

Move answers a question every commuter asks and no app answers directly: *should I leave now?*

Instead of handing you a map, a traffic layer, and a weather widget to interpret yourself, Move pulls the live route, the traffic delay against typical conditions, and the weather **sampled along that route at the time you would reach each point** - then has Gemma 4 turn all of it into one decision.

Built for the **Build with Gemma: Ghana** hackathon, submitted under the **GenAI for Good** track.

---

## What makes it different

Most "should I leave" tools check the weather at your origin, or at your destination, and stop there.
A 35-minute drive across Accra can start dry and end in a downpour, and endpoint-only weather cannot see that.

Move samples the forecast at up to four points along the actual route polyline, each one looked up for the **15-minute bucket the traveller will physically be there**, not for right now.
That single design decision is what lets the model say "leave in the next 20 minutes and you get ahead of the rain" instead of "it might rain today".

---

## The one screen

The recommendation card is the whole product. Above the fold is the answer; below "Why this?" is every number behind it.

- **Action** - leave now, wait *N* minutes, or leave by *HH:MM*
- **Mode** - drive or walk, chosen holistically from both ETAs and the weather
- **Stats** - ETA, delay against typical conditions, distance
- **Advisory** - "Bring an umbrella", "Add 10 min buffer, roads will be wet"
- **Why** - the model's reasoning, the per-point weather timeline, the later-departure comparison

---

## Architecture

```
React PWA  ──POST /api/recommendation──▶  NestJS API
(service worker,                              │
 Web Push, offline shell)                     ├─▶ RoutingModule ──▶ Mapbox Directions
        ▲                                     │    driving-traffic + walking + depart_at
        │                                     │
        │                                     ├─▶ WeatherModule ──▶ Open-Meteo
        │                                     │    N points along the polyline, one batched call
        │                                     │
        │                                     ├─▶ LlmModule ──────▶ Gemma 4 (Google AI Studio)
        │                                     │    strict JSON contract via the system role
        │                                     │
        └──Web Push──  NotificationsScheduler ─┴─▶ RecommendationModule
                       (departure-window sweep)     assembles, parses, validates, caches
```

### Backend modules

| Module | Responsibility |
| --- | --- |
| `RoutingModule` | Mapbox geocoding, driving-traffic and walking routes, predictive `depart_at` ETAs, congestion share |
| `WeatherModule` | Distance-based route sampling, one batched Open-Meteo call, arrival-time bucket matching |
| `LlmModule` | Gemma 4 transport with automatic capability downgrade |
| `RecommendationModule` | Payload assembly, defensive parsing, contradiction repair, stale-cache fallback |
| `DestinationsModule` | Saved destinations, scoped by anonymous device id |
| `NotificationsModule` | Web Push subscriptions and the departure-window sweep |

### How Gemma 4 is used

Gemma 4 is the reasoning layer, not a chatbot bolted on the side.

- The **system role** carries a strict output contract, so the UI renders from typed fields with no free-text parsing.
- **Thinking mode is disabled** (`thinkingBudget: 0`) - Move wants a fast decision, not visible exploration.
- The briefing is deliberately **verbose and readable** rather than compressed. Gemma 4's context window is far larger than one trip needs, and readable field names measurably improve small-model reasoning.
- The prompt encodes human judgement the raw data does not contain, for example *"a traffic delay under 5 minutes is normal, never tell someone to wait it out"*.

The model's output is treated as untrusted input:

1. Code fences and prose are stripped, and the first balanced `{...}` is extracted with a string-aware scanner.
2. Fields are coerced - `"about 20 minutes"` becomes `20`, `"5:40 PM"` becomes `"17:40"`, `"WALKING"` becomes `walking`.
3. Contradictions are repaired - a `wait` with no duration becomes `leave_now`, because a blank card is worse than a corrected one.
4. Mode choice is reconciled against reality, so the model can never recommend a 90-minute walk.
5. A parse failure triggers exactly one retry with an explicit correction.

Steps 1-4 are covered by 24 unit tests that run against the compiled output.

### Designed for weak connections

This is a judged criterion for the hackathon, and it shaped real decisions:

- **Stale-cache fallback.** If Mapbox, Open-Meteo, or the model is unreachable, the API replays the last stored answer for that trip with `stale: true`, and the UI shows when it was from. A ten-minute-old answer beats a spinner.
- **Weather degrades independently.** A weather failure does not delete the recommendation; the model is told the forecast is missing so it does not invent one.
- **Route geometry never reaches the client.** The UI draws no map, so shipping thousands of coordinates to a metered phone would be pure waste.
- **One batched weather call** covers every sample point.
- **Tight upstream timeouts** (8s data, 20s model) with retry only on genuinely retryable status codes.
- **Offline app shell** precached by the service worker.

---

## Running it

### Prerequisites

- **Node 24 or newer** - required, the persistence layer uses the built-in `node:sqlite` module
- A **Google AI Studio** API key ([free, no billing](https://aistudio.google.com/apikey))
- A **Mapbox** public access token ([free tier, no card](https://account.mapbox.com/access-tokens/))
- Open-Meteo needs no key at all

### Setup

```bash
npm install
cp .env.example .env          # then fill in the two keys

npm run keys                  # generates a VAPID pair for Web Push
npm run models                # lists the Gemma models your key can reach
```

Set `GEMMA_MODEL` in `.env` to an id from `npm run models`.
That script exists because model ids differ between Gemma releases and serving surfaces, and asking the API beats hard-coding a guess.

```bash
npm run dev                   # API on :3001, PWA on :5173
```

Vite proxies `/api` to the backend, so the browser stays on one origin in development.

### Verifying the setup

```bash
curl http://localhost:3001/api/health
```

```json
{
  "status": "ok",
  "model": "gemma-4-e4b-it",
  "configured": { "gemma": true, "mapbox": true, "weather": true, "push": true }
}
```

### Tests

```bash
npm test
```

Zero test dependencies - Node's built-in `node:test` runner against the compiled output.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Configuration and liveness |
| `GET` | `/api/places/search?q=` | Destination autocomplete |
| `GET` | `/api/places/reverse?lat=&lon=` | Name a GPS fix |
| `POST` | `/api/recommendation` | **The core flow** |
| `GET/POST/PATCH/DELETE` | `/api/destinations` | Saved destinations |
| `GET/POST` | `/api/notifications/*` | Push subscription, test push, manual sweep |

All requests carry an `x-device-id` header. Move has no accounts: the client generates a random id on first launch, which is enough to scope saved destinations and push subscriptions and removes an entire login flow.

### `POST /api/recommendation`

```jsonc
// request
{
  "origin":      { "lat": 5.5560, "lon": -0.1969 },
  "destination": { "lat": 5.6037, "lon": -0.1870, "name": "Achimota Mall" },
  "timezone":    "Africa/Accra"
}
```

The response embeds the contract Gemma 4 is held to:

```jsonc
{
  "advice": {
    "recommendation": "leave_now",     // leave_now | wait | leave_by
    "leave_by_time":  null,            // "HH:MM" or null
    "wait_minutes":   null,            // number or null
    "best_mode":      "driving",       // driving | walking
    "headline":       "Leave now - rain reaches Achimota in about 30 minutes.",
    "reasoning":      "...",
    "advisory":       "Bring an umbrella for the walk from the car park."
  },
  "driving": { "etaMinutes": 24, "trafficDelayMinutes": 2.4, "distanceKm": 9.1, "...": "..." },
  "walking": { "etaMinutes": 108, "...": "..." },
  "weather": { "samples": [ /* one per route sample point */ ], "...": "..." },
  "futureDepartures": [ { "offsetMinutes": 10, "etaMinutes": 26, "deltaMinutes": 2 } ],
  "stale": false
}
```

---

## Proactive notifications

A background sweep re-runs the recommendation for every watched saved destination every few minutes and pushes **only when the answer changes for the better** - `wait` becoming `leave_now`, or a bounded `leave_by` window appearing where there was none.

An alert that fires every sweep is noise, and users turn noise off.

For the origin, the sweep reuses the device's last known position, ignoring anything older than six hours: a phone asleep in a pocket cannot report GPS, and a stale origin would produce a confidently wrong alert.

To demo it without waiting for the timer:

```bash
curl -X POST http://localhost:3001/api/notifications/sweep
```

---

## Deploying

| Piece | Target | Config |
| --- | --- | --- |
| API | Render (Docker) | `render.yaml`, `apps/api/Dockerfile` |
| PWA | Netlify | `netlify.toml` |

Two variables tie them together: set `VITE_API_BASE_URL` on Netlify to the API origin, and `CORS_ORIGINS` on Render to the Netlify origin.

HTTPS is required - service workers and Web Push do not work over plain HTTP.

Mount the Render disk at `/app/data`. Without it the free plan wipes SQLite on every deploy, taking the graceful-degradation cache with it.

---

## Honest limitations

- **Weather grid resolution.** Open-Meteo has no high-resolution regional model over Ghana, so its global grid is roughly 11 km. On a short urban trip several sample points can land in the same grid cell and return the same forecast. The per-point values still differ, because each is read at a **different arrival time** - which is genuine signal - but the spatial resolution only starts paying off on longer trips. Verified against the live API during the build.
- **Predictive traffic.** Mapbox `depart_at` is not enabled on every plan. The service probes once, and on rejection permanently falls back to the live-versus-typical delta as the wait/leave proxy, surfaced in the UI as "predictive traffic unavailable".
- **Mid-trip re-alerting** was scoped as a stretch goal and is not built. The departure-window notification is, and it carries the proactive story on its own.
- **Sampled ETA approximation.** Arrival time at each sample point assumes constant speed along the route. Good enough to pick the right 15-minute forecast bucket; not a claim about second-level accuracy.
- **No accounts.** Clearing browser storage orphans saved destinations. That is the deliberate trade for having no login screen.

---

## Project layout

```
apps/
  api/                  NestJS backend
    src/
      routing/          Mapbox: geocoding, routes, predictive ETAs
      weather/          Open-Meteo: route sampling, WMO code translation
      llm/              Gemma 4 transport and the system contract
      recommendation/   Orchestration, parsing, caching
      destinations/     Saved places
      notifications/    Web Push and the departure-window sweep
      persistence/      node:sqlite connection and migrations
    test/               node:test suites
  web/                  React PWA
    src/
      components/       Recommendation card, search, saved places
      hooks/            Geolocation, Web Push
      sw.ts             Service worker: precache, push, notificationclick
    scripts/            PNG icon generator (no image toolchain needed)
```
