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
| `PlacesModule` | Destination search and reverse geocoding via Photon/OpenStreetMap, Ghana-restricted, with result ranking |
| `RoutingModule` | Mapbox driving-traffic and walking routes, predictive `depart_at` ETAs, congestion share |
| `WeatherModule` | Distance-based route sampling, one batched Open-Meteo call, arrival-time bucket matching |
| `LlmModule` | Gemma 4 transport with automatic capability downgrade |
| `RecommendationModule` | Payload assembly, defensive parsing, contradiction repair, stale-cache fallback |
| `DestinationsModule` | Saved destinations, scoped by anonymous device id |
| `NotificationsModule` | Web Push subscriptions and the departure-window sweep |

### How Gemma 4 is used

Gemma 4 is the reasoning layer, not a chatbot bolted on the side.

Model: **`gemma-4-26b-a4b-it`**, the sparse mixture-of-experts variant with roughly 4B active parameters. It and `gemma-4-31b-it` are the only Gemma 4 variants served on the AI Studio API - the smaller E2B/E4B/12B sizes are not available there, so the MoE model is the fast option.

- The **system role** carries a strict output contract, so the UI renders from typed fields with no free-text parsing.
- The briefing is deliberately **verbose and readable** rather than compressed. Gemma 4's context window is far larger than one trip needs, and readable field names measurably improve small-model reasoning.
- The prompt encodes human judgement the raw data does not contain, for example *"a traffic delay under 5 minutes is normal, never tell someone to wait it out"*.
- The client asks for `thinkingBudget: 0`, but **this model rejects it** and thinks unconditionally. The request is still made because other deployments accept it, and the client downgrades cleanly when it is refused.

**Thinking is always on, and it lands in the response body.** A real reply is several hundred tokens of reasoning prose, often containing draft JSON objects and fenced examples, followed by the actual answer. Two consequences shape the code:

- `maxOutputTokens` is **2500**, because thinking tokens are charged against that budget. At 800 the answer was being truncated mid-string.
- The parser collects *every* balanced object and walks them **backwards**, since the model's final answer is its last one. Taking the first object returns a discarded draft.

The model's output is treated as untrusted input:

1. Every balanced `{...}` is located with a string-aware scanner and the candidates are tried newest-first, so leaked reasoning and draft objects are skipped. A truncated final answer falls back to the last complete draft rather than failing.
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
- A **Mapbox** access token for routing ([free tier, no card](https://account.mapbox.com/access-tokens/))
- Open-Meteo and Photon need no key at all

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
  "model": "gemma-4-26b-a4b-it",
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

The two halves deploy separately.

| Piece | Type | Where | Config |
| --- | --- | --- | --- |
| API | **Web service** - a process that must stay running | Render | `render.yaml`, `apps/api/Dockerfile` |
| PWA | **Static site** - just built files, nothing executes | Anywhere static | `netlify.toml` if you use Netlify |

The API cannot be a static site: it holds the API keys, owns the SQLite file, and runs the notification timer. The PWA should not be a web service: `vite build` produces finished files, so a CDN serves them better and free.

**API.** `apps/api/Dockerfile` builds a self-contained image, so anything that runs a container will host it. It listens on `PORT` (default 3001) and answers `GET /api/health` for health checks. Required environment: `GOOGLE_AI_API_KEY`, `MAPBOX_ACCESS_TOKEN`, `GEMMA_MODEL`, `CORS_ORIGINS`, and the VAPID pair if you want push.

**PWA.** Build with `npm run build --workspace @move/web` and publish `apps/web/dist`. `apps/web/public/_redirects` carries the single-page routing rule in a format most static hosts understand; `netlify.toml` is included if you use Netlify.

**Two values wire the halves together, and both are manual:**

1. `CORS_ORIGINS` on the API → the origin the PWA is served from
2. `VITE_API_BASE_URL` on the frontend host → the API's URL, read at **build** time, so changing it means rebuilding

Get either wrong and the browser blocks every request while the page itself loads fine. A bare hostname is accepted for both: each side adds the `https://` scheme itself.

HTTPS is required: service workers and Web Push do not work over plain HTTP.

**If you host the API on a free tier, expect two things.** Free instances usually sleep when idle and take up to a minute to wake, so the page loads instantly and the first recommendation hangs - warm it before a demo, or point an uptime check at `/api/health`. And free instances rarely offer persistent storage, so SQLite sits on an ephemeral filesystem: saved destinations, push subscriptions, and the stale cache are wiped on every deploy and restart. The schema is re-created on boot, so the app starts empty rather than broken. Mount a volume at `/app/data` (or set `DATABASE_PATH` elsewhere) to keep data.

A sleeping instance also runs no timers, so the departure-window sweep only fires while something is keeping the service awake.

---

### Why search and routing use different providers

Mapbox routes Ghana well but barely knows its place names. Measured against a live token:

| Query | Mapbox Geocoding v6 | Photon / OpenStreetMap |
| --- | --- | --- |
| Accra Mall | Mallam, Mallam Borla | **Accra Mall** (shopping mall) |
| University of Ghana | "Ghana", the country | **University of Ghana** |
| Presec | *no results* | **Presbyterian Boys' Senior High School** |
| Achimota | *no results* | **Achimota** town, School, Retail Centre |
| Kotoka | Kotoko, a Kumasi locality | **Accra International Airport** |

Mapbox's Search Box API does not rescue this - asked for POIs near Accra it returned an event organiser in Indonesia, and "coffee" near Accra returned nothing. The data simply is not there. OpenStreetMap has all of it, because it is mapped by people who live there.

So `PlacesModule` uses Photon, which is built for type-ahead and needs no API key, and falls back to Mapbox geocoding if Photon is unreachable. Search is confined to `SEARCH_COUNTRY_CODE` and `SEARCH_BBOX`.

OpenStreetMap answers a name query with *everything* carrying that name, so results are ranked before display: a search for "Accra Mall" also matches the bus stop outside it, its car park, and its food court. Results are tiered so the thing you would actually travel to comes first, near-duplicates sharing a name within 400 m are collapsed, and each result carries a plain-English category ("Shopping mall", "University") so the Achimota suburb is distinguishable from Achimota School.

## Honest limitations

- **Weather grid resolution.** Open-Meteo has no high-resolution regional model over Ghana, so its global grid is roughly 11 km. On a short urban trip several sample points can land in the same grid cell and return the same forecast. The per-point values still differ, because each is read at a **different arrival time** - which is genuine signal - but the spatial resolution only starts paying off on longer trips. Verified against the live API during the build.
- **Predictive traffic.** Mapbox `depart_at` is not enabled on every plan. The service probes once, and on rejection permanently falls back to the live-versus-typical delta as the wait/leave proxy, surfaced in the UI as "predictive traffic unavailable".
- **Mid-trip re-alerting** was scoped as a stretch goal and is not built. The departure-window notification is, and it carries the proactive story on its own.
- **Sampled ETA approximation.** Arrival time at each sample point assumes constant speed along the route. Good enough to pick the right 15-minute forecast bucket; not a claim about second-level accuracy.
- **No accounts.** Clearing browser storage orphans saved destinations. That is the deliberate trade for having no login screen.
- **Photon is a shared public instance.** Komoot runs it as a courtesy with no formal SLA and asks users to be fair. Fine for a demo; point `PHOTON_URL` at your own instance for real traffic.
- **OpenStreetMap coverage is uneven.** It is excellent across Accra and the major cities, thinner in rural areas. Where it has nothing, search falls back to Mapbox, which returns administrative places only.

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
