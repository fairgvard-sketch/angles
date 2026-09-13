# Claude handoff: approved ANGLE Orders workspace redesign

## Status and authorization

This document is the approved UX/UI direction for the ANGLE back-office Orders
workspace. It is an implementation plan, not authorization to commit, push,
deploy, apply migrations, change external services, or mutate production
orders.

Read this file completely before editing.

## Approved visual reference

Inspect this image before implementation:

`/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-98c20c28-98c0-4d45-98b5-71f3204dcd8b.png`

The image is a structural and visual reference, not permission to invent
unsupported workflows. Use real ANGLE fields, current capabilities,
permissions, routes, and server transitions.

Also read and reconcile this plan with:

- `docs/claude-angle-platform-backoffice-master-plan.md`
- `docs/claude-backoffice-current-audit-plan-2026-08-02.md`
- `docs/claude-backoffice-improvement-plan.md`
- `docs/claude-product-separation-plan.md`

The existing audit plans own already-verified correctness problems. This file
defines the approved Orders appearance, interaction model, and execution order.

## Working-tree safety

At the time this plan was created, the repository contained active uncommitted
Reservations redesign work, including shared `App.jsx` and `styles.css`
changes. Re-run `git status --short` before doing anything.

Do not begin broad Orders edits while another phase is actively changing shared
shell or design-system files unless the user explicitly asks you to coordinate
the overlap. Never overwrite, revert, stage, or silently absorb unrelated user
changes.

## Product intent

Orders is the universal real-time execution workspace for commerce activity.
It may start with restaurant examples, but its core structure must remain able
to support retail and service businesses later.

Orders must answer:

- what arrived now;
- where it came from;
- what the customer ordered;
- how it will be fulfilled;
- what operational state it is in;
- who owns the next action;
- whether the order is managed in back office or on POS;
- how to find a known historical order quickly.

The page is not a sales analytics dashboard, not a reservation list, and not a
replacement for the POS order-entry screen.

## Orders must not be confused with Reservations

The two modules share the ANGLE shell, components, spacing, drawers, and general
quality, but their working models must remain clearly different.

### Orders semantics

- order/reference number is the primary identifier;
- item composition and quantities are central;
- fulfilment and channel are visible;
- total order value is visible;
- state describes execution: New, Accepted, Preparing, Ready, Completed;
- the drawer contains items, totals, activity, and operational ownership;
- the page prioritizes live work and fulfilment.

### Reservations semantics

- guest and visit time are primary;
- table/resource and duration are central;
- state describes a visit: Pending, Confirmed, Seated, Completed;
- the drawer contains guest, table, time, requirements, and visit actions;
- the page prioritizes planning and resource allocation.

### Required visual distinction

- Orders uses an order/receipt/package icon; Reservations uses a calendar/visit
  icon.
- Orders rows begin with `Order #...`; Reservations rows begin with time/guest.
- Orders never uses a reservation timeline or table-allocation layout.
- Reservations never shows item totals or preparation stages.
- Status text and icons remain visible; color alone is never the identifier.
- Orders drawer heading is `Order #...`, never only the customer name.
- Do not reuse reservation labels such as Confirmed or Seated for order
  workflow states.

## Existing implementation areas to inspect

Primary repository:

`/Users/enotov/Desktop/anglesite`

Relevant source is expected to include:

- `backoffice/src/OrdersInbox.jsx`
- `backoffice/src/orders.js`
- `backoffice/src/App.jsx`
- `backoffice/src/routing.js`
- `backoffice/src/styles.css`
- shared shell, Drawer, table, filter, status and error components introduced by
  current back-office work

Related POS/order ownership may live in:

`/Users/enotov/Desktop/kassa`

Do not change the POS repository merely to make a mock deep link appear to
work. First verify whether a stable, authorized handoff route exists.

## Approved visual direction

