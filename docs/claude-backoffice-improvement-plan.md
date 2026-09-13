# Claude handoff: ANGLE back-office improvement plan

## Mission

Turn the ANGLE owner back office into a dependable, sellable workspace for both:

- businesses using ANGLE POS with Menu, Orders, or Reserve as add-ons;
- businesses using ANGLE Menu, Orders, or Reserve as standalone products.

This is not a visual-only redesign. Correct operational data, clear information
architecture, mobile usability, accessibility, and standalone-product language
must be fixed before adding breadth.

The production audit was performed on `https://angle.co.il/account` as the
owner of the developer workspace. The audit was read-only. The priorities and
reproduction details below are based on the real production UI and current
source code, not assumptions.

## Primary repository

Path: `/Users/enotov/Desktop/anglesite`

Back-office source:

- `backoffice/src/App.jsx`
- `backoffice/src/styles.css`
- `backoffice/src/ReservationsDesk.jsx`
- `backoffice/src/TimelineDesk.jsx`
- `backoffice/src/timeline.js`
- `backoffice/src/reservations.js`
- `backoffice/src/OrdersInbox.jsx`
- `backoffice/src/orders.js`
- `backoffice/src/QrChannels.jsx`
- `backoffice/src/MenuManager.jsx`
- `backoffice/src/ItemEditor.jsx`
- `backoffice/src/GuestsManager.jsx`
- `backoffice/src/TeamManager.jsx`
- `backoffice/src/DevicesManager.jsx`
- `backoffice/src/ActivityManager.jsx`
- `backoffice/src/SalesOverview.jsx`
- `backoffice/src/LocationSettings.jsx`

Related shared application, public QR Menu/Reserve pages, database, and CSP:

Path: `/Users/enotov/Desktop/kassa`

Before touching that repository, read its `AGENTS.md`, `CLAUDE.md`, README,
architecture/database/deployment documents, and the relevant feature files.
Do not make a cross-repository change merely to work around a back-office bug.

## Existing plans to coordinate with

Read these before implementation:

- `/Users/enotov/Desktop/anglesite/docs/claude-product-separation-plan.md`
- `/Users/enotov/Desktop/anglesite/docs/claude-angle-reserve-improvement-plan.md`
- `/Users/enotov/Desktop/anglesite/docs/reserve-audit-phase0.md`

Do not duplicate the complete Reserve product roadmap in this task. This plan
owns shared back-office navigation and UX plus the specifically listed host-desk
defects. The Reserve plan owns the deeper availability, guest self-service,
waitlist, CRM, lifecycle, and reservation analytics roadmap.

## Safety and working rules

1. Read repository instructions completely before editing.
2. Inspect current branch, `git status`, and recent commits in every repository
   before work.
3. Preserve all existing user changes and untracked files. At audit time,
   `anglesite` had untracked `IMG_3617-hero.mp4`, `IMG_3617.mov`, and `docs/`.
   Recheck; do not stage unrelated assets or documents.
4. Never rewrite old migrations. Use forward-only migrations only when schema
   work is genuinely required.
5. One independently testable commit per phase. Do not combine all phases into
   one large commit.
6. Do not push, deploy, change DNS/CSP, or apply production migrations unless
   the user explicitly asks for that action.
7. Do not delete production data or “clean up” old orders/devices by mutation.
   First make the UI classify, archive, or filter them safely.
8. Preserve capability/RLS/RPC authorization. Navigation visibility is not an
   authorization mechanism.
9. Do not fork standalone and POS implementations. Use one interface whose
   actions adapt to products, capabilities, and fulfilment mode.
10. No payments, deposits, WhatsApp, or Telegram in this scope.

## Product principles

- A Menu-only customer must not see copy suggesting that a POS is required.
- A Reserve-only customer must be able to configure and operate Reserve without
  visiting a register.
- A POS-connected location may expose POS-aware information and handoffs, but
  the back office must explain which actions live on the POS and provide a
  useful read-only operational view.
- Every destructive or immediately published change needs clear consequences,
  confirmation where appropriate, and recoverability where practical.
- Desktop is an owner/manager workspace; mobile must still support urgent tasks
  such as checking an order, changing a reservation, or hiding an item.
- Do not expose empty navigation. A visible destination must either work or be
  explicitly presented as a planned feature with a useful alternative.

## Verified audit summary

