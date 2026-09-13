# Claude implementation brief — Activity redesign

Read this document completely before editing code. Then inspect the current implementation and execute the work phase by phase.

## Objective

Redesign the ANGLE backoffice `Activity` section according to the approved visual reference while preserving its current purpose and behavior.

Activity is a read-only register journal. It currently contains exactly three event types:

1. shifts opened;
2. shifts closed;
3. refunds issued.

It is not a general audit log, analytics dashboard, order history, device-monitoring page, or staff-management page.

## Approved reference

- `docs/design-references/activity-approved.png`

Use this image for hierarchy, density, date grouping, toolbar arrangement, row anatomy, icon treatment, whitespace and responsive intent.

The reference is not permission to invent new event types or backend behavior. If the image conflicts with existing data or permissions, preserve the working behavior and adapt the presentation.

## Functional source of truth

Read before changing anything:

- `backoffice/src/ActivityManager.jsx`
- `backoffice/src/activity.js`
- the Activity helpers in `backoffice/src/reporting.js`
- Activity-related rules in `backoffice/src/navigation.js`
- relevant Activity styles in `backoffice/src/styles.css`
- `backoffice/src/reporting.test.js`
- `backoffice/src/navigation.test.js`
- any other tests found by searching for `Activity`, `ACTIVITY_TYPES`, `activityParams`, `activityToCsv` and `get_activity_feed`

Keep `get_activity_feed` and the current server-side filtering contract as the source of data.

## Non-negotiable rules

1. Preserve the three existing event types only: `shift_opened`, `shift_closed`, `refund_issued`.
2. Do not add catalogue edits, logins, permission changes, reservation changes, device errors, online-order events, or generic audit entries.
3. Keep every filter server-side. Never filter only the currently loaded 50 rows.
4. Preserve the 300 ms debounced search.
5. Preserve keyset pagination through `before`; do not replace it with offset pagination.
6. Preserve `PAGE = 50`, unless an existing test or measured reason requires a different value.
7. Preserve CSV export and its UTF-8 BOM behavior.
8. CSV continues to export exactly the currently loaded/visible result set, not hidden server rows.
9. Preserve loading, empty, filtered-empty and error states.
10. Preserve the location selector rule: show it only when the account has more than one location.
11. Preserve role/capability visibility and RLS/RPC authorization. Navigation hiding is not authorization.
12. Do not create migrations, RPCs, schema-version changes or backend triggers.
13. Do not add destructive actions, editing, row menus, checkboxes or an event-detail drawer.
14. Do not redesign Dashboard’s compact `Recent activity` card beyond any small shared row-style adjustment that is necessary and safe.
15. Do not touch unrelated dirty files.
16. Do not commit, push or deploy until the user explicitly asks after reviewing the result.

## Current behavior that must remain

### Data loading

- Initial request through `fetchActivity` and `get_activity_feed`.
- Reset loading when filters change.
- Append loading for `Load more`.
- `done` becomes true when the server returns fewer than 50 rows.
- Refresh replaces the current list using the active filters.
- API errors remain visible through a proper alert state.

### Search and filters

- Search by staff, reason or device.
- Range options:
  - `All time`
  - `Today`
  - `7 days`
  - `This month`
- Optional multi-location selector.
- Multi-select event-type chips:
  - `All events`
  - `Shifts opened`
  - `Shifts closed`
  - `Refunds`
- Selecting `All events` clears the type selection.
- Type filters, range, location and search are sent to the server.

### Event information

Preserve the existing meaning and formatting helpers:

- actor/staff name;
- event title;
- location name;
- device/register name;
- opening float;
- closing total;
- order count;
- cash difference;
- refund amount;
- payment method;
- refund reason;
- event timestamp;
- tone metadata for open, close and refund events.

Use `formatMoney` and existing payment-method labels. Do not reproduce currency formatting manually in JSX.

### CSV

Keep:

- timezone heading;
- event, staff, location and device columns;
- amount and details;
- safe CSV cell escaping;
- current filename convention;
- object URL creation and cleanup;
- disabled export button when no loaded rows exist.

