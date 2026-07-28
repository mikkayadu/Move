# Move

### Should you leave now? Gemma 4 reads the road, the sky, and the clock, and gives you one answer.

**Track: GenAI for Good**

---

## The problem

Every commuter in Accra asks the same question every morning, and no app answers it.

*Should I leave now?*

What we have instead is raw material. A maps app shows a red line and an ETA. A weather app shows a percentage for a city. Neither tells you that the rain will reach Achimota in twenty-five minutes but not the stretch you are on now, or that the delay you are looking at is four minutes worse than a normal Tuesday and therefore not worth waiting out.

The interpretation is left entirely to the person, at the exact moment they are least able to do it - keys in hand, already half late.

Move collapses that work into one card. You tap a destination once. You get a decision.

## What it does

Move resolves your position, requests driving and walking routes, samples the weather at several points **along the route polyline at the time you would physically reach each one**, and hands the whole briefing to Gemma 4. What comes back is one recommendation: leave now, wait *N* minutes, or leave by *HH:MM* - plus the best mode, a plain-language headline, and a practical advisory such as "Bring an umbrella".

Underneath the card sits a "Why this?" drawer with every number the model saw. A user who trusts the app never opens it. A user who does not can audit the whole decision.

## Why route-specific weather is the core idea

This is the one design decision the product stands on.

Almost everything in this space checks the weather at your origin, or at your destination, and stops. A thirty-five minute drive across Accra can start dry and end in a downpour, and endpoint-only weather is blind to that.

Move samples up to four points spaced by **distance** along the actual route line - not by vertex index, because routing providers emit vertices unevenly, dense through junctions and sparse on a highway, so index-based sampling would cluster every "midpoint" around the nearest interchange. Each point is then read for the fifteen-minute forecast bucket the traveller will actually be standing in, not for right now.

That is what lets the model say *"leave in the next twenty minutes and you stay ahead of it"* rather than *"70% chance of rain today"*.

## How Gemma 4 is used

Gemma 4 is the reasoning layer, not a chatbot bolted onto a dashboard. It is the only component that makes a judgement; everything around it is deterministic plumbing.

**The system role carries a strict contract.** Gemma 4's native `system` role holds a locked output schema, so the interface renders from typed fields and never parses free text. The prompt also encodes judgement the raw numbers do not contain - *"a traffic delay under five minutes is normal, never tell someone to wait it out"*, *"only recommend waiting when the numbers support it"*, *"reason only from the briefing, and if a field is null work without it"*. That last line matters more than it looks: it is what stops a small model inventing a forecast when the weather API is down.

**Thinking mode is off.** `thinkingBudget: 0`. Move wants a fast, decisive answer, not visible exploration. A commuter holding their keys does not want to watch a model deliberate.

**The briefing is verbose on purpose.** Field names read like English - `minutes_better_than_leaving_now`, `rain_clears_in_minutes`, `share_of_route_congested`. Gemma 4's context window is enormous next to one trip's data, so compressing the prompt would trade reasoning quality for bytes we were never short of.

**Single-shot, not agentic.** Gemma 4 supports function calling, and letting it request extra weather samples was tempting. We assembled a complete payload up front instead. One call is one failure mode; a tool loop is several, and demo reliability was worth more than elegance.

**The output is treated as untrusted input.** Open-weight models are far better at *content* than at obeying "no code fences", so the parser is forgiving about packaging and strict about meaning:

- Fences and prose are stripped, and the first balanced `{...}` is extracted with a string-aware scanner that does not trip over a brace inside a headline.
- Fields are coerced: `"about 20 minutes"` becomes `20`, `"WALKING"` becomes `walking`, and `"5:40 PM"` becomes `"17:40"` - that last one is not hypothetical, and rendering it as `05:40` would have shown a departure time twelve hours wrong.
- Contradictions are repaired rather than rejected. A `wait` with no duration becomes `leave_now`, because a blank card is worse than a corrected one.
- The mode choice is reconciled against the routes we actually hold, so the model cannot recommend a ninety-minute walk.
- A genuine parse failure triggers exactly one retry with an explicit correction.

Twenty-four unit tests cover that path, running against the compiled output.

## Architecture

A **React PWA** talks to a **NestJS** backend over a single endpoint, `POST /api/recommendation`.

NestJS modules map one-to-one onto the pipeline: `RoutingModule` (Mapbox driving-traffic and walking, predictive `depart_at` ETAs, congestion share), `WeatherModule` (route sampling and one batched Open-Meteo call), `LlmModule` (Gemma 4 transport), `RecommendationModule` (assembly, parsing, caching), `DestinationsModule`, and `NotificationsModule` with a background sweep.

The PWA is installable, with a Workbox-precached shell and a hand-written service worker - generated workers cannot express the `push` and `notificationclick` logic Move needs.

**Why Open-Meteo:** it needs no API key at all, which removed a signup, a secret, and a rate limit from the critical path, and it accepts batched coordinates so every sample point costs exactly one round trip.

**Why no ORM:** Node 24 ships SQLite in core. Four small tables did not justify an ORM, and `node:sqlite` cannot fail to install.

## Designed for weak connections

Connectivity is a judging criterion here, and it drove real decisions rather than a paragraph.

If Mapbox, Open-Meteo, or the model is unreachable, the API replays the last stored answer for that trip flagged `stale: true`, and the interface says when it was from. A ten-minute-old answer beats a spinner. Weather degrades independently of routing, so a forecast outage costs you the umbrella advice, not the recommendation. Route geometry is stripped before the response leaves the server - the UI draws no map, so shipping thousands of coordinates to a metered phone would be waste.

## Proactive notifications

Saved destinations can be watched. A background sweep re-runs the recommendation every few minutes and pushes **only when the answer changes for the better** - `wait` becoming `leave_now`, or a bounded window appearing where there was none. An alert that fires every sweep is noise, and users turn noise off.

The sweep reuses the device's last known position and ignores anything older than six hours, because a phone asleep in a pocket cannot report GPS and a stale origin produces a confidently wrong alert.

## Challenges in a one-day sprint

**The database died first.** `better-sqlite3` needs a native toolchain, and the build machine had no Visual Studio. Rather than install a compiler under time pressure, we moved to Node's built-in `node:sqlite` and hand-rolled a small repository layer - fewer dependencies, no build step, and it cannot break on a teammate's machine.

**The weather grid was coarser than hoped.** Testing against live Open-Meteo revealed that four sample points on an 11 km Accra route collapsed into two distinct grid cells: there is no high-resolution regional model over Ghana. The route-sampling idea survives because the values still differ meaningfully - 73% rain probability at the start rising to 78% at the destination - as each point is read at a *different arrival time*. The spatial axis pays off on long trips; the temporal axis pays off on every trip. We documented this honestly rather than overselling it.

**Model ids are a moving target.** Rather than hard-code a guess at the Gemma 4 serving id, the repo ships `npm run models`, which asks the API what the key can actually reach. The Gemma client also downgrades itself automatically: if a deployment rejects `systemInstruction` or `thinkingConfig`, it folds the contract into the user turn and retries, costing one wasted call instead of a dead demo.

**A subtle correctness bug.** The first version described each sample point using the weather observed there *now* while labelling it "in 34 min". Fixed to read the forecast code for the arrival bucket - otherwise the screen contradicts the one claim it exists to make.

## Links

- **Live demo:** [DEMO URL]
- **Code:** [REPOSITORY URL]
