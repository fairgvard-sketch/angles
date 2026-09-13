# Claude handoff: ANGLE Reservations — two-phase YCLIENTS-informed plan

## Mission

Bring the first two competitive improvements inspired by YCLIENTS into ANGLE:

1. turn Reservations into one coherent operational visit workspace;
2. turn the existing guest database into a useful retention system.

Do **not** copy YCLIENTS screens, salon terminology, or its product bloat. Take
the mature relationship between booking, visit, customer, communication and
analytics while preserving ANGLE's restaurant workflow, Square-like restraint,
and Wolt-quality guest experience.

This file is the implementation brief. Read it completely before changing
code. Do not rely on older reservation plans as an accurate backlog: many of
their items have already shipped.

## Repositories

### `/Users/enotov/Desktop/kassa`

Shared database, RPCs, Edge Functions, POS and public guest application.

Before editing, read completely:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture.md`
- `docs/database.md`
- `docs/development.md`
- `docs/deployment.md`
- `docs/reservations.md`
- `docs/standalone-products.md`

### `/Users/enotov/Desktop/anglesite`

Owner back office and host workspace.

Important current files include:

- `backoffice/src/ReservationsDesk.jsx`
- `backoffice/src/TimelineDesk.jsx`
- `backoffice/src/ReservationList.jsx`
- `backoffice/src/WaitlistPanel.jsx`
- `backoffice/src/BookingSheet.jsx`
- `backoffice/src/BookingForm.jsx`
- `backoffice/src/GuestsManager.jsx`
- `backoffice/src/ReserveAnalytics.jsx`
- `backoffice/src/QrChannels.jsx`
- `backoffice/src/reservations.js`
- `backoffice/src/guests.js`

Inspect the actual current code, git history and working tree before deciding
which files to change.

## Safety and delivery rules

1. Inspect `git status`, current branch and recent commits in both repositories.
2. Preserve every existing modified or untracked user file. Never stage an
   unrelated file.
3. Never rewrite an applied migration. Database work is forward-only; the next
   migration number follows the current highest migration.
4. Do not push, deploy, apply production migrations, alter DNS, or touch live
   customer data unless the user explicitly authorizes that exact action.
5. Do not use destructive reset or checkout commands.
6. One independently testable commit per vertical slice. Keep backend-before-
   frontend deployment order explicit when a slice changes the schema.
7. Do not mark a phase complete because it builds. Verify the real user flows at
   phone, tablet and desktop widths.
8. Report exact files changed, commands run, tests passed/failed, migrations
   added and remaining risks at every checkpoint.

## Hard product boundaries

- No reservation payments or deposits in these phases.
- No WhatsApp integration.
- No Telegram integration.
- No generic employee/service appointment flow.
- No payroll, inventory, certificates, subscriptions or phone system.
- No second guest table, second reservation backend or duplicated location.
- ANGLE Reserve must work as a standalone product without ANGLE POS.
- With POS enabled, an existing order may enrich the same visit and guest. POS
  must remain an advantage, not a dependency.
- Keep entitlement, product activation and per-location operational settings
  separate.
- Internal guest notes and tags must never leak to public endpoints.

## Verified baseline — do not rebuild it

At the time of this handoff the repositories already contain:

- canonical weekly reservation schedules, exceptions and timezone-aware slot
  generation (`117` and later);
- guest cancellation and rescheduling using opaque public tokens and cut-off
  rules (`118`);
- multi-table links and server-side availability revalidation (`119`);
- a back-office restaurant timeline, reservation list, shared booking drawer,
  manual reservations and walk-ins (`120`, `127` and current UI);
- restaurant guest CRM with visits, cancellations, no-shows, average party,
  POS spend/favourites where POS exists, notes, tags, audit, merge and erase
  flows (`114`, `121`, `131`);
- a provider-neutral notification outbox, reminder jobs and secure waitlist
  offers (`122`, hardened by `147`);
- a working waitlist with web add, reorder, seat and status operations (`137`);
- source/UTM attribution, origin, reservation funnel and exact analytics
  (`124`–`126`, `134`, `136`);
- standalone Reserve entitlements and POS-connected mode;
- reservation rules acknowledged by the guest (`145`);
- launch checklist and booking-page preview;
- mobile-responsive work already in progress for Reservations.

Start Phase 0 by proving this baseline from code and tests. Do not create a new
schema or UI for a capability that already exists. Extend the current path.

## Product model for both phases

The user-facing concept is a **visit**, even if the current database table is
still named `reservations`.

One visit joins, without duplicating records:

- reservation identity and status;
- guest identity;
- party size, visit time and duration;
- assigned table(s) and zone;
- arrival/seating/completion/no-show state;
- source and creation origin;
- guest note, preferences and acknowledged rules;
- waitlist provenance where relevant;
- linked POS order and payment summary when POS exists;
- audit/activity history.

Do not rush into a risky table rename. First expose one canonical read model and
one shared action model. Rename only if the Phase 0 audit proves that it is safe
and valuable.

---

# Phase 0 — mandatory audit and acceptance baseline

Estimated effort: 1–2 focused days. This is not a third product phase; it is the
required start of Phase 1.

## Work

1. Map the current reservation/guest/waitlist/order data path across both repos.
2. Inventory relevant tables, columns, statuses, RPCs, Edge actions, RLS,
   entitlements, realtime subscriptions and current browser tests.
3. Build a truth table for standalone Reserve versus POS-connected Reserve:
   which facts and actions exist in each mode.
4. Run existing database, unit, browser and production builds before edits.
5. Record the current manual flow at these viewports:
   - 390 px phone;
   - 768–834 px tablet;
   - 1440 px desktop.
6. Specifically verify current Timeline, List, Waitlist, booking drawer,
   Customers profile, public manage-booking link and conflict alternatives.
7. Create a short audit note containing only confirmed gaps relevant to the two
   phases below.

## Stop condition

Do not implement a new visit table, segment engine or notification provider
until the audit shows the current implementation cannot support the required
flow.

---

# Phase 1 — unified visit and excellent host operations

## Outcome

A host can understand the room, open a visit and perform the next correct action
without navigating between Reservations, Customers, Orders and POS. A guest can
manage a booking without calling. The workflow is equally coherent in
standalone and POS-connected modes.

## 1. Canonical visit read model

Create or extend one tenant-safe server read model/RPC used by Timeline, List
and the booking drawer. It must return only facts the current member is allowed
to see and must include where available:

- reservation id, status, date/time, duration and party size;
- table links, zone and conflict state;
- guest id, name, phone and concise operational context;
- visit counts, cancellations, no-shows and average party;
- internal note/tags only for authorized staff;
- source, UTM/origin, created time and rule acknowledgements;
- waitlist source/offer relation;
- order id plus small POS summary: order number, operational status, total and
  payment state. Do not duplicate order lines into reservations;
- activity timestamps needed for the history.

Prefer extending existing RPCs over adding several competing endpoints. Avoid
N+1 requests when the host opens a visit.

## 2. One shared visit drawer

Evolve the existing `BookingSheet`, do not create separate timeline/list
versions.

Required information order:

1. guest, party size, date and time;
2. table(s), zone and current visit status;
3. one prominent next action for the current state;
4. phone, note, preferences and acknowledged rules;
5. concise returning-guest context;
6. linked order/payment summary only when POS data exists;
7. source/origin and compact history;
8. secondary/destructive actions in a restrained area.

Requirements:

- actions are state- and permission-aware;
- conflict refusal remains server-authoritative and offers valid alternative
  tables/times;
- POS-seated visits remain read-only where current invariants require POS to own
  the order;
- standalone seating/completion still works without an order;
- opening one visit from Timeline or List produces the same content and actions;
- Escape and close return focus to the originating row/block;
- timeline date, zone, horizontal/vertical scroll and selection do not reset;
- no white flash or full-page reload during realtime updates;
- on phones the drawer becomes an intentional full-screen sheet with a clear
  Back/Close path.

## 3. Timeline: make the real table useful on phones

The user explicitly wants the **actual table-by-time timeline**, not a replacement
dashboard or a list disguised as a calendar.

Desktop/tablet:

- keep table/zone labels and time ruler sticky;
- readable reservation blocks with status text plus color;
- current-time marker;
- table rows large enough to scan;
- out-of-service tables remain visible as muted rows, not hidden by a vague
  system message;
- zone filtering and Earlier/Later stay compact and predictable.

Phone:

- keep the real two-dimensional timeline;
- make the sticky table column wide enough to read table name and seats;
- show a useful 2–3 hour viewport rather than compressing the whole service day;
- horizontal pan changes time while vertical scroll changes tables;
- preserve ruler/body alignment;
- reservation blocks remain tappable (minimum 44 px target) and show at least
  time/name or party according to available width;
- opening/closing a visit returns to the exact same table and time position;
- no page-level horizontal overflow: only the timeline viewport scrolls;
- mobile browser chrome and safe-area insets must not cover content.

Do not add `Status color`, `View settings`, KPI cards or other unexplained
controls. The legend may be compact or collapsible but status is always written
on the reservation block/drawer.

## 4. Correct Reservations information architecture

Preserve the five current tabs:

- Timeline;
- List;
- Waitlist;
- Tables & zones;
- Analytics.

Rules:

- operational creation actions (`Walk-in`, `New reservation`) come before the
  date on Timeline;
- the date picker belongs to Timeline only;
- Waitlist is about **now**. It must not inherit past/future date navigation;
- List starts at today and looks forward using its range filter; do not expose a
  meaningless past-date picker there;
- guest search belongs to List. Do not duplicate the same search over Timeline;
- Waitlist may have its own local search only if real volume proves it useful;
- no oversized universal controls, duplicated filters or vague refresh buttons;
- realtime/polling handles normal refresh automatically; show manual Retry only
  on stale/error state.

## 5. Finish the waitlist recovery loop

Build on migrations `122` and `137`.

- `Waiting now` is the primary group with running waited time and quoted wait;
- `Seat guest` uses the authoritative server choice and creates/seats the visit;
- if no table fits, show the explicit server response and do not pretend it is a
  network failure;
- when a future reservation is cancelled, expose suitable matches for the freed
  slot to the host using the existing matching function;
- offers expire, are idempotent and revalidate capacity before conversion;
- show why a candidate matches: party, time window and zones;
- do not introduce fake message delivery. The outbox may remain pending until a
  real provider adapter exists.

## 6. Guest self-service polish

Build on migration `118` and the current public booking page.

The secure booking-details page must let a guest:

- see status, party, date/time, zone, address, phone and policy;
- cancel or reschedule when the server says it is allowed;
- receive refreshed alternatives after a reschedule conflict;
- download a correct `.ics` calendar event;
- open Maps/Waze directions;
- repeat a booking without losing safe defaults;
- use Hebrew RTL and supported LTR languages without layout breakage.

No account is required for the opaque-token flow. Never expose an enumerable
reservation id or internal guest data.

## 7. Visit activity history

Use existing audit/event facts where possible. The drawer needs a compact,
truthful timeline such as:

- booked online / added by staff;
- confirmed or rejected;
- rescheduled;
- reminder/confirmation requested;
- arrived/seated;
- completed/no-show/cancelled;
- waitlist offer accepted;
- linked POS order created/closed where available.

Do not manufacture events from the current status. If a fact was never stored,
say less or add an append-only event in a forward migration.

## Phase 1 acceptance scenarios

1. Public instant booking appears on Timeline in realtime and opens in the same
   drawer as a manually created booking.
2. Manual booking conflict shows the server error and tappable free alternatives.
3. Editing a visit onto a busy table produces the same refusal and alternatives.
4. A walk-in is seated immediately and occupies the correct table.
5. A waitlist guest can be seated; no-table state is explicit and preserves the
   queue entry.
6. A guest cancels/reschedules from the secure link; the host view updates
   without scroll reset.
7. A POS-connected visit shows its real order/payment summary but cannot be
   illegally mutated from the back office.
8. A standalone visit completes with no POS assumptions or empty placeholders.
9. Phone Timeline provides a readable 2–3 hour window and tappable visit blocks,
   with no page overflow.
10. Timeline has no duplicate guest search; List search and filters still work.
11. Waitlist has no date navigation and represents the live queue.

---

# Phase 2 — customer retention and actionable CRM

## Outcome

ANGLE recognizes returning guests, tells the team the small amount of context
needed for better service, and gives the owner concrete retention actions. It
does not become a marketing automation suite or expose sensitive data.

## 1. Automatic, explainable customer segments

Extend the existing customer RPC; do not write mutable labels into every guest
row if a segment can be derived safely.

Initial segments:

- `New` — first completed visit in the selected period;
- `Returning` — at least two completed visits;
- `Regular` — configurable frequency threshold;
- `VIP` — configurable spend/visit threshold (POS spend when available,
  visit-only fallback for standalone Reserve);
- `At risk` — was active but is overdue relative to their normal cadence;
- `Lost` — no completed visit for a configurable longer threshold;
- `Upcoming` — has a future active reservation;
- `Repeated no-show` — reaches a clear no-show threshold.

Requirements:

- define formulas and timezone boundaries in code/docs;
- expose `why_segment` or equivalent evidence so the UI can explain a label;
- support org-wide identity and location filtering without creating duplicate
  customers per location;
- use completed/real visits, not test bookings, rejected requests or cancelled
  reservations, in retention calculations;
- avoid labelling a new low-history customer `Lost` merely because no data
  exists;
- segment queries must be server-side, paginated and tenant-scoped.

## 2. Restaurant customer profile

Evolve the current Customers drawer.

Keep the first screen concise:

- name, phone and permission-aware edit;
- next reservation;
- last visit and visit count;
- cancellations/no-shows;
- average party and usual day/time;
- preferred zone/table when evidence is meaningful;
- internal preferences such as accessibility, allergy or seating note;
- total spend, average check, recent orders and favourites only with POS;
- manual tags and automatic segments clearly distinguished;
- chronological activity/history.

Do not infer allergies from ordered items. Allergy/accessibility information is
explicit sensitive staff input and needs audit/permission handling.

Opening a customer from a visit must take one action and return to the same visit
when closed.

## 3. Recognition during booking

In manual booking and walk-in flows:

- normalize phone safely on the server;
- after sufficient phone input, show a returning-customer match without exposing
  an organization-wide directory to unauthorized users;
- selecting the match reuses the canonical guest id;
- show only useful host context: last visit, no-show warning, usual party/zone
  and one internal note;
- preserve the current duplicate merge and anonymization invariants;
- concurrent creation must not produce two active canonical profiles for the
  same normalized phone in one organization.

Public booking should link to the canonical profile server-side but must not
reveal whether arbitrary phone numbers exist.

## 4. Retention actions, not a dashboard wall

Add a small actionable section to Customers, not many KPI cards.

Useful saved views/actions:

- guests with an upcoming visit;
- at-risk regulars;
- lost customers;
- repeated no-shows;
- recently new guests who have not returned;
- birthdays only if an explicit birthday field and consent legally exist.

Each view needs a clear explanation and a useful next action. Until a real
communication provider is connected, the valid actions are export, copy list or
review profiles. Do not display `Send campaign` or success messages for a
provider that does not exist.

## 5. Notification lifecycle on the existing outbox

Do not replace `notification_outbox`.

Complete domain events and operational visibility for:

- booking confirmation;
- pre-visit reminder;
- confirmation request where configured;
- cancellation notice;
- waitlist offer;
- optional post-visit review request.

Requirements:

- org-scoped dedupe remains intact;
- delivery status, attempt count, last error and provider message id are
  visible to authorized staff/support;
- retry is bounded and idempotent;
- consent, language, location timezone and template snapshot are recorded;
- `pending` is not shown as `sent`;
- if no provider exists, expose `Delivery not configured` in settings and keep
  the business flow working without notifications;
- no WhatsApp or Telegram adapter in this phase.

## 6. Actionable retention analytics

Reuse exact reservation analytics and guest facts. Add only metrics that lead to
decisions:

- new versus returning guests;
- 30/60/90-day return rate with documented cohorts;
- cancellation and no-show rate by segment/source;
- average lead time and party size;
- repeat rate after first visit;
- waitlist conversion;
- source quality: completed visits, not merely form submissions;
- POS-only: average check and revenue by segment.

Network views require permission across the selected locations. Every number
must reconcile to underlying records for a sampled period. Keep Analytics out
of the operational Timeline first screen.

## 7. Privacy, permissions and audit

- preserve organization isolation and existing RLS;
- separate permissions for customer export, sensitive note editing, merge and
  erase;
- automatic segment calculation does not expose private notes;
- merged profiles never reappear in search or POS guest lookup;
- erase/anonymize removes personal data from new tables/events/outbox payloads
  as required while preserving lawful financial records;
- every manual change to profile, tags and sensitive preferences is audited;
- CSV export remains permission-gated and should export the active filtered
  cohort, not silently the entire database.

## Phase 2 acceptance scenarios

1. A returning phone number selects one canonical guest in manual booking and
   does not create a duplicate.
2. A standalone Reserve guest has visit-based segments with no fake spend data.
3. A POS guest shows real spend/favourites and the linked visit drawer summary.
4. `At risk` and `Lost` classifications are explainable and change correctly as
   new completed visits arrive.
5. Test, rejected and cancelled bookings do not inflate completed visits or
   retention.
6. Repeated no-show warning is visible to staff but never to the public guest.
7. Customer merge updates reservations, waitlist and orders; the merged source
   no longer appears in back-office or POS search.
8. Erase/anonymize covers any new retention/event data without deleting
   immutable financial facts.
9. Notification with no provider stays visibly pending/unconfigured; no fake
   `sent` state appears.
10. Segment filters, pagination and CSV respect permissions and org/location
    scope.

---

# Required verification

## Database and security

- pgTAP for every new/changed RPC, RLS policy and migration;
- cross-tenant reads and writes denied;
- schedule/capacity/concurrency remains server-authoritative;
- canonical phone identity and concurrent duplicate prevention;
- standalone/POS truth table;
- notification dedupe and bounded retry;
- merge and anonymization coverage for all added relations;
- schema version test updated only when a migration actually requires a linked
  client release.

## Browser and interaction

- real Chromium tests for Timeline, List, Waitlist, booking drawer and Customers;
- WebKit/manual iPhone Safari acceptance where automation is unavailable;
- 390 px, common Android, 768–834 px tablet and desktop;
- RTL Hebrew and at least one LTR language;
- keyboard, focus return, Escape, screen-reader labels, forced/reduced motion;
- no page horizontal overflow; only intentional timeline scrolling;
- realtime updates preserve selection and scroll;
- loading skeletons reserve stable space and do not flash stale content.

## Performance targets

Measure against realistic data, not empty fixtures:

- 50 tables and 200 reservations in one service day;
- 10,000 guests with paginated/filterable server queries;
- opening a visit performs a bounded number of queries and no N+1 loop;
- timeline pan/open/close remains responsive on a mid-range phone;
- realtime updates patch/reload data without remounting the whole workspace.

# Suggested delivery slices

## Phase 1 commits

1. audit note and regression baseline;
2. canonical visit read model + database tests;
3. unified drawer + host actions;
4. mobile/tablet timeline viewport;
5. information architecture cleanup for Timeline/List/Waitlist;
6. waitlist recovery loop;
7. public self-service polish + visit history;
8. Phase 1 end-to-end acceptance and documentation.

## Phase 2 commits

1. automatic segment definitions + RPC/tests;
2. customer profile and visit-to-customer navigation;
3. returning-customer recognition in manual booking/walk-in;
4. actionable saved views and filtered export;
5. notification lifecycle/status visibility;
6. retention analytics;
7. privacy/merge/erase regression suite and documentation.

# Final definition of done

A phase is complete only when:

1. its acceptance scenarios pass in both standalone and POS-connected modes;
2. database, unit, browser and production builds pass;
3. the real mobile UI was inspected, not inferred from CSS alone;
4. new migrations are forward-only and include verification/recovery notes;
5. no unrelated user files are staged;
6. documentation describes the shipped behavior and remaining limitations;
7. Claude provides a concise evidence report and waits for explicit permission
   before push, deploy or production migration.

## Research direction

Patterns are informed by the current official YCLIENTS product pages:

- online booking and guest self-service: `https://www.yclients.com/online-booking`
- electronic schedule and visit window: `https://www.yclients.com/electronic-schedule`
- client base and segmentation: `https://www.yclients.com/client-base`
- source/occupancy/retention analytics: `https://www.yclients.com/statistics-and-analytics`
- notifications: `https://www.yclients.com/sms-and-email-notification`

