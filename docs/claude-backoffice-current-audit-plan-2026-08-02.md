# Claude handoff: current ANGLE back-office audit plan

Audit date: 2026-08-02\
Primary repository: `/Users/enotov/Desktop/anglesite`\
Production surface: `https://angle.co.il/account`

## Mission

Bring the ANGLE owner back office from its current professional-looking beta
state to a dependable first-customer release. This is a targeted stabilization
and UX pass, not a redesign from scratch.

Preserve what is already strong:

- grouped navigation and the Dashboard quick-access model;
- the restrained visual system and compact desktop tables;
- the Reservations structure: Timeline, List, Waitlist, Tables & zones,
  Analytics;
- the Catalogue filters and mobile item-management layout;
- clear Team/Permissions semantics;
- actionable device-health explanations;
- QR Menu and Reservations as separate channel configurations;
- URL-backed views and working browser Back/Forward behavior.

Do not add payments, deposits, WhatsApp, or Telegram in this task.

## Important context before editing

There is an older, broader roadmap at:

`/Users/enotov/Desktop/anglesite/docs/claude-backoffice-improvement-plan.md`

It contains useful product principles, but several of its original defects have
already been implemented or fixed. This document is the current execution plan
and supersedes the older plan's phase ordering.

Recent commits on `main` at audit time include:

- `d5db70c` — Sales/Activity/reporting improvements;
- `62ab8ac` — escape from the empty Possible duplicates view;
- `b41c1a2` — customer workspace improvements;
- `7fb1783` — device rename persistence fix;
- `bbcda5b` — device diagnostics and Team permission semantics.

Production behavior did not always appear to match these commits. First
determine whether this is a deployment/cache mismatch or a remaining code bug.
Do not reimplement completed work blindly.

Related plans:

- `docs/claude-product-separation-plan.md`
- `docs/claude-angle-reserve-improvement-plan.md`
- `docs/reserve-audit-phase0.md`

The public QR Menu/POS code and shared database may live in
`/Users/enotov/Desktop/kassa`. Before changing that repository, read all of its
instructions and architecture/deployment documents. Do not use a cross-repo
change to hide a back-office defect.

## Safety and repository rules

1. Read `README.md`, `package.json`, the relevant source files, and current git
   history before editing.
2. Run `git status --short` first. At audit time these user-owned files were
   untracked and must not be staged or altered accidentally:
   - `IMG_3617-hero.mp4`
   - `IMG_3617.mov`
   - existing untracked documents under `docs/`
3. Reproduce every defect before fixing it. If production and local `main`
   differ, record the exact difference.
4. Never mutate real prices, fiscal data, customers, orders, or reservations
   merely to clean up the developer workspace.
5. Use dedicated test records for destructive customer operations. Merge and
   erase are irreversible.
6. Keep server/RPC/RLS authorization intact. Hiding a button is not security.
7. Do not rewrite old migrations. Add a forward-only migration only if a schema
   or RPC correction is genuinely necessary.
8. Make one independently testable commit per phase. Do not mix unrelated UI
   polish with a correctness fix.
9. Do not push, deploy, change DNS/CSP, or apply migrations unless the user
   explicitly asks.

## Audit environment and method

The production account was tested as the owner of the developer workspace. The
audit covered Dashboard, Orders, Reservations, Sales, Activity, Reports,
Catalogue, Customers, Locations, Team, QR Menu & Online, Integrations, Devices,
Help, Account, browser Back/Forward, and representative mobile layouts at
390x844.

Safe filters, tabs, dates, drawers, forms, and dialogs were exercised. Real
financial/catalogue/customer mutations were not submitted during this audit.

## Verified current release blockers

### P0. Catalogue -> Modifiers crashes the whole application

Production reproduction:

1. Open Catalogue.
2. Select the `Modifiers` tab.
3. The entire back office becomes a white screen.
4. Console reports `ReferenceError: selecting is not defined`.