| Area | Current assessment | Main problem |
|---|---:|---|
| Visual quality | 7.5/10 | Clean but inconsistent hierarchy and unfinished destinations |
| Functional completeness | 6/10 | Strong core modules, weak operations around them |
| Navigation and layout | 5.5/10 | Flat 13-item IA, vague labels, no deep links |
| Mobile | 6.5/10 | Good item editor, but dense reservation/navigation surfaces |
| Accessibility | 4/10 | Unlabelled/repeated controls, weak keyboard and contrast support |
| Standalone sellability | 5.5/10 | POS-centric language and configuration leaks remain |

Strong existing areas to preserve:

- coherent visual foundation;
- reservation timeline/list/waitlist/tables/analytics structure;
- useful location settings and sales overview;
- good full-screen mobile item editor with a sticky action area;
- capability-based product visibility and a common organization context.

## Severity P0/P1 defects found in production

### 1. Reservation timeline leaks bookings from the previous day

Reproduction observed:

1. Open Reservations -> Timeline.
2. Select 1 August.
3. A 31 July 14:00 reservation is included.
4. The timeline grows to roughly 35 hours / 4223px and shows ticks through a
   second midnight.

Relevant code:

- `backoffice/src/reservations.js`: `fetchTimelineReservations` intentionally
  fetches from `fromMs - 24h` to support overnight service.
- `backoffice/src/TimelineDesk.jsx`: the unfiltered `bookings` array is passed
  into `timelineWindow(date, tz, meta.schedule, bookings)` before day-window
  intersection is applied.
- `backoffice/src/timeline.js`: `timelineWindow` may expand geometry based on
  all passed bookings.

Do not “fix” this by merely removing the 24-hour fetch buffer; that can break a
legitimate overnight visit that began before midnight. Compute the canonical
selected restaurant-day window first, then retain only bookings whose occupancy
interval intersects that window, and only then allow bookings to influence the
rendered window/rows. Correctly handle Asia/Jerusalem timezone and overnight
service periods.

Acceptance:

- selecting a normal day never renders a booking wholly outside that restaurant
  day;
- a legitimate booking crossing midnight remains visible in the intended
  overnight service window;
- timeline width and ticks stay bounded to the selected service day;
- date changes cannot retain stale geometry from the previous date;
- automated tests cover previous-day exclusion, crossing-midnight inclusion,
  DST, empty day, and long-duration booking.

### 2. Embedded QR Menu preview fails

Production shows `menu.angle.co.il refused to connect` inside the phone preview.

Relevant code:

- `backoffice/src/QrChannels.jsx`, guest preview iframe near the
  `guest-phone-frame` block;
- `backoffice/src/online.js`, iframe URL/snippet helpers;
- public Menu deployment headers/CSP in `/Users/enotov/Desktop/kassa`.

Determine the actual response headers using a read-only request. If
`frame-ancestors` or `X-Frame-Options` blocks the preview, fix the production
policy narrowly so only ANGLE's required origins and customer embed contract
are allowed. Do not blindly set an unsafe wildcard. If customer websites are an
intentional supported embed surface, document the required policy and threat
model. If the public site cannot safely be framed, replace the internal preview
with a same-origin preview component instead of showing a broken iframe.

Acceptance:

- the phone preview renders in production and local development;
- the generated customer iframe still works according to its advertised
  contract;
- CSP is not weakened beyond the intended embed origins/use case;
- iframe has a useful loading and failure state rather than a blank browser
  error.

### 3. Help is a dead control

Both mobile and desktop Help buttons render without a working action in
`backoffice/src/App.jsx`.

Implement a real destination: a small help panel is sufficient initially, with
links to product-specific setup guidance, contact/support, and diagnostic
details (organization and location IDs with a copy action). If support content
does not yet exist, remove the dead control until it does. Never leave a
clickable button that does nothing.

### 4. Reports and Integrations are misleading placeholders

`backoffice/src/App.jsx` routes both to the generic `SectionPage`, while their
navigation labels imply working modules.

Until real modules exist:

- hide them from normal production navigation; or
- render an explicit “Coming soon” state only for developer accounts, with no
  claims that functionality is available.

Do not implement payment integrations under this plan. Existing Sales Overview
must remain the reporting entry point; rename/group it clearly.

## Target information architecture

Replace the flat list with grouped navigation while continuing to filter every
destination through effective capabilities.

### Work

- Orders
- Reservations

### Insights

- Sales
- Activity
- Customers

### Manage

- Catalogue
- Locations
- Team

### Channels

- QR Menu & Online
- Integrations only when a real integration exists

### System

- Devices
- Account
- Help

Naming changes:

- `Home` -> `Dashboard`;
- current `Overview` -> `Sales`;
- `Menu & catalogue` -> `Catalogue`;
- `QR menu` -> `QR Menu & Online` because it already contains Menu, Orders,
  and Reserve channel settings;