Use these as product-pattern references only. ANGLE terminology, data model,
restaurant operations, accessibility and existing design system remain the
source of truth.

---

# Ready-to-send prompt for Claude

Copy and send this prompt without shortening it:

> Read the following file completely before taking any action:
> `/Users/enotov/Desktop/anglesite/docs/claude-reservations-two-phase-yclients-plan.md`
>
> This is the approved two-phase implementation plan for ANGLE Reservations.
> Work from the actual current state of both repositories, not from assumptions
> or older plans. First complete the mandatory Phase 0 audit and report the
> confirmed baseline, gaps, proposed files/migrations, test plan and commit
> boundaries. Do not start implementation until you have shown that audit and
> reconciled every proposed item with features that already exist.
>
> Then execute Phase 1 before Phase 2, using the vertical slices and acceptance
> scenarios in the document. Do not rebuild already shipped capabilities. Keep
> standalone Reserve and POS-connected Reserve working, preserve all existing
> user changes, use only forward migrations, and do not add reservation
> payments, WhatsApp, Telegram or generic salon appointment flows.
>
> Test the real UI at phone, tablet and desktop widths. A build alone is not
> acceptance. After each slice, report exact files changed, tests run, failures,
> remaining risks and the next slice. Do not commit, push, deploy or apply
> production migrations without my explicit permission.