Current source cause:

`backoffice/src/MenuManager.jsx`, around lines 582-626, contains an Items bulk
selection block copied into `ModifiersTab`. It references variables that do not
exist in that component: `selecting`, `selected`, `visible`, `askBulk`, and
`data.categories`.

Required fix:

- remove the unrelated copied Items block from `ModifiersTab`;
- restore the correct modifier-group empty/content states;
- add a focused render test that opens Items -> Modifiers -> Stations and back;
- add a route/view-level React error boundary so one module failure shows a
  useful recovery screen instead of destroying the entire workspace;
- log the error without exposing customer data.

Acceptance:

- Modifiers opens with zero, one, and multiple modifier groups;
- tab changes do not lose Catalogue filters unexpectedly;
- a forced child render error produces a recoverable error state;
- `npm test` and `npm run build` pass.

### P0. Reservations analytics funnel can exceed 100%

Observed production values for 30 days:

- Opened page: 1;
- Checked availability: 1;
- Picked a time: 2 / 200%;
- Started form: 0;
- Booked: 0.

Do not solve this by clamping the displayed percentage to 100. Determine the
funnel unit and deduplication contract first: unique session, anonymous visitor,
booking attempt, or event. A later stage must use the same cohort/denominator as
the earlier stages.

Required work:

- trace the event source, query/RPC, aggregation, timezone, and identity key;
- document the intended funnel semantics in code;
- deduplicate retries/repeated selections correctly;
- handle missing stage events without creating impossible conversion rates;
- add fixtures covering repeated events, anonymous sessions, abandoned flows,
  successful bookings, date boundaries, and zero denominators;
- show data coverage or `insufficient data` when the sample is too small to be
  meaningful.

Acceptance:

- stage counts are cohort-consistent and explainable;
- percentages never become impossible because of mismatched units;
- totals reconcile with the underlying event rows;
- empty/small-sample states do not imply false precision.

### P1. QR Menu & Online steals focus and opens in the middle of the page

On desktop and especially at 390x844, navigating to QR Menu & Online lands near
the embedded guest preview rather than at the page heading/settings. The iframe
becomes active and its guest `Start` button appears to receive focus.

Inspect:

- `backoffice/src/QrChannels.jsx`;
- the guest preview iframe lifecycle;
- public menu hero/start-button focus behavior in the related app;
- route-change scroll restoration in `backoffice/src/App.jsx`.

Required behavior:

- normal navigation opens the destination at the top;
- the iframe must not autofocus or scroll the parent document;
- keyboard users may enter the preview deliberately, but focus returns to the
  triggering control when leaving it;
- refreshing the preview must not move the parent page;
- preserve a user's scroll only for Back/Forward restoration, not for a new
  destination opened from the drawer.

Acceptance:

- verified at default desktop size and 390x844;
- verified with mouse/touch and keyboard-only navigation;
- no focus jump, layout jump, or parent scroll when the iframe loads/reloads;
- preview retains loading and failure states.

## Phase 0 — reconcile source, deployment, and baseline

Estimated effort: 0.5 day.

1. Record branch, HEAD, `git status`, `origin/main`, current production asset
   hashes/version, and build/test results.
2. Confirm whether production contains recent commits `7fb1783`, `62ab8ac`, and
   `d5db70c`.
3. Capture current screenshots at the default viewport and 390x844 for:
   Catalogue Items/Modifiers, Reservations Timeline/Analytics, QR Menu & Online,
   Customers, Devices, Activity, and Sales.
4. Reproduce the three verified blockers above before editing.
5. Record findings in `docs/backoffice-phase0-baseline.md` without overwriting
   unrelated historical notes.

Acceptance:

- it is clear which defects are source bugs and which are stale deployment/SW
  cache issues;
- baseline `npm test` and `npm run build` results are recorded;
- no production data has changed.

## Phase 1 — release-blocker fixes

Estimated effort: 1-2 days.