- compact Square-like operational density without copying Square;
- warm off-white application background;
- white table/work surfaces;
- near-black/navy text;
- subtle gray borders;
- restrained cobalt selection/focus;
- status colors used semantically;
- 36-40 px desktop controls;
- 8/12/16/24 spacing rhythm;
- minimal shadows;
- no KPI card strip;
- no giant cards or oversized mobile controls on desktop;
- no gradients, glassmorphism, neon, 3D, marketing content, or decorative
  AI-looking elements.

## Target page structure

### 1. Shared ANGLE shell

Keep the grouped, capability-aware platform navigation.

Orders is selected under Work. Do not create an Orders-specific shell.

### 2. Page header

Use one compact row containing:

- title `Orders`;
- location selector;
- date/day selector;
- order search.

Do not add a misleading `New order` button to POS-connected back-office mode.
If standalone Orders genuinely supports creation later, make it capability
aware and server-authorized rather than globally visible.

### 3. Views/tabs

The approved concept shows:

- Active
- All orders
- Scheduled

Do not render a tab that has no real data/query and no supported workflow.
During Phase 0 classify each tab as implemented, partially implemented, or
concept-only.

At minimum:

- Active owns current operational work;
- All orders owns searchable history when supported;
- Scheduled appears only when scheduled orders exist as a real product feature.

Selected tab and filters should be URL-backed where appropriate. Reload and
browser Back/Forward must restore them.

### 4. Live indicator

Use one small `Live` indicator near Active when realtime is healthy.

States must be honest:

- Live;
- Reconnecting;
- Offline/stale;
- Refresh required.

Do not show a green Live dot merely because the component mounted.

### 5. Filter toolbar

Use one compact toolbar:

- channel/source;
- fulfilment;
- status;
- Refresh;
- search if it is not already in the page header.

Filters must have meaningful server/client behavior and should persist in URL
state when useful. Do not add decorative controls that do nothing.

## Orders table

Active orders use a compact professional table, not a gallery of large cards.

Recommended columns:

- Order
- Time
- Customer/context
- Fulfilment
- Channel
- Status
- Items
- Total
- Actions

### Row requirements

- stable human-facing order/reference number;
- time for current restaurant/business day;
- full date plus time for older days;
- customer, table, counter, or walk-in context as appropriate;
- fulfilment such as Table, Takeaway, Counter, Delivery, Pickup;
- source/channel such as POS, QR Menu, Website, standalone online ordering;
- status text and semantic color;
- item count;
- correctly formatted location currency;
- one compact overflow action;
- selected row uses restrained cobalt outline/highlight;
- click/keyboard activation opens the right order drawer;
- table remains visible and preserves scroll/filter state while drawer is open;
- sticky table header;
- loading skeleton matches final row geometry;
- realtime updates do not reorder the row the user is currently interacting
  with unexpectedly.

Do not expose card/payment details or payment-entry controls. Showing an order
total is allowed; implementing payments is outside scope.

## Approved order status system

Orders uses its own execution labels. It may share semantic design tokens with
the platform, but it must not reuse Reservation status names.

Suggested starting colors; adjust for contrast:

| Order state | Treatment | Intent |
|---|---|---|
| New | amber `#F3C85B`, dark text | needs acknowledgement |
| Accepted | restrained cobalt/blue | accepted into workflow |
| Preparing / In progress | deep navy `#0B2345`, white text | active execution |
| Ready | green `#168A4B`, white text | ready for next fulfilment step |
| Completed | light gray, muted dark text | finished/history |
| Cancelled / Rejected | pale red surface, red text/border | stopped/problem |

Rules:

- no gradients;
- always show text;
- icons may reinforce state but never replace text;
- selected outline remains visible for every status;
- do not use green for generic realtime if it would be confused with Ready;
- meet WCAG contrast;
- support reduced/forced color environments where practical.

## Right-side order drawer

Desktop target width: approximately 420-440 px.

Opening an order must not replace the list or navigate to an unrelated page.

Recommended content order:

