# Claude implementation brief — Dashboard redesign

Read this document completely before changing code. Then inspect the current
implementation and execute the work phase by phase.

## Exact prompt for Claude

> Read `docs/claude-dashboard-redesign-plan.md` completely and follow it as the
> source of truth. Redesign the ANGLE back-office Dashboard so it answers "how is
> today going and what needs a decision" on the first screen, in the same visual
> language as the already-redesigned Orders, Catalogue, Customers, Sales, Activity
> and Team sections. Preserve every existing data contract, capability rule,
> partial-failure behaviour and truthful-reporting rule. Do not invent metrics,
> forecasts, goals, drafts or backend work. First inspect the current code and
> tests, protect unrelated dirty files, and establish a passing baseline. Implement
> phase by phase, verify desktop/tablet/mobile and accessibility, then run the full
> test suite and the production build. Do not commit, push or deploy unless I
> explicitly ask after reviewing the result. At the end, report changed files,
> tests run, remaining risks and the manual acceptance steps.

## Objective

The Dashboard is the last screen still written in the pre-redesign language. Every
other section now uses a working-line header, dense rows and panels without prose.
The Dashboard is a stack of eight panels, opens on a usually-empty "Needs
attention" panel, repeats the whole sidebar as "Quick access", carries an
activation card that belongs to the account, and shows today's revenue as a bare
number with no sense of how the day is going.

After this work the Dashboard answers, in this order:

1. how today is going (money or volume, depending on what the account owns);
2. what needs a decision right now;
3. where the live work stands — orders, bookings, registers, guest channels;
4. what just happened.

It is not a report (that is Sales), not a work desk (that is Orders and
Reservations), not a launcher for navigation, and not an account/billing screen.

## Approved direction

There is no reference image for this section. The visual direction is the one
already shipped in Orders, Catalogue, Customers, Sales, Activity and Team:

- one working line for the section header, actions on the right;
- data lines carry data, never a description of the section;
- panels have a title and, if needed, one text action — no explanatory sentence
  under the heading;
- dense rows, tabular numerals for numbers, 8pt spacing;
- state is always named in text, never by colour alone.

Target composition, top to bottom:

```
Dashboard                                                    [ ⟳ ]
Sunday, 2 August · updated 14:32

⚠  2 orders are waiting for an answer                 [ Open orders ]
⚠  Стойка 2 is not reporting                         [ Open devices ]
   (nothing pending → one quiet line, not a panel)

┌ Today ──────────────────────────────────────────────────────────┐
│ Net sales                                                       │
│ ₪ 4 820.00                                                      │
│ ▁▂▃▅▇█▇▅▃▂  ← sales by hour, current hour last                  │
│ Sales by hour · ↑ 12% vs yesterday by 14:00                     │
│ ───────────────────────────────────────────────────────────     │
│ 38 orders · avg ₪ 127.00 · shift open since 07:12               │
└─────────────────────────────────────────────────────────────────┘

┌ Orders                    Open → ┐ ┌ Reservations         Open → ┐
│ Waiting for an answer         2  │ │ 19:30  Dana         4 guests│
│ In progress                   5  │ │ 20:00  Yossi        2 guests│
│ Ready for pickup              1  │ │ 20:30  Miriam       6 guests│
│ Longest wait                12m  │ │ 12 bookings · 34 guests     │
└──────────────────────────────────┘ └─────────────────────────────┘
┌ Devices                   Open → ┐ ┌ Online channels      Open → ┐
│ On line                  3 of 4  │ │ Online ordering          On │
│ Стойка 2   Offline · 2h ago      │ │ Table booking            On │
└──────────────────────────────────┘ │ Guest page    Open as guest │
                                     └─────────────────────────────┘

┌ Recent activity                                        View all → ┐
│ … six journal rows …                                              │
└───────────────────────────────────────────────────────────────────┘
```

## Functional source of truth

Read before editing:

- `backoffice/src/HomeDashboard.jsx`
- `backoffice/src/dashboard.js`, `backoffice/src/dashboard.test.js`
- `Overview`, `QUICK_ACTIONS`, `ProductsCard`, `ActivationHome`,
  `AccountSettingsPage` in `backoffice/src/App.jsx`
- `backoffice/src/sales.js` (`fetchSalesReport`, `hourBars`, `formatMoney`,
  `chartScale`, `barShare`)
- `backoffice/src/orders-inbox.js` (`bucketOrders`, `dayStartMs`, `elapsedLabel`)
- `backoffice/src/devices.js` (`fetchFleet`, `deviceStatus`, `deviceAdvice`,
  `lastSeenLabel`, `STATUS_LABEL`, `isArchived`)
- `backoffice/src/ActivityManager.jsx` (`ActivityCard`)
- `backoffice/src/navigation.js` + `navigation.test.js` (capabilities, `scoped`)
- `backoffice/src/ui/Layout.jsx`, `ui/Button.jsx`, `ui/AppShell.jsx`
- Dashboard and Overview styles in `backoffice/src/styles.css`
- `backoffice/test/browser.test.mjs`, block `describe('dashboard')` and its
  Supabase fixture
- migration `089_sales_report_backoffice.sql` in the kassa repository, for what
  `summary` and `by_hour` actually contain

## Non-negotiable product rules

1. No new RPC, migration, schema change or schema-version bump. This is a
   presentation change over contracts that already exist.
2. Show only what the server returns. No forecasts, targets, budgets, profit,
   costs, unpublished-draft counters, "trending" labels or demo data.
3. Every widget stays capability-gated exactly as today. A Reserve-only account
   must not see revenue, registers or orders; a Menu-only account must not see a
   register-shaped screen.
4. Partial failure remains a product state, not an error screen: `allSettled`
   stays, failed widgets stay empty and honest (`—`), the rest keep working and
   the page keeps naming the failure.
5. A failed metric never renders as zero.
6. Money stays integer agorot until `formatMoney`. No float arithmetic.
7. Growth from zero is "was none", never an infinite percentage — same rule as
   Sales.
8. A percentage must compare the same measure over comparable time. Comparing a
   partial today with a complete yesterday is forbidden.
9. `Needs attention` keeps its ordering rule — by cost of waiting — and every item
   keeps leading to a concrete screen. An empty list stays a valid answer; never
   invent an item to fill the block.
10. Hiding a widget is not authorization. Server rules are unchanged.
11. Do not change how orders, bookings, devices, shifts or channels are computed.
    `ordersSummary`, `reservationsSummary`, `fleetSummary` and `attentionItems`
    keep their current semantics; new logic arrives as new pure helpers.
12. Test bookings stay excluded from every count.
13. Do not redesign Orders, Reservations, Sales, Activity, Devices or Team as part
    of this task. Do not touch the POS repository.
14. Do not touch unrelated dirty files in the working tree.
15. Do not commit, push or deploy until the user asks after reviewing the result.

## The work

### Phase 0 — baseline

- Record the current `git status`; leave every unrelated dirty file untouched.
- Run `npm test` and `npm run build` and record that they pass before any edit.
- List every place that renders Dashboard-only classes (`dashboard-*`, `metric*`,
  `attention-*`, `quick-*`, `overview-grid`) and confirm no other section uses
  them. Shared classes (`panel`, `data-row`, `data-list`, `status`) stay shared and
  must not be redefined.
- New Dashboard-only CSS uses the `dash-` prefix, following the precedent of
  `ord-`, `cat-`, `cus-`, `act-`. Dead `quick-*`, `metric*` and `dashboard-*` rules
  are deleted, not left behind.

### Phase 1 — "Today"

Replace the four metric cards with one hero card.

For an account with `pos_reports`:

- headline: **Net sales**, value `summary.gross_sales - summary.refunds`,
  formatted with `formatMoney`, tabular numerals, the largest type on the page;