## Target information architecture

### Header

- Page title: `Activity`.
- Description: `Shifts opened and closed, and refunds issued on your registers.`
- No location selector in the global page header because Activity is cross-location.
- Right actions:
  - compact secondary `Export CSV`;
  - icon-only refresh with accessible name and loading/disabled state.
- Do not add a primary create action.

### Filter toolbar

One compact toolbar below the header:

1. search field, widest control;
2. time-range selector;
3. location selector only for multiple locations;
4. quiet loaded-event count aligned to the end when space allows.

The count describes loaded rows, not the total matching population, because the RPC does not currently return a total. Do not label it `total events`.

Keep event-type chips in a separate compact row immediately below the toolbar. They remain multi-select controls with `aria-pressed`.

### Journal panel

Use one bordered journal panel. Do not create KPI cards or charts.

Group loaded events by local calendar date for readability:

- `Today · 4 August`
- `Yesterday · 3 August`
- older headings use a clear localized date.

Date grouping is presentation only. It must not alter sorting, filtering or pagination.

Each event row contains:

- small tone-coded icon marker;
- strong event title;
- muted metadata line with location, device and event detail;
- amount/float when applicable;
- exact local time aligned right.

Keep rows compact, approximately 68–76 px on desktop. Use thin separators and no large shadows.

### Event tones

- shift opened: restrained positive green;
- shift closed: neutral ink/gray;
- refund: restrained red;

Color must reinforce, not replace, the icon and text label.

### Pagination

- Keep one compact `Load more` button after the journal.
- Show loading text/state during append loading.
- Do not render the button after `done` becomes true.
- Never reorder or duplicate rows at a date boundary when appending.

## Date and time rules

1. Extract a pure helper for grouping loaded events by local date if necessary.
2. Use the existing account/location timezone convention already used by Activity CSV.
3. Do not group by the browser’s arbitrary timezone when the backoffice context provides the business timezone.
4. Preserve descending server order inside and across date groups.
5. Use exact local time in the full Activity screen, as shown in the approved reference.
6. The compact Dashboard card may keep relative `3m`, `2h`, `4d` time unless intentionally generalized without regression.
7. Handle invalid timestamps defensively without crashing the whole section.

## Responsive behavior

### Desktop

- Search, range, optional location and loaded count share one row.
- Event title/metadata receive most of the width.
- Amount and timestamp align consistently on the right.

### Tablet

- Toolbar may wrap into two clean rows.
- Type chips remain one horizontally scrollable row rather than tall wrapping pills.
- Journal remains a single list.

### Mobile

- No horizontal page overflow at 390 px.
- Search takes the full row.
- Range and location controls use available width below it.
- Export remains discoverable without becoming a full-width dominant button.
- Event metadata wraps safely.
- Amount and time remain readable and never overlap titles.
- Date headers remain sticky only if it can be done without obscuring content; sticky headers are not required.

## Visual rules

- Follow the approved ANGLE/Square-inspired system.
- Use existing design tokens and primitives.
- White canvas and surfaces, cool-gray hairline borders, dark navy/ink text, restrained blue focus states.
- Compact 40 px toolbar controls.
- Consistent Lucide outline icons already used by the project.
- No gradients, glassmorphism, decorative art, floating shapes, giant buttons, oversized empty cards or strong drop shadows.
- No hard-coded mock values in production rendering.
- Avoid inline styles when a reusable CSS class is appropriate.
- Honor `prefers-reduced-motion`.

## Accessibility requirements

- Keep a programmatic label for search, even if visually hidden.
- Range and location selects retain labels.
- Event-type chips retain `aria-pressed` and a group label.
- Refresh has an explicit accessible name.
- Decorative row icons are hidden from assistive technology.
- Error state uses `role="alert"`.
- Loading updates use a suitable status/live region without announcing every rendered row.
- Keyboard focus is visible for every control.
- Color contrast meets WCAG AA.
- Reading order follows visual order.
- Journal markup should be list-like and semantically coherent; do not use an interactive table if rows have no interaction.