1. `Order #...` heading;
2. order workflow status;
3. source/channel;
4. fulfilment;
5. placed date/time;
6. customer/table/context and contact details when permitted;
7. line items, quantities, variants/modifiers and notes;
8. subtotal/total using correct currency semantics;
9. order activity/history;
10. ownership/handoff explanation;
11. primary capability-aware action;
12. secondary and overflow actions.

Interaction requirements:

- Escape closes the drawer;
- close button closes it;
- focus returns to the originating order row;
- list scroll, selection and filters are preserved;
- opening a different row updates the existing drawer without a page flash;
- background list remains mounted;
- no refetch occurs only because the drawer opened/closed;
- mobile may use a full-height sheet with clear Back/Close behavior.

## POS-connected versus standalone Orders

Use one component architecture with capability-aware actions.

### POS-connected location

- back office may be read-only for workflow mutations;
- show an honest notice such as `Handled on the register`;
- provide `Open on POS` only if a stable, authorized route exists;
- otherwise provide the location/device/order reference and truthful guidance;
- never render fake Complete/Ready actions that the server will reject.

### Standalone Orders product

- show only server-authorized transitions;
- preserve validated state order;
- rejection/cancellation reason uses an ANGLE dialog, not `window.prompt`;
- errors preserve user input and explain whether state changed;
- Menu/Orders-only customers must not be told that POS is required.

## Older unresolved orders

Old workflow-active orders must not dominate today's work.

Implement:

- current business-day operational orders first;
- `Older unresolved (N)` collapsed by default;
- full date and time for old entries;
- grouping/filtering by age and status when expanded;
- capability-aware guidance for resolution;
- no automatic completion/cancellation of production orders;
- no copy asking the user to perform an unavailable back-office action.

Acceptance intent: a new order must be visible immediately without scrolling
through historical debt, and a known old order must remain findable quickly.

## Realtime, loading and error behavior

Required states:

- initial loading skeleton;
- empty Active state;
- no search/filter results;
- new order arrival;
- reconnecting;
- offline/stale data;
- partial load failure;
- forbidden action;
- POS-owned action;
- successful standalone transition.

Prevent:

- realtime duplicates;
- status regression from out-of-order events;
- row jumping while the user is interacting;
- drawer showing a different order than the selected row;
- stale active rows appearing as newly received;
- silent failures.

## Responsive behavior

### Desktop

- full compact table plus right drawer;
- sticky header;
- high useful density;
- no horizontal page overflow.

### Tablet

- preserve the essential columns: Order, Time, Context, Status, Total;
- lower-priority details move into drawer;
- touch targets are at least 44 by 44 px;
- drawer may overlay part of table and remains easy to close.

### Mobile

- use an intentional compact order list, not a crushed nine-column table;
- each item clearly shows order number, received time, context, total and
  status;
- urgent standalone actions remain reachable;
- details open as a full-height sheet;
- filters use a compact sheet/popover;
- sticky actions never cover order content.

## Implementation phases

### Phase 0: source/production audit

Before editing:

1. Re-run `git status --short` and record active unrelated work.
2. Read repository instructions, relevant source and the plans listed above.
3. Map current Orders queries, statuses, realtime subscriptions, capabilities,
   permissions, POS ownership rules, routes and responsive styles.
4. Compare local HEAD/origin/main and live production behavior/version.
5. Reproduce current issues without modifying real orders:
   - active-order ordering;
   - old unresolved visibility;
   - timestamps for old/current orders;
   - POS-connected read-only messaging;
   - standalone actions if a safe test account exists;
   - realtime reconnect/deduplication;
   - mobile overflow;
   - deep link/reload/Back/Forward behavior.
6. Classify every control/tab in the approved concept as already supported,
   supportable with existing data, or concept-only.
7. Report intended files and overlap with active Reservations/shared-shell work.

Do not edit before presenting Phase 0 results.

### Phase 1: shared tokens and page shell

