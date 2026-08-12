# Phase 0 audit — two-phase YCLIENTS-informed Reservations plan

Date: 2026-08-12. Repos inspected at `kassa@fbdb9c1` (main) and
`anglesite@0430a26` (main). Nothing committed, staged or deployed.

This note records only what was proved from code and test runs. It exists to
stop Phase 1 from rebuilding shipped capabilities.

## Regression baseline (before any edit)

| Suite | Result |
|---|---|
| `kassa: npm run lint` | pass |
| `kassa: npm run test:run` | 58 files, 490 tests, pass |
| `kassa: npm run build` | pass |
| `kassa: npm run check:bundle` | pass (modern 61.8 KiB, legacy 128.4 KiB gzip) |
| `kassa: npm run check:schema` | pass, `v151` |
| `kassa: supabase db reset` | 151 migrations apply clean |
| `kassa: supabase test db` | 67 files, **1164 tests, all pass** |
| `anglesite: npm run build` | pass |
| `anglesite: npm test` | 759 tests, **758 pass / 1 fail (pre-existing)** |

Pre-existing failure, unrelated to reservations:
`backoffice/src/ActivityManager.test.js:131` asserts
`class="secondary-button" disabled=""`, but the export button renders
`class="secondary-button compact page-export-button" disabled=""` since
`0430a26`. The behaviour under test (button disabled when there is nothing to
export) is correct; the regex is stale.

## Measured interface state

Real Chromium, components built from source, Supabase stubbed with 12 tables in
2 zones and 40 visits. Not inferred from CSS.

| Measure | 390 | 768 | 834 | 1440 |
|---|---|---|---|---|
| page horizontal overflow | 0 | 0 | 0 | 0 |
| sticky table column | 72 px | 112 px | 112 px | 112 px |
| visible timeline window | 3.3 h | — | — | — |
| smallest visit block | 48×48 px | 48×44 | 48×44 | 48×44 |
| ruler/body scroll sync | 420/420 | n/a (single scroller) | n/a | n/a |
| drawer size | 100%×100% | 57% | 53% | — |
| focus returns to block on Escape | yes | yes | yes | — |
| selects to render the desk once | **14** | 14 | 14 | 14 |

Longer and Hebrew table labels were not measured at 72 px; that stays an open
item for the phone slice.

## Already shipped — do not rebuild

Plan §4 (information architecture) is essentially already the shipped design:
five tabs in the required order (`ReservationsDesk.jsx:34`), `Walk-in` and
`New reservation` before the date on Timeline (`:160`), date picker on Timeline
only (`:185`), Waitlist pinned to today with no date navigation (`:253`), List
starting today and looking forward (`ReservationList.jsx:34`), no duplicate
guest search on Timeline, no KPI cards, no `Status color` / `View settings`, no
manual refresh button.

Plan §2: one `BookingSheet` serves Timeline and List. `ui/Drawer.jsx` already
gives Escape, focus trap, focus return and a dialog name; the phone drawer is
already a full-screen sheet.

Plan §3: the real two-dimensional timeline exists with a sticky label column, a
sticky mobile ruler, current-time marker, zone filter, Earlier/Now/Later, and
out-of-service tables kept as muted rows with `Out of service`.

Plan §5: the waitlist is a real queue — position, live waited time, quoted wait,
overdue mark, add/seat/reorder/remove, seating decided by the server.

Plan §6: public self-service is built on `118` — opaque `public_token`,
server-decided `can_cancel` / `can_reschedule`, reschedule through the same slot
engine, `.ics`, Google Maps / Waze, policy and rules.

Phase 2 foundations exist: guest CRM (`114`/`121`/`131`), merge, anonymize,
tags, `guest_audit`, permission-gated CSV, server-side search and pagination.

## Confirmed gaps

**G1 — no canonical visit read model.** 14 PostgREST round-trips render the desk
once: `locations`×3, `tables`×3, `table_zones`×3, `reservations`×4,
`location_slugs`×1. `ReservationsDesk`, `TimelineDesk` and
`ReservationList`/`WaitlistPanel` each own a load path and each opens its own
realtime channel on `reservations`; one event refires all of them.

**G2 — `TimelineDesk` loads twice on every mount and date change.** `load()`
calls `setMeta(settings)`; `meta.schedule` feeds `baseWindow`; `baseWindow` sits
in `load`'s dependency list; the subscribing effect depends on `load`. The
effect therefore re-runs, `setRaw(null)` flashes the skeleton and the channel is
re-subscribed. This is what turns `reservations`×2 into ×4.

**G3 — the drawer has no returning-guest context.** `guest_history(phone)` and
`guest_reservation_stats(guest_id)` are already granted to `authenticated`
(`121:266`, `121:323`) and the POS already uses them
(`src/features/reservations/api.ts:93`). The back office never calls either, so
an ANGLE host cannot see visits, no-shows, tags or the guest note.

**G4 — no POS order or payment summary.** The back office knows only
`order_id != null` and prints one sentence. `get_online_orders_web` (`141`)
serves online order requests, not POS `orders`; there is no web read path for a
seated visit's order.

**G5 — no visit history, and most of it was never stored.** `activity_events`
(`098`) records only `shift_opened`, `shift_closed`, `refund_issued`. Every
reservation transition overwrites one `decided_at`, so confirmation, rejection,
completion and no-show times are not recoverable. Facts that do exist and can be
shown truthfully today: `created_at` + `created_via`, `rules_ack.accepted_at`,
`confirm_requested_at`, `guest_confirmed_at`, `rescheduled_at` +
`previous_reserved_at` + `reschedule_count`, `arrived_at`, and the last
`decided_at`.

**G6 — no prominent next action.** Actions render as a flat row underneath a
permanently expanded picker listing every table.

**G7 — the waitlist recovery loop is half-wired.** `fetchWaitlistMatches`
(`reservations.js:292`) and `requestConfirmations` (`:313`) exist and are called
by nothing. Cancelling a future reservation surfaces no candidates for the freed
slot.

**G8 — no notification lifecycle visibility.** `notification_outbox` (`122`,
hardened by `147`) carries status, attempts and last error; the back office has
no reference to it at all, and there is no `Delivery not configured` surface.

**G9 — segments are POS-spend filters, not the required set.** Today: Everyone,
Regulars (≥3 visits), Top spenders (₪200), Seen this month, Lapsed (90 days).
`get_backoffice_guests` takes no reservation-derived parameter, returns no
evidence for a label, and has no visit-only fallback for standalone Reserve.

**G10 — no returning-guest recognition in manual booking or walk-in.**
`BookingForm` takes a free-text phone. The server does link the visit to the
canonical guest by trigger (`121`), so no duplicate profile is created, but the
host is never told they are looking at a returning guest.

**G11 — conflict alternatives are computed from loaded rows only.** The refusal
is server-authoritative, but `conflictAlternatives` reasons over the bookings
already on screen, so it can propose a table that is busy outside the loaded
window.

## Where the plan meets a shipped decision

1. **Public page language.** Plan §6 asks for Hebrew RTL plus a supported LTR
   language. `/reserve/*` is deliberately Hebrew-only, and `Lang` supports only
   `ru | he` (`docs/reservations.md`, migration `118`). A third public language
   is separate work, not a line item of this phase.
2. **Phone label column.** Plan §3 asks for a wider sticky column. It measures
   72 px and did not truncate `Table 12`; widening it costs part of the 3.3-hour
   window the same section asks to keep.

## Stop condition

Nothing in Phase 1 or Phase 2 requires a new visit table, a second reservation
backend or a new notification provider. Every gap above extends an existing
path.