Implement in this order:

1. Modifiers crash and focused Catalogue tab tests.
2. Back-office error boundary and recovery action.
3. Reservations funnel correctness and aggregation tests.
4. QR iframe focus/scroll behavior and responsive browser smoke.

Commit each independently when practical. Do not include general visual polish
in these commits.

Release gate:

- all P0/P1 acceptance criteria pass;
- no new console errors on primary routes;
- production deployment is not performed until the user reviews the diff and
  validation results.

## Phase 2 — regression verification for recently changed operations

Estimated effort: 0.5-1 day. Fix only failures that still reproduce.

### Customers

Using dedicated test guests only, verify:

- editing name and phone;
- setting and then fully clearing notes and tags with empty values;
- merging a duplicate;
- merged-away profile disappears from both back office and POS search after a
  fresh reload/session;
- Possible duplicates always has a route back to the full list, including zero
  results;
- erase/anonymize behavior remains irreversible, authorized, and audited.

If the merged profile remains in POS, identify whether the cause is stale local
cache, query filtering, realtime state, or backend canonical/merged flags. Do
not hide it only in one UI.

### Devices

Verify the shipped rename fix from commit `7fb1783`:

- edit a test terminal name;
- Save persists after refresh;
- blur, Enter, Escape, and Cancel have predictable behavior;
- archive, Show archived, and Restore remain recoverable;
- active + archived counts reconcile with Dashboard totals.

### Activity and Sales

Verify that production actually contains `d5db70c`:

- Activity period/type/search/filter controls are present and useful;
- events show exact timestamp and enough actor/device/location context when
  available;
- Sales clearly states date, location, currency, and gross/net meaning;
- navigation label and page heading both say `Sales`.

Acceptance:

- every check is recorded as pass/fail with screenshot or test evidence;
- no duplicate implementation of an already-correct fix;
- cross-POS consistency is tested after a real page reload, not only React
  state updates.

## Phase 3 — Orders becomes an actionable inbox

Estimated effort: 1-2 days.

Observed: 14 old unresolved orders dominate the page. Copy tells the owner to
close or cancel them, while the POS-connected back-office view is read-only and
offers no action or handoff.

Implement:

1. Keep `Today` operational work primary.
2. Collapse `Older unresolved` by default, grouped by age/date and status.
3. Always show full date for orders outside the current restaurant day.
4. Replace contradictory copy with capability-aware guidance.
5. For POS-connected orders, provide a validated safe deep link/open-on-POS
   handoff only if a stable route exists. Otherwise provide an honest location
   and order reference, not a fake button.
6. For standalone Orders, expose only server-authorized workflow actions with
   proper confirmation/reason UI.
7. Add error/reconnect/new-order states and prevent realtime duplication.

Acceptance:

- a new order is visible without scrolling through historical debt;
- an owner can locate a known old order in under 10 seconds;
- the UI never asks the user to perform an unavailable action;
- no old production orders are automatically modified.

## Phase 4 — mobile navigation and information visibility

Estimated effort: 1-2 days.

### Drawer

At 390x844, Channels and System fall below the visible area while the account
footer is already visible. There is no clear affordance that the navigation
list scrolls.

- make the navigation body independently scrollable;
- ensure the account footer never covers destinations;
- add a subtle fade/edge affordance when content continues;
- keep Help and Close reachable;
- prevent body scroll behind the drawer;
- restore focus to the hamburger after closing.

### Reservations tabs

`Analytics` is outside the visible width with no indication that the one-line
tablist scrolls.

- keep a one-line tablist, but expose overflow with edge fade/partial next tab
  or use a compact mobile view selector;
- automatically reveal the active tab;
- support horizontal swipe and keyboard arrow navigation;
- do not wrap into dense two-line controls.

### Customers

Mobile rows currently hide Visits and Total spent even though those values are
available as sort criteria.

