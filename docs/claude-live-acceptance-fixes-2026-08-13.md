# Claude handoff: fix confirmed live-acceptance defects

## Mission

Fix the defects confirmed during a real production acceptance pass of ANGLE
Back Office on 13 August 2026. This is a narrow corrective task, not another
redesign and not permission to rebuild Customers or Reservations.

Read this file completely before editing code. Work from the current source and
tests, not from an older plan or screenshot.

## Repositories

### `/Users/enotov/Desktop/anglesite`

Back office UI. Start with:

- `AGENTS.md` and `CLAUDE.md`, if present;
- `backoffice/src/App.jsx`;
- `backoffice/src/ErrorBoundary.jsx`;
- `backoffice/src/errors.js`;
- `backoffice/src/GuestsManager.jsx`;
- `backoffice/src/customers.js`;
- the related `*.test.js` and `backoffice/test/*.test.mjs` files.

### `/Users/enotov/Desktop/kassa`

Shared database and RPCs. Start with:

- `AGENTS.md`;
- `CLAUDE.md`;
- `docs/database.md` and `docs/deployment.md`;
- `supabase/migrations/155_guest_retention.sql`;
- `supabase/migrations/156_guest_profile_restaurant.sql`;
- `supabase/tests/guest_profile_lookup.test.sql`.

Inspect `git status`, the current branch, recent commits and the current highest
migration in both repositories before changing anything. Preserve every user
file and unrelated change.

## What was verified live and already works

Do not regress or rebuild these flows:

1. A partial phone number does not show a customer match.
2. A complete known phone shows the guest name and visit count.
3. The name is filled only when the name input is empty; manually entered text
   is not overwritten.
4. A reservation can be moved through the normal UI. It then appears at the new
   day/time on the timeline and in the customer's `Next booking` block.
5. `QR Menu & Online -> Reservations` correctly shows `Delivery: Not
   configured` with an explanation when no provider exists.
6. Retention windows without enough elapsed history correctly show an em dash
   and `nobody has lived through this window yet`.
7. CSV generation already contains `Segments` and `Why`, and export is built
   from the currently filtered server result. Keep and extend its tests; do not
   rewrite it.
8. Customer erasure is intentionally owner-only. Do not grant this to managers
   as part of this task.

Important: do **not** create a bug ticket for the `datetime-local` field. An
automation tool initially failed to send React-compatible input events, but the
same reservation was moved successfully through the real UI.

---

# Confirmed defects

## P0 — a fresh deployment can strand a signed-in user on stale lazy chunks

### Live evidence

The first Dashboard -> Reservations transition failed with:

```text
Failed to fetch dynamically imported module:
https://angle.co.il/account/assets/ReservationsDesk-BKN8FXGb.js
```

The same session also logged failed old chunk URLs for Devices, Team and Orders.
A full page reload recovered the application. The current deployment contained
new hashes, so the signed-in browser had a stale entry bundle referring to
chunks no longer available at those URLs.

### Why the current recovery is insufficient

- `App.jsx` uses direct `lazy(VIEW_MODULES.*)` imports.
- `useModulePrefetch` deliberately swallows an import failure.
- `ViewErrorBoundary` presents `Try again`, but remounting the same rejected
  `React.lazy` loader/import URL is not a reliable recovery from a missing
  deploy chunk.
- A normal render error and a deploy-version chunk error currently receive the
  same action, although only the latter needs a document reload.

### Required fix

1. Add a small, testable chunk-load-error classifier. Match the browser variants
   used by Chromium, Safari and Firefox, including failed dynamic import,
   `ChunkLoadError` and module-script fetch failures. Do not classify arbitrary
   render or data errors as chunk failures.
2. For a confirmed chunk-load error, offer a truthful action such as `Reload
   updated version`, and reload the document rather than merely remounting the
   same lazy component.
3. Prefer an automatic **one-time** recovery when it is safe, guarded by a
   build/version key in `sessionStorage`. It must never create a reload loop.
   If no stable build id exists, implement the explicit reload action first and
   document the limitation instead of inventing an unsafe loop guard.
4. Keep the current in-section boundary for ordinary render failures: navigation
   and the rest of the back office must remain usable.
5. Inspect the actual caching/deployment path before coding. If a service worker
   or cache header participates, fix that path too; do not add a second cache
   mechanism just to hide the symptom.

### Acceptance criteria

- A simulated stale-chunk error leads to exactly one understandable recovery
  route and never loops.
- The recovery reload preserves the current URL, including `view`, `tab`, `loc`
  and date query parameters.
- An ordinary component render error still shows `Try again`/Dashboard and does
  not reload the page.
- Unit tests cover at least Chromium- and Safari-shaped error messages, a normal
  error, the one-time guard and the no-loop case.
- `npm test` and `npm run build` pass in `anglesite`.

## P1 — the same customer is shown with two different visit counts

### Live evidence

The tested customer showed:

- `6` visits in the customer-directory row;
- `4` visits in the profile's top `Visits` statistic;
- `6 visits` in the segment explanation;
- an accessible row name announcing `4 visits` while the visible cell said `6`.

This is not a cosmetic discrepancy. The combined visit count intentionally
includes reservations and register visits. A screen reader and a sighted user
currently receive different facts.

### Root cause visible in current code

- `CustomerRow` correctly prefers `guest.why_segment?.visits`.
- `ProfileView` renders `guest.visits`, the legacy register/loyalty count.
- `guestRowLabel()` also renders `guest.visits`.
- migration 156 returns top-level `visits: v_guest.visits` while
  `why_segment.visits` comes from `guest_retention_facts`.

### Required fix