- `Settings` containing only email/session -> `Account` and place it in the
  avatar/account menu;
- `Floor plan` -> `Tables & zones` until an actual visual floor map is present.

Do not render empty group headings after capability filtering.

## Routing requirement

Current navigation is component state inside `Dashboard`, so the URL remains
`/account`; browser Back, refresh, bookmarks, and direct support links do not
preserve the section.

Implement a lightweight, testable URL-backed navigation model. Because the
current Vite build is rooted at `/account/` and Vercel does not declare an SPA
rewrite, use a safe first iteration such as `/account/?view=orders` unless and
until a verified rewrite supports `/account/orders` directly.

Requirements:

- selecting a destination updates history;
- browser Back/Forward changes the visible destination;
- refresh preserves the current destination;
- an unauthorized or unknown view falls back to Dashboard and normalizes the
  URL;
- closing the mobile drawer after navigation remains reliable;
- preserve relevant substate in query parameters only where useful, for
  example reservation date/view or chosen location; do not serialize modal
  internals indiscriminately.

## Phase 0 — baseline and test harness

Estimated effort: 0.5–1 day.

1. Record `git status`, branch, HEAD, build output, and current production
   screenshots at 1440x900 and 390x844.
2. Map capabilities/products to the current navigation for POS-only,
   Menu-only, Orders-only, Reserve-only, and developer accounts.
3. Add focused unit tests for pure logic being changed. The repository currently
   has only a build script; add the smallest maintainable test setup rather than
   relying on manual clicking for timeline/routing/filter logic.
4. Define a repeatable browser smoke checklist for desktop and mobile.

Acceptance:

- `npm run build` passes before functional edits;
- baseline artifacts and commands are documented;
- no user-owned files are modified or staged.

## Phase 1 — release blockers and truthful navigation

Estimated effort: 2–4 days.

Implement and verify, in this order:

1. reservation timeline day isolation;
2. QR preview loading/CSP/failure handling;
3. working Help or removal of the dead controls;
4. hide developer-only placeholders from customer accounts;
5. fix obvious repeated-control accessible names touched in these screens.

Acceptance:

- all four production defects above are reproducibly fixed;
- build and focused tests pass;
- developer accounts can still inspect planned modules without implying they
  are sellable;
- one narrow commit, with no unrelated redesign.

## Phase 2 — navigation, location context, and product language

Estimated effort: 3–5 days.

1. Implement grouped, capability-aware information architecture.
2. Implement URL-backed navigation and Back/Forward behavior.
3. Create one consistent location selector/context for modules that operate on
   a single location. The selected location should persist across applicable
   sections, but modules supporting organization-wide views must state that
   scope explicitly.
4. Make Dashboard quick actions adapt to effective products/capabilities and
   unfinished setup tasks.
5. Replace POS-centric copy with capability-aware copy. Never tell a standalone
   customer that the same organization is “connected to ANGLE POS” unless it
   actually is.
6. Move Account/Sign out to a predictable avatar menu on desktop and mobile.

Acceptance:

- each account shape sees only relevant destinations and language;
- no empty group appears;
- deep link, refresh, Back, and Forward work;
- current location is always visible when it affects the data;
- mobile navigation remains keyboard/touch accessible and does not scroll the
  page behind the drawer.

## Phase 3 — Orders as an operational inbox

Estimated effort: 3–5 days.

Observed problem: the Active view contains old `accepted`, `preparing`, and
`ready` orders indefinitely. Cards show a time without a date, making stale
orders appear current. `ACTIVE_STATUSES` in `backoffice/src/orders.js` fetches
all workflow-active rows with no age boundary. POS-connected locations are
read-only, but the view gives little help getting to the active POS order.

Implement:

1. Always show date plus time for orders outside the current restaurant day;
   show relative elapsed time for current active work.
2. Separate `New`, `In progress`, `Ready`, and `Older unresolved` rather than
   presenting every workflow status as one undifferentiated Active grid.
3. Add search and filters for date, status, source/order type, and location.
4. Add stable human-facing order/reference number, source, fulfilment type,
   table/pickup context, and POS handoff state.
5. For POS-connected locations, keep mutation read-only but provide a clear
   “Handled on POS” explanation and an Open/View on POS handoff if the platform
   has a valid safe route. Do not invent a broken deep link.
6. For standalone Orders, preserve validated status transitions and make reject
   or cancel reason collection a proper dialog, not `window.prompt`.
7. Add empty, loading, error, reconnect, and realtime/new-order states.
8. Do not change or auto-complete old production orders as part of this phase.

