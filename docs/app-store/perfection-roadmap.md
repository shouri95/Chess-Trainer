# Pattern Coach Perfection Roadmap

Goal: make the app feel App Store ready: clear, fast, honest, polished, and useful on the first run.

## Product Standard

Every main screen must answer one user question without clutter:

- Home: What should I do today?
- Lab: Which mistakes matter most?
- Patterns: Where do I repeatedly lose value, and in which openings?
- Drill: What exact positions should I train now?
- Analysis: What should I have played and why?

No screen should contain duplicate controls, hidden dead ends, noisy panels, or claims not backed by the imported data.

## Phase 1 - Patterns Cleanup

Status: in progress.

- Use one phase filter only: All, Opening, Middle, Endgame.
- Make the struggle heatmap obey that single filter.
- Remove overview clutter that belongs in detail views.
- Show every opening played, not only openings with trap clusters.
- Add opening sorting by loss, games, win rate, and name.
- Keep the drill CTA visible but secondary.

Acceptance:

- No duplicate Opening/Middlegame/Endgame controls.
- All openings from imported games appear in the openings list.
- Opening sort changes list order immediately.
- The page still has a clear top-to-bottom story: filter, heatmap, openings, weak spots, drill.

## Phase 2 - Opening Intelligence

- Build a PGN prefix tree for the first 10 to 15 moves.
- Identify repeated trouble positions by FEN and engine loss.
- Show the exact move path where losses repeat.
- Add "Drill this line" entry points that preserve opening context.

Acceptance:

- The app can say "this specific line hurts", not just "Sicilian hurts".
- Low-confidence opening labels are treated as imported lines, not fake theory.
- Synthetic PGN tests cover repeated-line grouping and sorting.

## Phase 3 - App Store Polish

- Run mobile viewport QA for every tab.
- Verify empty, loading, failed sync, offline, and engine timeout states.
- Generate iOS assets and validate icons/splash screens.
- Confirm privacy copy, support URL, App Store screenshots, and metadata.
- Run `npm test`, `npm run build`, `npm run ios:assets`, and `npm run ios:sync`.

Acceptance:

- No blank screens.
- No clipped primary text.
- No duplicate controls.
- No broken drill or analysis entry points.
- App Store metadata is complete and truthful.

## Phase 4 - Post-Submission Upgrades

These are valuable, but should not block the first polished submission:

- Persistent engine cache with versioning.
- Larger opening taxonomy.
- Deep endgame subcategories beyond current heuristics.
- Full multi-PV opening audit for every repertoire node.
- Optional cloud sync.