1. Establish one canonical `combinedVisits` value from the existing server
   retention facts. Do **not** add reservation count and POS count in the
   browser; linked visits may otherwise be counted twice.
2. Use that value consistently in the directory, profile statistic, accessible
   row label, segment explanations and CSV output.
3. Prefer making the RPC contract explicit (for example a clearly named
   `combined_visits`/canonical top-level field) if this can be done without
   ambiguity. If the RPC changes, add a new forward-only migration; never edit
   migration 155 or 156 in place.
4. Preserve loyalty-specific values such as points, stamps and POS spend. They
   are not the same concept as combined visits.

### Acceptance criteria

- For a fixture with reservation-only, POS-only and linked reservation+order
  activity, every visual and accessible surface shows the same correct count.
- The linked case proves that the UI does not double-count.
- `guestRowLabel` announces exactly the number displayed in the Visits cell.
- The profile's top `Visits`, segment reason and exported CSV agree.
- Existing customer filtering and server pagination remain unchanged.

## P1 — `usually <day> <time>` is asserted when there is no real habit

### Live evidence

The tested profile said `usually Tue 08:00`, although the qualifying past visits
were sparse and split across different day/time values. There was no repeated,
dominant pattern strong enough to justify the word `usually`.

### Root cause visible in migration 156

The RPC chooses weekday and hour independently:

- each query orders by count and then the smallest numeric day/hour;
- a tie therefore produces an arbitrary winner;
- independently selected weekday and hour can create a combination that never
  occurred in the underlying visits;
- a single visit can be presented as a habit.

### Required fix

1. Compute the usual slot as a **joint local `(weekday, hour)` bucket**, using
   each location's timezone exactly as the current function does.
2. Return a usual day/time only when there is credible evidence. Minimum
   acceptable rule:
   - winner count is at least 2; and
   - winner count is strictly greater than the runner-up.
   A stronger documented dominance rule is acceptable, but do not fabricate a
   habit from a tie.
3. Keep average party size separate; do not suppress it merely because day/time
   lacks a mode. Return `null` for unsupported usual day/time so the UI omits
   the chip.
4. Add a new forward-only migration that replaces the RPC. Do not modify 156.

### Required database tests

- one qualifying visit -> no usual day/time;
- two or more identical local day/hour visits -> that pair is returned;
- tied buckets -> no usual day/time;
- a unique winner plus another bucket -> the winner is returned;
- timestamps around UTC/local-day boundaries -> day and hour still use the
  location timezone;
- cancelled, rejected, future and test reservations do not establish a habit.

## P2 — only the first profile segment is explained

### Live evidence and code evidence

The profile displayed several segment chips (`Returning`, `Regular`, `VIP`,
`Coming soon`) but printed only
`whySegment(card.segments[0], card.why_segment)` below the entire group. The
other visible labels had no visible, focusable explanation in the profile.
The directory's primary segment already has a native hover title; the profile
must not become less explainable than the list.

### Required fix

1. Give every displayed profile segment its own reason derived from the existing
   `whySegment(key, card.why_segment)` function.
2. Make the explanation available to mouse, keyboard and screen-reader users.
   A compact disclosure/tooltip or a short explanation list is acceptable; a
   hover-only custom widget is not.
3. Avoid four large cards or another dense dashboard. Keep the current compact
   chip group and add only the minimum explanation UI.
4. If two segment reasons are identical, it is acceptable to deduplicate the
   visible prose, but each chip still needs a correct accessible description.

### Acceptance criteria

- Every segment chip has a non-empty correct explanation when the server facts
  support one.
- The explanation is reachable by keyboard and exposed via accessible naming or
  description.
- Mobile layout does not overflow the drawer.
- Existing segment ordering, filters and colours do not change.

---

# Implementation order

1. Baseline: run current tests/builds and record results before edits.
2. Fix deploy-safe lazy-chunk recovery in `anglesite` with focused tests.
3. Fix the canonical visit count contract and every UI/accessibility consumer.
4. Add the forward-only RPC migration and SQL tests for the usual-slot rule.
5. Add explanations for all segment chips.
6. Run the complete relevant database, unit, browser and production-build
   checks.
7. Verify the real flows at 390 px, tablet width and desktop. A responsive
   emulator is not a substitute for the final iPhone check, but it is still a
   required pre-check.

# Safety and delivery rules

- Do not mutate live customer or reservation data for this task.
- Do not apply production migrations, deploy, commit or push unless the user
  separately authorizes those actions.
- Preserve all untracked design plans and media in `anglesite` and all unrelated
  local changes in `kassa`.
- Never edit an already applied migration.
- No payments, WhatsApp or Telegram work.
- No broad visual redesign, navigation rewrite or new CRM features.
- Keep standalone Reservations functional without POS.
- Do not report an item fixed only because the project builds.

# Final report required from Claude

Return:

1. confirmed root cause for each item;
2. exact files changed;
3. new migration number and RPC contract change, if any;
4. exact tests/builds run and their results;
5. manual acceptance performed and what still needs the owner's signed-in/live
   session;
6. a clean separation between fixed, verified, unverified and intentionally
   unchanged behavior;
7. `git status` for both repositories, without staging unrelated files.

# Prompt to send with this file

```text
Read /Users/enotov/Desktop/anglesite/docs/claude-live-acceptance-fixes-2026-08-13.md completely and execute it as the authoritative task brief. First audit the current code and reproduce the documented root causes with tests; then fix only the four confirmed defects in the stated order. Do not redesign adjacent screens, do not change already-correct booking behavior, do not rewrite applied migrations, and do not touch unrelated local files. Stop before any production migration, deploy, commit or push unless I explicitly authorize it. At the end return the exact evidence and status requested by the document.
```