- an hourly curve built from `by_hour` of the report already loaded for today;
- one quiet strip under the divider: orders count, average check, shift state
  (`open since 07:12` / `closed`). These are the numbers the four cards carried;
  they stop competing with the headline.

The curve:

- add a pure helper (e.g. `todayBars(report, nowMs, tz)`) in `dashboard.js`; do not
  change `hourBars` or anything else in `sales.js`;
- the axis runs from the first hour with data to the current hour inclusive, so
  quiet hours read as real zeros and the day does not appear to end at the last
  sale;
- if there is no data yet, render an empty state, not a flat fake axis;
- the curve is decorative-free: no gradients, no animation on refresh; respect
  `prefers-reduced-motion`;
- it is not interactive. Sales owns the explorable chart. Give the block an
  accessible summary instead (see accessibility below).

The comparison:

- fetch yesterday's report with the same `sales_report` call, same locations, same
  timezone, `from = yesterday 00:00`, `to = today 00:00`;
- compare **cumulative `by_hour.amount` up to and including the current hour** on
  both days. This is paid sales by hour — the same measure the Sales chart draws,
  and the only one available per hour;
- label it exactly as what it is: `Sales by hour · ↑ 12% vs yesterday by 14:00`.
  Do not attach the percentage to the net-sales headline: `by_hour` does not carry
  refunds, and a percentage printed next to a net number claims to describe it;
- yesterday cannot change during the session: fetch it once per day, reuse it on
  the silent 60-second refresh, refetch on manual refresh or when the day rolls
  over;
- yesterday failing must not take down the hero. No comparison line is better than
  a wrong one;
- zero yesterday → `was none`; zero today with sales yesterday → show the real
  drop, do not hide it.

For an account without `pos_reports`, the hero degrades honestly and never shows
money:

- `orders_desk` → headline is today's active orders, strip is waiting / in
  progress / ready / longest wait, no curve;
- otherwise `reservations_desk` → headline is today's bookings, strip is guests
  expected and the next arrival, no curve;
- otherwise (Menu-only) → no hero at all. The page starts with the channels panel.
  Do not render an empty card.

### Phase 2 — Needs attention

- The block sits directly under the working line, in a fixed position, so the
  owner always knows where to look.
- Non-empty: rows only — tone icon, title, detail, action button. No panel
  heading, no description sentence.
- Empty: one quiet line ("Nothing needs a decision right now"), one row tall.
  The panel with a heading and a description disappears.
- Add exactly one new item to `attentionItems`: a product activation is pending
  (`productState(context, id) === 'pending'`), tone `info`, action → the account
  screen. This replaces the signal that the removed products card carried. It is
  computed from context that is already loaded — no new request.
- Everything else in `attentionItems` keeps its current rules, wording and order.

### Phase 3 — the live grid

- Two equal columns on desktop (`repeat(2, minmax(0, 1fr))`), one column on narrow
  screens at the existing breakpoint. The current 1.55fr/0.85fr split is dropped:
  it made the right column a leftover strip.
- Panels: Orders, Reservations, Devices, Online channels — same widgets, same data,
  same capability gates, same "Open" text action.
- Every panel loses its description sentence. The title plus the rows already say
  what the panel is.
- Reservations keeps the next three arrivals and gains one summary row (`12
  bookings · 34 guests`), which the removed "Bookings today" card used to carry.
- Devices and shifts stay organisation-wide — a silent register at another location
  is still the owner's problem. When the organisation has more than one location,
  device rows name their location (`location_name` is already returned by
  `get_backoffice_fleet`). With a single location, no such suffix appears.
- `Recent activity` stays as it is today, full width, below the grid, POS-only.

### Phase 4 — remove what belongs elsewhere

- Delete `Quick access` (`QUICK_ACTIONS`, `.quick-panel`, `.quick-list`). Every
  entry is one click away in the sidebar; a launcher that duplicates navigation is
  the largest block of dead space on the screen.
