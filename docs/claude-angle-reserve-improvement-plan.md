# Claude handoff: ANGLE Reserve improvement plan

## Mission

Bring `ANGLE Reserve` to a sellable restaurant-grade level by combining:

- ANGLE's strongest assets: native POS connection, live table availability,
  zones, combined tables, Israel-first UX, custom branding, and the ability to
  sell Reserve as a standalone product or a POS add-on;
- INNO's strongest assets: restaurant-specific host calendar, clear table/time
  occupancy, operational work with a guest, and restaurant guest history;
- YCLIENTS' strongest assets: schedule configurability, self-service
  cancellation/rescheduling, CRM depth, waitlist workflow, source analytics,
  multi-location operations, and lifecycle automation.

Do not turn ANGLE into a generic appointment system. Guests reserve a table,
not a service or an employee.

## Repositories

### Shared backend, POS, and public guest routes

Path: `/Users/enotov/Desktop/kassa`

Important reservation files already identified:

- `src/features/reservations/PublicReservePage.tsx`
- `src/features/reservations/ReservationsPage.tsx`
- `src/features/reservations/publicReserveApi.ts`
- Supabase reservation migrations, RPCs, RLS policies, and Edge Functions

Before editing, read completely:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/database.md`
- `docs/reservations.md`
- `docs/standalone-products.md`
- `docs/deployment.md`

### Owner back office and marketing site

Path: `/Users/enotov/Desktop/anglesite`

Important files already identified:

- `backoffice/src/ReservationsDesk.jsx`
- `backoffice/src/QrChannels.jsx`

Read repository instructions and inspect the surrounding reservation code before
changing anything.

## Safe working rules

1. Inspect `git status`, current branch, and recent commits in both repositories.
2. Preserve all existing modified and untracked files. Never stage unrelated
   changes.
3. Never rewrite an existing migration. Use forward-only migrations.
4. Make one independently testable commit per phase.
5. Do not push, deploy, change DNS, or apply production migrations unless the
   user explicitly asks for that concrete action.
6. Do not use destructive reset/checkout commands.
7. Do not mix this task with the QR Menu transition/animation work.

At the time this plan was written, `/Users/enotov/Desktop/anglesite` contained
user-owned untracked files including `IMG_3617-hero.mp4`, `IMG_3617.mov`, and
the `docs/` directory. Recheck status because it may have changed.

## Product boundaries

- `ANGLE Reserve` must continue to work without ANGLE POS.
- The same Reserve implementation is used when sold standalone or as a POS
  add-on. Do not fork the product.
- With POS enabled, Reserve may enrich the guest profile using orders and may
  seat a reservation into a POS table/order.
- Without POS, the reservation desk, availability, guest records, confirmations,
  cancellation, rescheduling, and analytics must still work.
- Keep entitlement, operational enablement, and opening-hours availability as
  separate concepts.

## Hard scope locks

- No reservation deposits or payments.
- No WhatsApp integration.
- No Telegram integration.
- No generic employee/service appointment flow.
- No payroll, inventory, certificates, or other YCLIENTS features unrelated to
  restaurant reservations.
- No second backend and no duplicated organizations, locations, tables, guests,
  or reservations.

Email reminders may be prepared only if a working email delivery provider is
already present. Otherwise build the provider-neutral event/outbox layer and do
not pretend that messages were sent. SMS is a later adapter, not a blocker for
the core release.

## Verified baseline

ANGLE already has:

- a three-step guest flow;
- live availability based on table capacity;
- zone-specific options;
- automatic table selection;
- optional table combining;
- visit duration, buffer, slot length, and maximum party settings;
- instant and manual confirmation modes;
- guest status polling and cancellation;
- POS/back-office handling for accept, reject, assign table, seat, complete,
  no-show, and history;
- branded public page, QR links, and embedding;
- standalone product entitlement architecture.

Known weaknesses that must drive the work:

1. Reservation hours are not a safe single source of truth. The live page was
   observed offering Saturday slots while its visible opening hours said the
   business was closed.
2. Reservation hours are currently too uniform; restaurants need rules per day
   of week plus date exceptions and special shifts.
3. The host desk is list/card based rather than a restaurant timeline.
4. Guests cannot conveniently reschedule or add the booking to a calendar.
5. There is no proper waitlist and freed slots are not recovered.
6. Guest history is basic and is not connected into a useful restaurant CRM.
7. Reservation source, conversion, cancellation, no-show, and occupancy
   analytics are incomplete.
8. Public presentation still needs production metadata and location content;
   placeholder address/title values were observed.

## What to learn from each product

| Product | Take | Do not copy |
|---|---|---|
| ANGLE | Three-step low-friction flow, live restaurant table engine, zones, combined tables, native POS handoff, custom branding, Israel-first RTL UX | Current schedule mismatch, list-only host desk, limited CRM |
| INNO | Tables-by-time host timeline, visible occupancy, fast restaurant operations, guest history tied to restaurant behavior | Unverified marketing claims, heavy enterprise surface before core correctness |
| YCLIENTS | Per-day/dynamic availability rules, branded forms, cancellation/rescheduling rules, personal booking details, waitlist, customer profile, segmentation, source/no-show analytics, multi-location patterns | Employee/service selection, appointment terminology, payroll/inventory/loyalty bloat |

Important: YCLIENTS is a mature service-business CRM, not a restaurant table
engine. Its CRM and scheduling patterns are useful, but it is not the model for
table capacity, zones, combined tables, walk-ins, or seating into POS.

## Target guest journey

Keep the flow short and restaurant-specific:

1. **Choose visit** — party size, date, and preferred time.
2. **Choose an available option** — recommended exact slot first, nearby times
   second, zone preference where relevant. Do not show artificial duplicate
   choices for equivalent tables.
3. **Guest details** — name, phone, optional note, and explicit consent where
   legally required.
4. **Confirmation** — status, date/time, party, zone, address, directions,
   add-to-calendar, cancellation, and rescheduling.

The guest should not choose a physical table number unless the restaurant has
explicitly enabled that unusual mode. Table assignment is operational detail.

## Phase 0 — audit and measurable baseline

Estimated effort: 1–2 working days.

### Work

1. Map the full reservation data path: public page -> API/RPC/Edge Function ->
   availability -> insert -> realtime/polling -> POS/back office.
2. Inventory tables, RPCs, policies, tokens, statuses, settings, and analytics
   fields related to reservations.
3. Document exactly how opening hours shown to guests are calculated and how
   bookable slots are calculated.
4. Record mobile screenshots and timings for every guest step in Hebrew RTL at
   iPhone-sized and Android-sized viewports.
5. Record the current test/build baseline before edits.
6. Add no code unless needed to make the baseline reproducible.

### Acceptance

- A short audit note lists current schema, call graph, security boundaries,
  existing tests, and confirmed gaps.
- No unrelated files have changed.

## Phase 1 — availability correctness and schedule model

Estimated effort: 4–6 working days. This is the release blocker.

### Work

1. Replace the single uniform reservation interval with a schedule that supports:
   - separate intervals per weekday;
   - multiple service periods per day, for example lunch and dinner;
   - closed weekdays;
   - one-off closures and holidays;
   - one-off extended/special hours;
   - booking lead time and maximum advance window;
   - location timezone, including DST.
2. Make visible opening/reservation hours and slot generation consume the same
   canonical configuration.
3. Preserve duration, buffer, party limit, zone, table capacity, and table
   combining logic.
4. Make concurrent booking safe. The final create operation must revalidate
   availability server-side and return a clear conflict response.
5. Add a back-office weekly editor and exceptions editor with preview of the
   next seven days.
6. Use a forward-only migration and preserve existing settings through a safe
   backfill.

### Acceptance

- A closed day never appears bookable and is displayed as closed everywhere.
- Split shifts generate only valid slots.
- Exceptions override the weekly schedule predictably.
- Tests cover Asia/Jerusalem DST, overnight boundaries, visit duration, buffer,
  combined tables, blocked tables, and simultaneous booking attempts.
- Existing organizations retain equivalent behavior after migration.

## Phase 2 — guest booking UX and self-service

Estimated effort: 5–7 working days.

### Work

1. Keep the existing short step model; do not add YCLIENTS-style employee or
   service selection.
2. Present the best matching slot prominently and nearby alternatives in a
   compact layout. Explain zone differences without making guests understand
   the table map.
3. Preserve the guest's choices when moving backward or recovering from a
   conflict.
4. Add a stable confirmation/details URL using an opaque guest token.
5. Add self-service cancellation and rescheduling with configurable cut-off
   rules. Revalidate availability during reschedule.
6. Add `.ics` calendar download and platform-friendly "Add to calendar" action.
7. Add address, Maps/Waze actions, restaurant phone, and cancellation policy.
8. Add Hebrew/English/Russian structure if the localization framework already
   supports it; Hebrew remains first-class and fully RTL.
9. Complete production page title, description, social metadata, icons, and
   standalone PWA behavior for `menu.angle.co.il`.
10. Follow accessible mobile standards: visible focus, semantic labels, no
    color-only status, 44px minimum touch targets, keyboard operation, reduced
    motion, and safe-area support.

### Acceptance

- A guest can book, review, reschedule, and cancel without calling the venue.
- Back navigation preserves state and has no flash, layout shift, or stale data.
- A conflict offers refreshed alternatives rather than discarding the form.
- RTL/LTR, small iPhone, large iPhone, Android, and tablet layouts pass visual
  checks.
- No payment or messenger UI is shown.

## Phase 3 — restaurant host timeline

Estimated effort: 7–10 working days. This is the largest competitive upgrade.

### Work

1. Build a day timeline inspired by INNO, not a generic staff calendar:
   - tables or table groups on one axis;
   - time on the other axis;
   - reservations as duration blocks;
   - current-time marker;
   - zone filters;
   - clear status colors with text/icons;
   - conflict and blocked-table states.
2. Add a side panel for new/pending reservations and today's operational queue.
3. Support manual phone reservations, walk-ins, edits, cancellation, no-show,
   table reassignment, and combining/uncombining tables.
4. Keep the current list/history view as a secondary view; do not delete it.
5. Provide a compact mobile/tablet host view, but optimize the full timeline for
   a desktop or host tablet.
6. With POS entitlement active, preserve one-action seating into the correct
   table/order. Without POS, mark the guest seated and continue normally.
7. Use realtime updates without resetting scroll position, selection, or the
   whole calendar.

### Acceptance

- A host can understand occupancy and free capacity for the next hours in under
  five seconds.
- New reservations appear without a full-page refresh.
- Reassigning or changing time cannot create a hidden conflict.
- List and timeline operate on the same records and status model.
- Timeline remains usable with at least 50 tables and 200 reservations/day.

## Phase 4 — restaurant guest CRM

Estimated effort: 4–6 working days.

### Work

1. Create or extend a canonical guest profile keyed safely by normalized phone
   within an organization.
2. Show visits, cancellations, no-shows, future reservations, notes, preferred
   zone/table, party-size patterns, first/last visit, and total visit count.
3. When POS is active, enrich the profile with total spend, average check,
   recent orders, and frequently ordered items. When POS is absent, hide these
   fields cleanly.
4. Add internal tags such as VIP, regular, accessibility need, and repeated
   no-show. Tags must not leak to the public API.
5. Add permission checks and an audit trail for sensitive guest data changes.
6. Add search by phone/name and quick guest recognition during a phone booking.

### Acceptance

- Returning guests are recognized without duplicate profiles.
- A host can see the useful visit context from a reservation in one action.
- POS enrichment is optional and does not break standalone Reserve.
- Public endpoints cannot enumerate guests or expose internal notes/tags.

## Phase 5 — confirmations, reminders, and waitlist

Estimated effort: 5–7 working days.

### Work

1. Introduce a provider-neutral notification outbox with idempotency, delivery
   status, retry limits, and audit history.
2. Implement confirmation and reminder templates for email only if an email
   provider is already configured. Otherwise leave the delivery adapter clearly
   disabled while retaining testable domain events.
3. Add a guest confirmation request before the visit with a configurable time
   window and a status visible to hosts.
4. Build a restaurant waitlist:
   - preferred date;
   - acceptable time range;
   - party size;
   - acceptable zones;
   - guest contact;
   - expiration/status.
5. Unlike current YCLIENTS behavior, allow a guest to join the waitlist from the
   public flow when no suitable slot exists.
6. First release: host-assisted matching and a one-click secure offer link.
   Automatic delivery can follow only when a provider is available.
7. Expire offers and revalidate the slot before conversion to a reservation.

### Acceptance

- Duplicate jobs do not send duplicate messages.
- Hosts can fill a newly freed slot from matching waitlist entries.
- A waitlist offer cannot reserve an expired or already occupied slot.
- No WhatsApp, Telegram, payment, or fake-success implementation is introduced.

## Phase 6 — analytics, quality, and sellable packaging

Estimated effort: 4–6 working days.

### Work

1. Track the funnel: reservation page opened -> availability requested -> slot
   selected -> form started -> submitted -> confirmed -> seated/completed,
   cancelled, rejected, or no-show.
2. Report by source/UTM/QR channel, location, zone, weekday, hour, party size,
   and confirmation mode.
3. Add restaurant metrics:
   - conversion rate;
   - occupancy by available seat-hours;
   - cancellation and no-show rate;
   - average lead time;
   - average party size;
   - waitlist conversion;
   - most requested unavailable time ranges.
4. Provide network-level filters only for users authorized across locations.
5. Finish standalone Reserve onboarding: create location, hours, zones/tables,
   booking policy, branding, test booking, publish QR/link.
6. Add a launch checklist and a preview/test mode that cannot be confused with
   production availability.

### Acceptance

- Metrics reconcile with reservation records for a sampled period.
- Source attribution survives the whole booking flow.
- A Reserve-only organization can onboard and operate without POS data.
- A POS organization can enable Reserve as an add-on without duplicating setup.

## Required tests

### Domain and database

- Per-day schedules, closures, special hours, lead/advance windows.
- Timezone and DST boundaries for Asia/Jerusalem.
- Capacity for single and combined tables.
- Duration and buffer overlap rules.
- Concurrent create and reschedule conflicts.
- Opaque guest token scope and expiry.
- Organization isolation and RLS for every new table/RPC.
- Status transition permissions and audit events.

### Guest end-to-end

- Instant confirmation.
- Manual confirmation and status polling.
- No availability -> waitlist.
- Conflict after slot selection -> refreshed alternatives.
- Cancellation before/after cut-off.
- Reschedule before/after cut-off.
- Calendar file content and timezone.
- Hebrew RTL and English/Russian LTR.

### Host end-to-end

- Manual reservation and walk-in.
- Accept/reject/confirm/no-show/complete.
- Reassign time/table and combine tables.
- Realtime arrival from the public page.
- Seat into POS and standalone seated state.
- Guest lookup and protected internal notes.

### Visual/performance

- Playwright Chromium and WebKit mobile viewports.
- Small iPhone, current large iPhone, common Android, iPad/tablet, and desktop.
- Reduced-motion and keyboard accessibility.
- No full-page flash or unexpected scroll reset during realtime updates.
- Availability response and timeline rendering measured with realistic data.

## Delivery order

### Sellable Reserve v1

Complete Phases 0–3 plus cancellation, rescheduling, calendar, and the minimal
guest profile from Phase 4. This is the point at which ANGLE becomes materially
competitive for a real restaurant.

### Retention v2

Complete the guest CRM, provider-neutral reminders, confirmation requests, and
waitlist from Phases 4–5.

### Management v3

Complete analytics, multi-location views, and polished standalone onboarding
from Phase 6.

Estimated total for one strong full-stack developer, including migrations,
tests, responsive UI, and QA: approximately 6–9 focused weeks. A credible
sellable v1 is approximately 3–5 weeks. These are planning ranges, not promises;
Claude must refine them after Phase 0.

## Definition of done for every phase

1. Relevant builds, type checks, linters, unit tests, and integration/E2E tests
   pass.
2. New migrations include rollback/recovery notes and verification queries.
3. The public flow has been tested at phone width in both RTL and LTR where
   applicable.
4. Standalone Reserve and POS-connected Reserve are both tested.
5. No unrelated user files are included in the commit.
6. Documentation is updated with the actual implementation, not intentions.
7. Claude reports exact files changed, commands run, tests passed/failed, and
   remaining risks before asking to continue to the next phase.

## Product success criteria

The work succeeds when:

- guests never see a slot that contradicts the restaurant's schedule;
- booking requires no explanation from staff;
- guests can manage their reservation without a phone call;
- hosts can see occupancy and act on changes from one timeline;
- returning guests are recognized and handled with context;
- cancellations can be recovered through a waitlist;
- management can measure conversion, occupancy, sources, and no-shows;
- all core capabilities work for a standalone Reserve customer;
- POS integration is a clear advantage, not a dependency.

## Research sources

- INNO online booking: `https://inno-clouds.ru/online-booking/`
- INNO platform overview: `https://inno-clouds.ru/`
- YCLIENTS online booking: `https://www.yclients.com/online-booking`
- YCLIENTS electronic schedule: `https://www.yclients.com/electronic-schedule`
- YCLIENTS client base: `https://www.yclients.com/client-base`
- YCLIENTS analytics: `https://www.yclients.com/statistics-and-analytics`
- YCLIENTS available-time rules: `https://support.yclients.com/689`
- YCLIENTS cancellation/rescheduling rules: `https://support.yclients.com/824`
- YCLIENTS waitlist: `https://support.yclients.com/5-14-960--list-ozhidaniya-ot-yclients/`
- ANGLE live Reserve example: `https://menu.angle.co.il/reserve/bulochka`