Acceptance:

- an old unresolved order cannot be mistaken for one received today;
- a manager can find a known order in under 10 seconds;
- POS and standalone modes are visibly distinct but use the same component
  architecture;
- realtime refresh does not duplicate or reorder cards unpredictably;
- mobile urgent actions fit without horizontal overflow.

## Phase 4 — Reservations host-desk operations

Estimated effort: 3–5 days for the back-office portion only.

Coordinate with `claude-angle-reserve-improvement-plan.md`; do not rebuild its
availability engine here.

1. Collapse or dismiss `Ready to launch` after setup is complete; it must not
   consume the first mobile viewport on every reservation tab.
2. Replace the wrapping five-tab mobile layout with a horizontally scrollable
   tablist or compact segmented navigation with a visible active state.
3. Add a prominent `New reservation` action and `Walk-in` action where the
   server contracts already support them. If the backend is missing a required
   safe operation, document and implement it in the Reserve plan rather than
   faking a client-only record.
4. Make the booking detail sheet support permitted edits to guest name, phone,
   note, party size, date/time, and table/zone. Every change must revalidate
   availability server-side and show conflict feedback.
5. Keep assign table, status, no-show, complete, and POS seating actions clear
   and capability-aware.
6. Rename `Floor plan` to `Tables & zones` until the visual map editor is a real
   operational view.
7. Connect reservation presentation settings to the back office; remove copy
   telling standalone users to configure them “on the register”.
8. Use the location business address as the canonical public reservation
   address. Remove the observed placeholder `כתובת העסק` and duplicated address
   sources.
9. Keep auto-save feedback adjacent to the changed control; do not place the
   only `Saved` message at a potentially offscreen page top.

Acceptance:

- host can create a manual booking/walk-in without visiting POS;
- editing time/party cannot double-book a table;
- setup banner no longer blocks routine mobile work;
- public booking confirmation uses the real canonical location address;
- standalone Reserve contains no register-only setup dependency.

## Phase 5 — Catalogue publishing and day-to-day management

Estimated effort: 4–7 days, split into separate commits if needed.

Preserve the strong existing mobile item editor. Add:

1. search by item/category/SKU;
2. filters for availability, channel visibility, category, and incomplete data;
3. bulk availability, category, price adjustment, and channel visibility with a
   review step;
4. explicit draft/publish behavior or a safe change queue. The current “changes
   apply immediately” model is too risky for broad edits;
5. reorder support that works with keyboard and touch, not drag-only;
6. contextual accessible names for Edit/Remove/Delete buttons;
7. allergens, dietary markers, translations, SKU/barcode, tax/category, cost,
   and scheduled availability only after verifying their canonical backend
   model. Do not add UI-only fields that are discarded;
8. import/export with validation and a preview before mutation.

Acceptance:

- owner can find and hide an item in under 15 seconds on mobile;
- bulk changes show exact affected items before applying;
- failed publication cannot leave a falsely successful UI;
- all catalogue changes flow to POS/Menu/Orders through one canonical model.

## Phase 6 — Customers, Team, and Devices

Estimated effort: 4–6 days.

### Customers

Keep the useful read-only spend/visit/order/reservation summary, then add server-
authorized edit flows for name, phone, notes, and tags; duplicate detection and
merge; segmentation/filter/export; and privacy deletion/anonymization. Do not
implement loyalty marketing automation in this phase.

### Team

- add contextual accessible names to repeated Edit controls;
- treat permission toggles as a real single-choice control with `aria-pressed`
  or radios and row-specific labels;
- explain effective role versus per-permission override;
- preserve owner/manager authorization on the server.

### Devices

Production currently shows many offline/attention devices all named `Касса`.
Add last-seen age, location, version, actionable health reason, search/filter,
rename, and a safe unlink/archive/decommission workflow if supported by the
backend. Historical devices must not dominate the operational list. Do not
delete device records automatically.

Acceptance:

- repeated controls are understandable to screen-reader and sighted users;
- device problems explain what the owner can do next;
- archived/test devices are hidden by default but recoverable;
- sensitive customer/team/device mutations are authorized and audited server-
  side.

## Phase 7 — Sales, Activity, and honest reporting

Estimated effort: 3–5 days.

1. Promote the existing working Sales Overview to the `Sales` destination.
2. Add previous-period comparison and explicit date/location scope.
3. Add export only from authoritative data and include timezone/currency in the
   export metadata.
4. Add drill-downs for channel, order type, staff, and location where the data
   exists.