## Implementation phases

### Phase 0 — baseline

1. Read all source and tests listed above.
2. Record `git status` and protect unrelated user changes.
3. Run focused Activity/reporting tests.
4. Capture the current Activity page at desktop and mobile widths if the local app is available.
5. Confirm current RPC parameters and row shape before modifying presentation helpers.

### Phase 1 — pure presentation helpers

1. Add a pure timezone-aware date-grouping helper if needed.
2. Add a pure exact-time/date-label helper if the current helpers do not cover the design.
3. Test Today, Yesterday, older dates, timezone boundaries, invalid dates and preserved ordering.
4. Do not alter RPC inputs or output shape.

### Phase 2 — header and filters

1. Implement the compact header actions.
2. Align search, range, conditional location and loaded count.
3. Restyle the multi-select event chips.
4. Preserve debounce, server reload and disabled/loading states.

### Phase 3 — journal feed

1. Group loaded rows by date.
2. Implement the approved row anatomy and tones.
3. Keep existing titles, amounts and details generated by the current helpers.
4. Preserve empty/error/loading behavior.
5. Preserve keyset `Load more` behavior without duplicates.

### Phase 4 — responsive and accessibility pass

1. Verify 390 px, 768 px, 1024 px and wide desktop.
2. Verify keyboard focus and chip selection.
3. Verify long staff, location, device and refund-reason strings.
4. Verify reduced motion and high zoom.
5. Confirm Dashboard’s compact Activity card still works.

### Phase 5 — verification

Run at minimum:

```bash
npm test
npm run build
```

Also run the narrowest Activity/reporting tests during development.

Review the final diff for:

- invented event types;
- client-only filtering;
- changed RPC arguments;
- broken CSV behavior;
- lost empty/error/loading states;
- unrelated formatting churn.

## Acceptance checklist

### Data and filters

- [ ] Only the three real event types appear.
- [ ] Search still waits for the debounce and filters on the server.
- [ ] All four date ranges work.
- [ ] Location appears only for multi-location accounts.
- [ ] Event-type selection remains multi-select.
- [ ] `All events` clears type filters.
- [ ] Refresh preserves active filters.

### Feed

- [ ] Events are grouped by correct business-local date.
- [ ] Today, Yesterday and older labels are correct.
- [ ] Server ordering is preserved.
- [ ] Appending a page does not duplicate or reorder events.
- [ ] Staff, location, device, details, amounts and timestamps remain visible.
- [ ] Shift-open, shift-close and refund tones are distinguishable without relying only on color.
- [ ] Empty, filtered-empty, loading and error states are honest.

### Export and pagination

- [ ] CSV exports exactly the loaded filtered rows.
- [ ] CSV remains UTF-8 compatible and correctly escaped.
- [ ] Export is disabled with zero loaded events.
- [ ] `Load more` uses the last loaded timestamp as the keyset cursor.
- [ ] `Load more` disappears when there are no further rows.

### Responsive and accessibility

- [ ] No horizontal overflow at 390 px.
- [ ] Filters do not collide at tablet widths.
- [ ] Long event content wraps without overlapping amount/time.
- [ ] Search, selects, chips, export, refresh and load-more are keyboard accessible.
- [ ] Focus styles and accessible labels are present.
- [ ] Contrast meets WCAG AA.

## Stop conditions

Stop and report before continuing if:

- a migration, RPC or backend change appears necessary;
- the server does not provide enough timezone information to group dates safely;
- the approved layout requires inventing event fields not present in the RPC response;
- unrelated dirty files overlap the necessary edits.

## Required handoff

After implementation, report:

1. changed files;
2. any pure helpers introduced;
3. how timezone-aware grouping works;
4. confirmation that server-side filtering and keyset pagination remain intact;
5. focused and full test/build commands with exact results;
6. manual desktop/tablet/mobile checks;
7. any intentional difference from the approved reference and why.

Do not commit, push or deploy until the user explicitly requests it.