- Move `ProductsCard` off the Dashboard into `AccountSettingsPage` (view
  `settings`, reachable from the account menu), which today shows only an email and
  a sign-out button. `ActivationHome` keeps rendering the same card unchanged —
  an organisation without an active product still lands on it.
- Keep the pending-activation signal on the Dashboard as the attention row from
  Phase 2, so removing the card removes no information.
- After this, `Overview` in `App.jsx` renders `HomeDashboard` with the activity
  card as its only child.

### Phase 5 — honest scope

- Mark `overview` as `scoped: true` in `navigation.js`. The Dashboard reads one
  location's sales, orders, bookings and channels, and today it has no way to say
  which one or to switch it: for a chain, the first location silently wins.
  `scoped` gives it the shared location control in the top bar — a static chip for
  a single-location organisation, a picker for a chain.
- The day line drops `· Location name`: the location now lives in the top bar with
  every other section's. It gains the last successful refresh time, which is data
  the owner actually uses (`updated 14:32`).
- Update `navigation.test.js` for the new `scoped` value.
- Organisation-wide widgets (devices, shift attention) keep naming their location
  in the row, per Phase 3, so no number is attributed to the wrong scope.

### Phase 6 — responsive, accessibility, resilience

- Desktop, tablet and phone: no horizontal overflow, nothing touching a card edge,
  minimum 44 px touch targets for every action.
- The hero is a labelled region. The curve carries a text alternative that states
  the same facts (`Sales by hour, 08:00 to 14:00, highest 12:00, ₪ …`), because a
  bar row is invisible to a screen reader.
- Every state stays named in text: `Offline`, `On`, `Off`, `was none`. Colour never
  carries meaning alone.
- Loading keeps its current behaviour: a real first load shows a loading state, the
  silent 60-second refresh never blanks a visible number.
- RTL: use logical properties (`start/end`, `ms/me`), no `ml/mr`. The curve must
  mirror correctly.
- Respect `prefers-reduced-motion`.

### Phase 7 — verification

- New unit tests in `dashboard.test.js` for every new pure helper: the hourly axis
  (including the no-data case), the cumulative comparison, the zero baselines in
  both directions, the pending-activation attention item, and the hero fallback
  choice per capability set.
- Update `backoffice/test/browser.test.mjs`: the dashboard block currently asserts
  `.dashboard-metrics`, the four `.metric-label` strings and the attention panel.
  Rewrite those assertions against the new structure and keep what they were
  really protecting — capability gating, attention ordering, navigation from an
  attention row, and partial failure leaving the other widgets alive. Add the
  yesterday call to the fixture.
- `npm test` and `npm run build` must pass.
- Report changed files, tests run, remaining risks and manual acceptance steps.

## Acceptance checklist (manual, on real data)

1. POS owner, mid-day: the first screen shows net sales, the day's curve, the
   comparison, and any pending decisions — without scrolling.
2. A day with no sales yet: no fake axis, no `0%`, no broken layout.
3. Yesterday's request blocked: the hero still renders, the comparison line is
   simply absent.
4. Sales request blocked: `—` in the hero, the failure is named, orders, bookings,
   devices and channels still work.
5. Chain account: the top bar switches location; sales, orders, bookings and
   channels follow it; devices and shift warnings stay organisation-wide and name
   their location.
6. Reserve-only account: no money, no registers, no orders anywhere on the page.
7. Menu-only account: no hero, no empty cards, nothing implying a register.
8. Organisation with a pending product request: the attention row leads to the
   account screen, and the products card is there.
9. Phone width: one column, nothing clipped, every button reachable with a thumb.
10. RTL: mirrored correctly, including the curve.

## Known risks

- `by_hour` is paid sales, not net. The comparison is deliberately labelled as
  "sales by hour" for this reason; anyone later re-labelling it as net revenue
  turns a true number into a false one.
- The extra `sales_report` call doubles the Dashboard's report load on the first
  render of a day. It is cached for the rest of the day and skipped on silent
  refreshes.
- Moving the products card changes where an owner used to request activation. The
  attention row and the account screen must both be verified before release.
