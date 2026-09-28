# ResonanzRadar

Private Sites application for comparing up to five RSS/Atom feeds with up to 40 items each. Method 2.0 replaces the original composite resonance score with four independent text dimensions: linguistic sensationalism, depicted threat, negative political framing, and generalization. These are exploratory content measures, not measures of objectivity, truth, reader emotion, or voting intention.

## Running locally

Run `npm ci`, then `npm run dev`. Enter the TypeSafe key in the application. Keys are only held in memory and forwarded to the fixed TypeSafe endpoint; they are not saved in browser storage, source, or reports. Analysis uses `jev-latest`; exports record the resolved model returned by the API.

## Method 2.0

- Parse XML with validation, normalize CEST/CET timestamps and HTML entities, deduplicate per feed, sort by date before selecting the most recent items.
- Select a common 24/72/168-hour window or the delivered feed without date filtering. Report actual sample sizes, date coverage, missing descriptions, truncation, failures and exclusions.
- Send only title and description to JEV; publisher metadata is excluded. Source names may still occur within the content itself.
- Evaluate atomic rubric scores from 0–4, displayed as 0–100. Do not blend topic probabilities and scores into a purported party-effect index.
- Distinguish asserted, attributed and challenged political narratives. The predefined narratives are non-exclusive research hypotheses, not a verified model of AfD influence.
- Select evidence from verbatim input spans, with a no-evidence option. Preserve all distributions and questions in the report. Reject missing/out-of-range results instead of interpreting them as zero.
- Compare actual per-feed means. A second comparison uses equal weights for topics represented by at least two articles in every selected feed. This controls the topic mix only, not differences in events, dates, length or audience.
- Review flags include confidence below 0.55, missing/truncated descriptions, inconsistent narrative answers and high scores without evidence. Thresholds are heuristic. Confidence is model distribution concentration, not an empirically measured accuracy rate.

## Verification

`node --experimental-strip-types --test tests/*.test.mjs`

`npx oxlint app lib`

`npm run build`

The tests exercise parsing, dates, deduplication, fail-closed answer handling, exact-span evidence, identical topic weights, and the full streaming endpoint with 200 articles using mocked JEV responses. Optional live-feed parsing tests use `/tmp/jev-bild.xml` and `/tmp/jev-tagesschau.xml` when present. They do not call TypeSafe or establish model quality.

The 2026-09-28 revision passed all 12 tests with snapshots of both requested feeds. Live JEV inference and WebMCP execution were not verified during this revision because no TypeSafe key / supported WebMCP execution context was available. No human-labelled calibration benchmark has yet been run. Before treating media differences as substantive, evaluate a balanced blinded sample with independent human labels, compare like topics and events, and test model stability across repeated runs. Do not tune the rubric to make a named publisher score worse.

Model calls process five articles per batch, at most two concurrently. The endpoint streams progress and returns available results with explicit failures. Clients can cancel further work; already submitted provider calls may still be billable. Exports contain article text and diagnostic results, never the key.

## Shareable JEV debug capture

The UI enables `JEV-Debug für diesen Lauf mitschreiben` by default; it can be disabled before a run. The API only emits debug events when `debug: true` is explicitly provided. Captures contain the exact request body, article-to-batch mapping, original response text (including invalid JSON / HTTP errors), selected response headers, timing and per-article validation failures. Responses over 2 MB are visibly truncated and rejected for analysis. Key occurrences, including JSON/URL-escaped representations, are redacted before streaming; request headers are never collected. Debug is not written to console, disk or browser storage, and adds no provider calls.

Download `Debug-JSON herunterladen` before reloading or starting another run. It includes only its own run's report, never a previous successful report. Received batches remain downloadable after errors or cancellation, with incomplete batches visibly missing responses. The JSON contains article text and feed URLs: review it before sharing. The download itself persists wherever the user saves it. Tests use mock provider outputs; a live capture needs the user's key and a new analysis run.
