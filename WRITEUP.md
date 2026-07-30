# Move

### Should you leave now? Gemma 4 reads the road, the sky, and the clock, and gives you one answer.

**Track: GenAI for Good**

---

## The problem

Every commuter in Accra asks the same question every morning, and no app answers it: *should I leave now?*

What we have instead is raw material. A maps app shows a red line and an ETA. A weather app shows a percentage for a city. Neither tells you that rain will reach Achimota in twenty-five minutes but not the stretch you are on now, or that the delay you are looking at is four minutes worse than a normal Tuesday and therefore not worth waiting out.

The interpretation is left to the person at the exact moment they are least able to do it - keys in hand, already half late.

## What it does

Move resolves your position, requests driving and walking routes, samples the weather at several points **along the route polyline at the time you would physically reach each one**, and hands the whole briefing to Gemma 4. Back comes one recommendation: leave now, wait *N* minutes, or leave by *HH:MM* - plus the best mode, a plain-language headline, and a practical advisory such as "Bring an umbrella".

Underneath the card sits a "Why this?" drawer with every number the model saw. A user who trusts the app never opens it. A user who does not can audit the whole decision.

## Why route-specific weather is the core idea

Almost everything in this space checks the weather at your origin, or at your destination, and stops. A thirty-five minute drive across Accra can start dry and end in a downpour, and endpoint-only weather is blind to that.

Move samples up to four points spaced by **distance** along the route line - not by vertex index, because routing providers emit vertices unevenly, dense through junctions and sparse on a highway, so index-based sampling would cluster every "midpoint" around the nearest interchange. Each point is read for the fifteen-minute forecast bucket the traveller will actually be standing in, not for right now.

That is what lets the model say *"leave in the next twenty minutes and you stay ahead of it"* rather than *"70% chance of rain today"*.

## How Gemma 4 is used

Gemma 4 is the reasoning layer, not a chatbot bolted onto a dashboard. It is the only component that makes a judgement; everything else is deterministic plumbing.

**The system role carries a strict contract.** Gemma 4's native `system` role holds a locked output schema, so the interface renders from typed fields and never parses free text. The prompt also encodes judgement the raw numbers do not contain - *"a traffic delay under five minutes is normal, never tell someone to wait it out"*, *"only recommend waiting when the numbers support it"*, *"reason only from the briefing, and if a field is null work without it"*. That last line matters more than it looks: it is what stops a small model inventing a forecast when the weather API is down.

**The briefing is verbose on purpose.** Field names read like English - `minutes_better_than_leaving_now`, `rain_clears_in_minutes`. Gemma 4's context window is enormous next to one trip's data, so compressing it would trade reasoning quality for bytes we were never short of.

**Single-shot, not agentic.** Gemma 4 supports function calling, but we assembled a complete payload up front instead. One call is one failure mode; a tool loop is several.

**The output is treated as untrusted input.** This model thinks unconditionally and emits that reasoning into the response, so the parser is forgiving about packaging and strict about meaning:

- Every balanced `{...}` is located with a string-aware scanner and the candidates are tried newest-first, skipping leaked reasoning and draft objects.
- Fields are coerced: `"about 20 minutes"` becomes `20`, `"5:40 PM"` becomes `"17:40"` - not hypothetical, and rendering it as `05:40` would show a departure time twelve hours wrong.
- Contradictions are repaired rather than rejected. A `wait` with no duration becomes `leave_now`, because a blank card is worse than a corrected one.
- The mode choice is reconciled against the routes we actually hold, so the model cannot recommend a ninety-minute walk.
- A genuine parse failure triggers one retry with an explicit correction.

Twenty-seven unit tests cover that path, running against the compiled output.

## Architecture

A **React PWA** talks to a **NestJS** backend over a single endpoint, `POST /api/recommendation`. Modules map one-to-one onto the pipeline: `RoutingModule` (Mapbox driving-traffic and walking, predictive `depart_at` ETAs), `WeatherModule` (route sampling, one batched Open-Meteo call), `LlmModule` (Gemma 4 transport), `RecommendationModule` (assembly, parsing, caching), `DestinationsModule`, and `NotificationsModule`.

**Why Open-Meteo:** no API key at all, which removed a signup, a secret, and a rate limit from the critical path, and it batches coordinates so every sample point costs one round trip.

**Why no ORM:** Node 24 ships SQLite in core, four small tables did not justify one, and `node:sqlite` cannot fail to install.

## Designed for weak connections

Connectivity is a judging criterion here, and it drove real decisions rather than a paragraph.

If any upstream is unreachable, the API replays the last stored answer for that trip flagged `stale: true`, and the interface says when it was from. A ten-minute-old answer beats a spinner. Weather degrades independently of routing, so a forecast outage costs you the umbrella advice, not the recommendation. Route geometry is stripped before the response leaves the server, because the UI draws no map and shipping thousands of coordinates to a metered phone would be waste.

## Proactive notifications

Saved destinations can be watched. A background sweep re-runs the recommendation every few minutes and pushes **only when the answer changes for the better** - `wait` becoming `leave_now`. An alert that fires every sweep is noise, and users turn noise off.

## Challenges in a one-day sprint

**The database died first.** `better-sqlite3` needs a native toolchain and the build machine had no Visual Studio. Rather than install a compiler under time pressure, we moved to Node's built-in `node:sqlite` with a small hand-rolled repository layer - fewer dependencies, no build step, and it cannot break on a teammate's machine.

**The weather grid was coarser than hoped.** Live testing showed four sample points on an 11 km Accra route collapsing into two distinct grid cells: there is no high-resolution regional model over Ghana. The idea survives because the values still differ meaningfully - 73% rain probability at the start rising to 78% at the destination - as each point is read at a *different arrival time*. The spatial axis pays off on long trips; the temporal axis pays off on every trip. We documented this rather than overselling it.

**Thinking could not be turned off, and it leaked into the answer.** `thinkingConfig` is rejected by this model, and its reasoning is emitted into the response body: hundreds of tokens of prose, complete with draft JSON objects and fenced examples, before the real answer. That broke three assumptions at once.

Thinking tokens count against `maxOutputTokens`, so our 800-token budget truncated answers mid-string; raised to 2500. Our parser took the *first* balanced object, reliably a discarded draft; it now collects every object and walks them backwards, since the final answer is the last one, falling back to the last complete draft if the real answer was cut off. And our capability-downgrade logic disabled `systemInstruction` and `thinkingConfig` together - since only the latter is unsupported, that discarded the output contract for no reason and pushed us onto a path that reliably hit the token ceiling. They are now downgraded independently, chosen by reading the API's complaint.

**A silent 422 that disabled a whole feature.** Mapbox accepts `depart_at` as `YYYY-MM-DDThh:mm` or `...:ssZ` and nothing else. We sent `toISOString()` trimmed to 19 characters, which drops the `Z` and matches neither. Every predictive-traffic probe failed, and because the client reads a 4xx as "this plan does not support it", it latched the feature off permanently. One character fixed it, and the departure-time optimiser now returns real predicted ETAs.

**A subtle correctness bug.** The first version described each sample point using the weather observed there *now* while labelling it "in 34 min". Fixed to read the forecast for the arrival bucket - otherwise the screen contradicts the one claim it exists to make.

Verified end to end on a live Accra trip: 5.9 seconds, real routing, weather at three sampled points, and a Gemma 4 verdict of *"Leave now to beat the rain."*

## Links

- **Live demo:** [DEMO URL]
- **Code:** [REPOSITORY URL]