- show the most relevant two metrics based on current sort/segment; or
- use a compact expandable row/detail affordance;
- keep name, phone, tags, and last activity legible without horizontal overflow.

Acceptance:

- all navigation destinations are discoverable at 390x844;
- no tab or metric is silently inaccessible;
- touch targets remain practical and body-level horizontal overflow is zero.

## Phase 5 — consistency and product polish

Estimated effort: 2-3 days, split by component.

1. Reduce oversized dark KPI hero blocks in Sales and Reservations Analytics by
   roughly 30-40% while preserving hierarchy.
2. Make save behavior consistent:
   - explicit Save with dirty state; or
   - autosave with nearby `Saving`, `Saved`, and `Failed — retry` states.
   Do not leave QR settings ambiguous while Locations uses explicit Save.
3. Add fiscal-export preflight. Missing Tax ID or required business fields must
   produce an actionable warning before generating a file.
4. Add rename and reorder for Stations; keep delete confirmed and safe when a
   station is referenced.
5. Improve Account beyond email + Sign out only if the authentication model
   supports it: active sessions, sign-in method, security guidance, and 2FA
   status. Do not build fake password controls for passwordless auth.
6. Hide Reports and Integrations from customer accounts until they provide real
   value; developer workspace may keep explicit `Not built yet` states.
7. After setup reaches 100%, move `Ready to launch` out of the repeated primary
   reservation viewport or make it dismissible.

Acceptance:

- visual hierarchy is calmer without losing clarity;
- every mutation communicates unsaved/saving/success/error state;
- incomplete fiscal configuration fails early and safely;
- placeholders do not imply sellable functionality.

## Required validation matrix

Run these after every affected phase:

| Surface | Desktop | 390x844 | Keyboard | Empty/error |
|---|---:|---:|---:|---:|
| Catalogue Items/Modifiers/Stations | yes | yes | yes | yes |
| Reservations Timeline/Analytics | yes | yes | yes | yes |
| QR Menu & Online + preview | yes | yes | yes | yes |
| Orders | yes | yes | yes | yes |
| Customers | yes | yes | yes | yes |
| Devices | yes | yes | yes | yes |
| Activity/Sales | yes | yes | yes | yes |

Also smoke these product shapes when credentials/test organizations exist:

- POS only;
- Menu only;
- Orders standalone;
- Orders + POS;
- Reserve standalone;
- Reserve + POS;
- multi-location;
- developer workspace.

Minimum commands:

```bash
cd /Users/enotov/Desktop/anglesite
npm test
npm run build
```

If `/Users/enotov/Desktop/kassa` changes, run its documented lint, test, build,
bundle/schema checks and verify both POS and public Menu/Reserve surfaces.

## Definition of done for every phase

- defect reproduced before the change;
- smallest correct implementation, not a visual workaround;
- focused automated regression coverage added;
- desktop and 390x844 checked visually;
- keyboard/focus behavior checked for touched controls;
- no new serious console errors;
- `npm test` and `npm run build` pass with exact results recorded;
- no unrelated/untracked files staged;
- commit contains one coherent user-visible outcome;
- production data, migrations, deployment, and push untouched unless explicitly
  authorized.

## Exact prompt to give Claude

> Read `/Users/enotov/Desktop/anglesite/docs/claude-backoffice-current-audit-plan-2026-08-02.md` completely. Then read the repository README, package scripts, relevant source files, recent commits, and every referenced plan before editing. Start with Phase 0 and Phase 1 only. Reproduce each current blocker first and distinguish source bugs from stale production deployment/cache. Fix the Modifiers crash, add a recoverable back-office error boundary, correct the Reservations funnel semantics without clamping percentages, and stop the QR preview iframe from stealing focus/scroll. Add focused tests, run `npm test` and `npm run build`, and report the exact diff, screenshots, and validation results. Preserve all unrelated and untracked files. Do not push, deploy, change DNS/CSP, apply migrations, or mutate real production data unless I explicitly authorize it.