1. Reuse current shared AppShell, PageHeader, tabs, filters, table and Drawer.
2. Add/consolidate Orders-specific status tokens.
3. Build the compact header/tab/filter structure.
4. Do not duplicate components created by Reservations redesign.
5. Add matching loading/empty/error geometry.

### Phase 2: Active orders table

1. Implement the approved columns using real fields.
2. Add stable ordering and selection.
3. Show correct current-day versus historical date/time.
4. Apply Orders-specific statuses.
5. Preserve realtime updates without duplicates or disruptive row jumps.

### Phase 3: order drawer

1. Implement item, total, context and activity hierarchy.
2. Preserve list state and focus.
3. Add capability-aware POS/standalone ownership messaging.
4. Add only verified actions and handoffs.
5. Verify Escape, close, switching rows and responsive sheet behavior.

### Phase 4: old unresolved and history

1. Collapse old unresolved work by default.
2. Add full date/time and grouping.
3. Preserve discoverability through search/filter.
4. Do not mutate old production orders as cleanup.

### Phase 5: standalone transitions and cancellation UX

Only when existing entitlements/backend support it:

1. expose server-authorized state transitions;
2. replace native prompts with accessible ANGLE dialogs;
3. preserve reason/input on server error;
4. add confirmations only where consequences require them;
5. test authorization at server/RPC/RLS level, not only button visibility.

### Phase 6: All orders and Scheduled

1. Implement All orders only with a real query, search and pagination strategy.
2. Implement Scheduled only when supported by real data and business rules.
3. Otherwise omit unsupported tabs rather than ship placeholders.
4. Keep URL state and shared drawer consistent across views.

### Phase 7: responsive, accessibility and resilience

1. Test desktop, tablet and mobile.
2. Verify keyboard selection, focus restoration and accessible status names.
3. Respect reduced motion.
4. Verify offline/reconnect/stale states.
5. Prevent layout shifts and full-page flashing.

### Phase 8: tests and live acceptance

Add/update focused tests for:

- status mapping and labels;
- current-day versus old date formatting;
- stable order/reference number;
- sorting and filters;
- older-unresolved collapse/search;
- realtime deduplication and out-of-order events;
- drawer open/close/Escape/focus/state preservation;
- POS-connected versus standalone action visibility;
- forbidden server transitions;
- cancellation dialog dismissal/submission/error preservation;
- empty/loading/offline/reconnecting states;
- URL-backed tab/filter state;
- desktop/tablet/mobile overflow.

Run focused tests, full configured test suite, lint/typecheck when configured,
production build, and a live read-only or test-data-backed browser smoke.

## Acceptance criteria

The redesign is accepted only when:

- Orders is visually and semantically distinct from Reservations;
- the approved compact table replaces oversized cards for desktop live work;
- a new active order is visible without historical scrolling;
- old unresolved orders are collapsed but findable;
- old orders always show full date plus time;
- status labels/colors are Orders-specific and accessible;
- order number, context, channel, fulfilment, items and total are clear;
- selecting a row opens the right order drawer;
- Escape closes it and restores row focus;
- list scroll/filter/selection remain stable;
- the drawer shows correct items, modifiers, totals and activity;
- POS-connected mode never shows fake back-office workflow actions;
- `Open on POS` exists only when the route is validated;
- standalone mode exposes only authorized server transitions;
- no payment setup or card-entry UI is added;
- realtime does not duplicate or unpredictably reorder rows;
- no route-change flash, white screen or horizontal page overflow appears;
- Back/Forward/reload restore intended route state;
- tests and production build pass;
- no new console errors appear.

## Working protocol for Claude

Do not implement this as one large diff.

For every phase:

1. state the user problem and intended files;
2. identify overlap with active uncommitted work;
3. show a focused diff;
4. run relevant tests and production build;
5. report manual checks and remaining risk;
6. stop for user review;
7. do not commit, push, deploy, apply migrations, or change external services
   without explicit authorization.