5. Expand Activity with date range, actor, device, location, type, search, and
   export. Keep refunds and shifts, and avoid inventing unsupported audit events.
6. Do not expose a separate Reports module until it offers real value beyond
   Sales and Activity.

Acceptance:

- numbers clearly state period, location scope, timezone, gross/net meaning,
  and currency;
- displayed totals reconcile with the underlying order/payment data;
- a manager can trace a relevant event to actor/device/location when recorded.

## Phase 8 — localization, RTL, accessibility, and final polish

Estimated effort: 5–8 days. Begin accessibility fixes in every earlier phase;
this phase completes the system rather than postponing all accessibility.

1. Introduce a real i18n layer. Minimum release languages: Hebrew RTL and
   English. Russian can follow, but do not continue hard-coding new English
   strings.
2. Switch layout direction using logical CSS properties. Do not maintain
   separate RTL component trees.
3. Give every input a programmatic label; every repeated icon/button must include
   row/item context.
4. Implement modal/sheet focus trap, initial focus, Escape close, focus return,
   and background inertness.
5. Implement keyboard behavior for tablists and single-choice permission
   controls.
6. Review text and status contrast against WCAG AA; the current small secondary
   gray text is likely insufficient.
7. Never communicate state by color alone.
8. Respect reduced motion and 200% zoom; maintain minimum practical touch
   targets.
9. Test loading/error/empty states in both LTR and RTL.

Acceptance:

- complete owner smoke path works in Hebrew RTL and English;
- keyboard-only user can navigate, edit an item, inspect an order, and close all
  dialogs without losing focus;
- automated accessibility scan has no serious/critical violations on primary
  pages, with manual screen-reader checks for the main workflows;
- 390px mobile and 200% desktop zoom have no body-level horizontal overflow.

## Required validation matrix

Test these account shapes; the developer account alone is not sufficient:

| Account/product shape | Required smoke path |
|---|---|
| POS only | Dashboard -> Sales -> Activity -> Team -> Devices |
| Menu only | Dashboard -> Catalogue -> QR Menu -> preview/open public menu |
| Orders standalone | receive -> accept -> prepare -> ready -> complete |
| Orders + POS | inspect order -> see truthful POS handoff/read-only state |
| Reserve standalone | configure -> public booking -> host desk -> update booking |
| Reserve + POS | booking -> assign/seat -> POS-aware state |
| Multi-location | change location -> navigate -> verify scope and persistence |
| Developer | inspect product activation and planned modules without customer leakage |

Viewports/browsers:

- desktop Chromium, 1440x900;
- mobile 390x844;
- iOS Safari/WebKit for drawer, forms, sticky actions, and viewport behavior;
- keyboard-only desktop;
- Hebrew RTL and English LTR.

For every phase run at minimum:

```bash
cd /Users/enotov/Desktop/anglesite
npm run build
```

Also run the focused unit tests added in Phase 0. If `/Users/enotov/Desktop/kassa`
changes, run its documented lint, test, build, bundle, and schema checks. Record
exact commands and results; do not say “tested” based only on reading code.

## Definition of done for each phase

- implementation matches the capability/product model;
- happy path, empty, loading, error, and unauthorized states are covered;
- desktop and mobile were visually tested;
- keyboard and accessible names were checked for touched components;
- build/tests pass with results recorded;
- no unrelated files are staged;
- commit message names the phase and user-visible outcome;
- no deployment/push/migration occurs without explicit user instruction.

## Recommended execution order

Do not start by rebuilding all screens. Execute:

1. Phase 0 baseline.
2. Phase 1 release blockers.
3. Stop and provide the user with the commit, test results, screenshots, and any
   CSP/backend decision that needs approval.
4. Phase 2 navigation/location/product language.
5. Phase 3 Orders.
6. Phase 4 reservation host desk, coordinated with the Reserve plan.
7. Phases 5–8 as separately approved increments.

The first release milestone is complete when Phases 0–4 are verified. Catalogue,
CRM/device depth, reporting, and full localization can then ship incrementally
without leaving known correctness or navigation defects in production.

## Prompt to give Claude

> Read `/Users/enotov/Desktop/anglesite/docs/claude-backoffice-improvement-plan.md`
> completely, then read every repository instruction and existing plan it
> references. Inspect both repositories and current git state before editing.
> Start with Phase 0 and Phase 1 only. Reproduce each defect first, implement the
> smallest correct fix, add focused tests, run the documented validation, and
> show me the diff and test results. Preserve all unrelated/untracked files. Do
> not push, deploy, change CSP/DNS, or apply migrations unless I explicitly ask.
