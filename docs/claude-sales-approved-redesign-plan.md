# Claude implementation brief — Sales redesign

Read this document completely before changing code. Then inspect the current implementation and execute the work phase by phase.

## Exact prompt for Claude

> Read `docs/claude-sales-approved-redesign-plan.md` completely and follow it as the source of truth. Redesign the ANGLE backoffice Sales page to match `docs/design-references/sales-concept.png`, while preserving the existing `sales_report` contract, period calculations, comparison logic, location scope, CSV export and every real breakdown. Do not invent tabs, KPIs, forecasting, backend work or hard-coded demo data. First inspect the current code and tests, protect unrelated dirty files, and establish a passing baseline. Implement the work phase by phase, verify desktop/tablet/mobile and accessibility, then run focused tests, the full test suite and the production build. Do not commit, push, deploy or create migrations unless I explicitly ask after reviewing the result. At the end, report changed files, tests run, remaining risks and the manual acceptance steps.

## Objective

Redesign the ANGLE backoffice `Sales` section according to the approved visual direction while preserving the current reporting truth and behavior.

Sales is an operational revenue report. It should answer, in this order:

1. how much net sales the business made for the selected scope;
2. how that compares with the equivalent previous period;
3. when the sales happened;
4. what produced the sales and how customers paid.

It is not the general Dashboard, a forecasting tool, a goals screen, an accounting ledger or a payment-provider setup page.

## Approved reference

- `docs/design-references/sales-concept.png`

Use the image for hierarchy, density, toolbar arrangement, chart composition, summary strip, table treatment, whitespace and responsive intent.

The numbers in the image are sample data only. Never hard-code them. If the reference conflicts with the current server contract, permissions or truthful reporting rules, preserve the working behavior and adapt the presentation.

## Functional source of truth

Read before editing:

- `backoffice/src/SalesOverview.jsx`
- `backoffice/src/sales.js`
- Sales helpers in `backoffice/src/reporting.js`
- relevant Sales and shared styles in `backoffice/src/styles.css`
- `backoffice/src/reporting.test.js`
- Sales visibility and route handling in `backoffice/src/App.jsx` and navigation helpers/tests
- shared layout and button primitives used by the page
- the implementation and migration history of the `sales_report` RPC, found by repository search

Search for every usage of:

- `sales_report`
- `fetchSalesReport`
- `periodRange`
- `previousRange`
- `chartMode`
- `barsFor`
- `scopeLine`
- `salesToCsv`
- `salesFileName`

The `sales_report` response and existing pure helpers remain the reporting source of truth.

## Non-negotiable product rules

1. Do not change the `sales_report` RPC, database schema, migrations or schema version.
2. Do not change how gross sales, discounts, refunds, VAT, net sales, order count or average check are calculated.
3. Net sales remains `gross_sales - refunds`, matching the current implementation and export.
4. Preserve the current comparison against an equivalent previous period. Calendar month compares with previous calendar month; calendar year with previous calendar year; other ranges use an immediately preceding window of equal length.
5. Preserve the exact zero-baseline rule: growth from zero is `was none`, never an infinite percentage.
6. Preserve all periods: `Today`, `7 days`, `Month`, `Year`, `Dates`.
7. Preserve calendar-month and calendar-year semantics. Do not silently convert them into rolling 30/365-day ranges.
8. Preserve inclusive user-selected custom dates and the internal exclusive `to` boundary.
9. Preserve automatic refresh every 60 seconds for `Today`. Other periods must not gain unnecessary polling.
10. Preserve manual refresh and its disabled/loading behavior.
11. Preserve multi-location reporting and server-returned scope. Never imply a location scope that differs from `report.scope`.
12. Preserve every real breakdown: payment methods, top items, channels, order types, locations, staff and categories.
13. Empty breakdowns remain hidden. Do not fabricate rows or zero-value categories.
14. Preserve CSV export, UTF-8 BOM, current filename rules and all current sections.
15. Currency remains integer agorot until formatting. Do not perform money calculations with display floats.
16. Keep current authorization/RLS behavior. Hiding navigation is not authorization.
17. Do not add forecasts, targets, budgets, profit, costs, tips, customer acquisition, inventory, payouts or payment-processor health.
18. Do not add Sales sub-tabs. The page remains one scrollable report.
19. Do not add drill-down pages or clickable rows unless they are backed by an existing real route and data contract.
20. Do not redesign Dashboard, Orders, Activity or accounting export as part of this task.
21. Do not touch unrelated dirty files.
22. Do not commit, push or deploy until the user explicitly asks after reviewing the implementation.

## Existing behavior that must remain

### Periods and date logic

- `Today`: local current day.
- `7 days`: current day plus previous six days.
- `Month`: current calendar month.
- `Year`: current calendar year.
- `Dates`: user-supplied inclusive start and end dates.
- Custom range remains inactive until both dates exist.
- Start/end constraints prevent an inverted range.
- Chart aggregation remains:
  - hour for Today;
  - day for seven-day, month and shorter custom ranges;
  - month for year and long custom ranges.
- Missing hours, days and months remain represented as zero slots so the chart axis does not lie.

### Data loading and comparison

- Current and previous reports are loaded through the same server function and in parallel.
- A normal load shows a loading state.
- Today’s silent refresh does not destroy the visible report.
- Load failures remain visible and do not masquerade as zero sales.
- `updatedAt` changes only after a successful refresh.

### Scope and locations

- The server-returned scope names period, locations, timezone and currency.
- `All locations` is represented by an empty `locationIds` request, as today.
- Multi-location selection must remain capable of selecting more than one location.
- If the redesign replaces the current chips with a compact picker, it must be a real multi-select picker with:
  - `All locations`;
  - individual location checkboxes/options;
  - a truthful compact summary;
  - clear Apply/Close behavior if changes are staged.
- For a one-location account, do not show a redundant interactive selector. The scope line still names the location. The single `Bulochka` selector in the reference is illustrative, not a reason to invent a useless control.

### Summary and adjustments

Preserve:

- net sales;
- gross sales;
- order count;
- average check;
- discounts when non-zero;
- refunds and refund count when non-zero;
- comparison values and labels for current versus previous period.

Do not present discounts or refunds as positive revenue. Do not use green for a negative adjustment.

### Chart

Preserve:

- hourly, daily and monthly modes;
- continuous axis including empty intervals;
- readable amount and count for the selected/peak interval;
- interactive bar selection;
- horizontally scrollable minimum bar width when many intervals cannot fit;
- ResizeObserver cleanup;
- accessible label for each bar;
- empty state when there are no sales.

The visual reference uses a bar chart because that matches the existing implementation. Do not replace it with a decorative line/area chart.

### Breakdowns

Preserve the current labels and formatters:

- payment methods through `methodLabel`;
- channels through `channelLabel`;
- order types through `orderTypeLabel`;
- top items;
- locations for multi-location accounts;
- staff;
- categories.

Counts remain `count` or `qty` according to the server row. Amounts remain right-aligned and use `formatMoney`.

### CSV

Preserve:

- export of the currently loaded report and scope;
- report, period, timezone, currency and location headings;
- gross sales, discounts, refunds, net sales, VAT and average check;
- all non-empty breakdown sections;
- CSV cell escaping;
- CRLF rows;
- UTF-8 BOM for Hebrew values in Excel;
- current filename convention;
- object URL creation, click, cleanup and revocation;
- disabled export until a report exists.

## Target information architecture

### Header

- Title: `Sales`.
- Description: `Revenue and order performance across your locations.`
- Right actions:
  - compact secondary `Export CSV`;
  - icon-only refresh with an accessible name and loading/disabled state.
- No primary create button.
- No KPI cards in the header.

### Period and location controls

Immediately under the header:

1. compact segmented period control: `Today`, `7 days`, `Month`, `Year`, `Dates`;
2. optional compact multi-location control only when more than one location exists;
3. custom From/To fields only when `Dates` is selected;
4. quiet server-derived scope line below the controls.

Rules:

- Controls should be approximately 40 px high, not oversized pills.
- The period control remains a single-select tablist/radiogroup.
- At narrow widths it scrolls horizontally in one row instead of wrapping into a tall block.
- The scope line is always visible after a report loads because it makes the number auditable.
- Never substitute client guesses for the server-returned scope.

### Primary report surface

Use one wide bordered report surface rather than several detached hero cards.

#### Left summary

- small label `Net sales`;
- large but controlled net-sales amount;
- comparison delta and exact comparison label;
- previous-period value shown quietly beneath it.

The amount is the strongest element on the page, but must not consume half the viewport.

#### Right chart

- title from the current chart mode: `By hour`, `By day` or `By month`;
- exact readout for selected/peak interval with amount and count;
- existing bar data and interaction;
- quiet grid lines, restrained cobalt bars and one clearly selected bar;
- no gradients, animation spectacle or chart legend that repeats obvious information.

#### Summary strip

Below the hero/chart area inside the same surface, show a quiet three-column strip:

1. `Gross sales`;
2. `Orders`;
3. `Average check`.

Use thin separators rather than three large cards. Preserve each metric’s comparison value, but keep it visually subordinate.

#### Adjustments row

When present, show discounts and refunds in one compact row below the summary strip:

- `Discounts −…`
- `Refunds ×N −…`

If both are zero, omit the row without leaving a blank gap.

### Breakdown order

The first visible pair under the primary surface is:

1. `Payment methods`;
2. `Top items`.

Payment-method rows may use restrained proportional bars, but the exact amount and count remain the primary information. A zero total must not cause division by zero or invalid widths.

Top items use a compact ranked list with name, quantity and amount. Do not invent product images; the current report does not supply them.

Continue the remaining existing breakdowns lower on the same page, in this order when data exists:

1. Channels
2. Order types
3. Locations
4. Staff
5. Categories

Do not add tabs or a fake `More breakdowns` button. The hint in the reference means the page continues by scrolling. Use normal document flow and clear section spacing.

## Visual rules

- Match `sales-concept.png` and the established ANGLE/Square-inspired system used by approved Activity and Customers references.
- Reuse existing design tokens and shared primitives where possible.
- White canvas and surfaces, cool-gray hairline borders, dark navy/ink text and restrained cobalt active/focus states.
- Use compact controls and comfortable but not wasteful spacing.
- Use existing Lucide outline icons only where they clarify an action.
- Keep numbers aligned and easy to scan.
- Use tabular numerals if the existing font supports them.
- Green is reserved for a genuinely positive comparison.
- Red is reserved for refunds, negative adjustments and genuine decline where appropriate.
- A declining sales comparison should be clear but not alarmist.
- No gradients, glassmorphism, decorative blobs, illustrations, photos, heavy shadows or giant buttons.
- No hard-coded mock values in production rendering.
- Avoid inline styles except data-driven chart dimensions/custom properties already justified by the current chart.
- Honor `prefers-reduced-motion`.

## Responsive behavior

### Wide desktop

- Sidebar and page shell remain unchanged.
- Net-sales summary and chart share one surface.
- Payment methods and Top items form two balanced columns.
- Remaining breakdowns use a consistent two-column grid where space permits.

### Tablet

- Primary surface may stack summary above chart if the chart becomes too narrow.
- Period controls remain one horizontally scrollable row.
- Filters do not collide with Export/Refresh.
- Breakdown panels may remain two columns only when amounts and labels do not truncate excessively.

### Mobile

- No horizontal page overflow at 390 px.
- Header actions remain reachable without becoming two giant full-width buttons.
- Period tabs scroll horizontally and retain the selected tab in view.
- Custom dates stack cleanly.
- Multi-location picker uses a touch-friendly sheet/popover and keeps multi-select behavior.
- Net sales, comparison and previous value stack before the chart.
- Chart keeps its internal horizontal scrolling; the entire page must not scroll sideways.
- Chart readout wraps safely and does not cover bars.
- Summary strip becomes three compact rows or a two-plus-one grid; it must not compress numbers into unreadable columns.
- Every breakdown becomes one column.
- Long product, staff, category and location names truncate or wrap without pushing amounts off-screen.
- Safe-area insets are respected.

## Accessibility requirements

- Period selection has correct single-select semantics and keyboard navigation.
- Location control has a programmatic label and exposes its multi-select state.
- Date inputs retain visible or programmatic `From` and `To` labels.
- Export and refresh have explicit accessible names.
- Refresh communicates loading without trapping focus.
- Chart has an overall accessible title/summary.
- Every chart bar remains keyboard reachable only if selection adds useful information; otherwise provide an equivalent accessible data list and avoid excessive tab stops.
- Selected chart interval exposes selected state programmatically.
- Error state uses `role="alert"`.
- Loading/updated state uses a restrained status/live region.
- Comparison direction is never communicated by color alone.
- Focus is visible for every interactive control.
- Contrast meets WCAG AA.
- Reading order follows visual order at every breakpoint.

## State design requirements

Explicitly implement and verify:

1. initial loading with no report;
2. silent Today refresh with existing report retained;
3. load error;
4. no sales for the selected period;
5. sales with no refunds/discounts;
6. sales with refunds and discounts;
7. no previous-period data;
8. previous period equals zero;
9. one location;
10. many locations, including multiple selected;
11. empty individual breakdowns;
12. long custom range with horizontally scrollable chart;
13. mixed currencies returned by scope, if the server can produce them;
14. long Hebrew and English item/location/staff labels.

An error must never appear as a valid `₪0` report. An empty period must clearly say that no sales occurred for the selected scope.

## Implementation phases

### Phase 0 — baseline and audit

1. Read every source and test listed above.
2. Record `git status` and protect unrelated user files.
3. Run focused reporting tests and the full baseline test suite.
4. Capture the current Sales page at desktop, tablet and mobile widths if the local authenticated app is available.
5. Record the real `sales_report` response shape and confirm whether all amounts are agorot.
6. Confirm current role/capability visibility and one-location/multi-location behavior.
7. Do not begin visual work until the baseline is understood.

### Phase 1 — structure without data changes

1. Refactor only the Sales presentation into clear internal components where useful:
   - report header/controls;
   - primary summary;
   - chart;
   - summary strip;
   - adjustments;
   - breakdown panel/list.
2. Keep network calls, period calculations and report state behavior unchanged.
3. Add no new global abstraction unless at least one existing component genuinely benefits.
4. Preserve current error, loading and empty states during the refactor.

### Phase 2 — header, controls and scope

1. Implement the approved header and compact actions.
2. Restyle the period selector without changing keys or behavior.
3. Replace multi-location chips only if the compact multi-select control is fully accessible and preserves all combinations.
4. Keep the server-derived scope line prominent enough to audit the report.
5. Verify custom date constraints and reruns.

### Phase 3 — primary report surface

1. Build the unified net-sales/chart surface.
2. Move Gross sales, Orders and Average check into the quiet summary strip.
3. Preserve comparison output for all four values.
4. Move non-zero discounts/refunds into the compact adjustments row.
5. Preserve exact currency formatting and zero-baseline comparison behavior.

### Phase 4 — chart refinement

1. Keep current bar generation and interval selection.
2. Improve chart proportions, labels, readout and selected state to match the reference.
3. Preserve continuous axes and horizontal scroll behavior.
4. Test ResizeObserver lifecycle, period changes and narrow viewports.
5. Honor reduced motion and avoid entrance animation that makes values jump.

### Phase 5 — breakdown hierarchy

1. Place Payment methods and Top items first.
2. Add proportional payment bars only from the existing amount values and guard zero totals.
3. Keep quantities and amounts explicit.
4. Render remaining real breakdowns below in the specified order.
5. Hide empty sections without layout gaps.
6. Do not add navigation tabs or product photos.

### Phase 6 — responsive and accessibility pass

1. Verify 390 px, 768 px, 1024 px and wide desktop.
2. Verify keyboard-only operation of period, dates, location selection, chart and actions.
3. Verify screen-reader names and selected states.
4. Test 200% zoom and long translated content.
5. Verify there is no page-level horizontal overflow.
6. Verify `prefers-reduced-motion`.

### Phase 7 — verification

Run at minimum:

```bash
npm test
npm run build
```

During development, also run the narrowest reporting tests directly.

Review the final diff specifically for:

- changed RPC arguments or backend work;
- float money arithmetic;
- rolling month/year regressions;
- lost location multi-select behavior;
- client-guessed scope;
- altered CSV values or missing BOM;
- fabricated breakdowns;
- hard-coded sample numbers;
- invented tabs/actions;
- unrelated formatting churn.

## Automated test expectations

Keep all existing tests passing and add focused tests for any extracted or changed pure behavior. At minimum cover:

- every period range;
- previous-period range semantics;
- `was none` comparison;
- hour/day/month chart slot continuity;
- long-range chart mode;
- server scope formatting;
- payment proportional-bar zero guard if extracted as a helper;
- conditional adjustment row;
- conditional empty breakdowns;
- CSV headings, amounts, labels, escaping, BOM integration boundary and filename;
- multi-location request parameters.

Do not write brittle tests against arbitrary CSS class order or every decorative icon.

## Manual acceptance checklist

### Reporting truth

- [ ] Net sales equals current gross sales minus refunds.
- [ ] Gross sales, Orders and Average check match the existing RPC response.
- [ ] Discounts/refunds appear only when non-zero and use the correct sign.
- [ ] Today compares with yesterday.
- [ ] Seven days compares with the previous seven days.
- [ ] Month compares with previous calendar month.
- [ ] Year compares with previous calendar year.
- [ ] Custom dates compare with the immediately preceding equal-length period.
- [ ] Growth from zero says `was none`, not infinity.

### Scope and controls

- [ ] All five period controls work.
- [ ] Custom From/To prevents inverted ranges.
- [ ] One-location account does not show a redundant location control.
- [ ] Multi-location account can choose all, one or several locations.
- [ ] Scope line exactly reflects the returned period, locations, timezone and currency.
- [ ] Refresh preserves active period, dates and locations.
- [ ] Today refreshes silently after one minute without page flicker.

### Chart

- [ ] Today uses hours; Month uses days; Year uses months.
- [ ] Empty time slots remain visible on the axis.
- [ ] Selected/peak interval readout has label, amount and order count.
- [ ] Long charts scroll internally on mobile without moving the page sideways.
- [ ] Changing periods does not leave a stale selected interval.
- [ ] No-sales period has a truthful empty state.

### Breakdowns and export

- [ ] Payment methods and Top items appear first when populated.
- [ ] Channels, Order types, Locations, Staff and Categories remain available below.
- [ ] Empty breakdowns do not render blank panels.
- [ ] Long labels do not collide with quantities or amounts.
- [ ] CSV contains the same scope, summary and populated breakdowns as before.
- [ ] Hebrew values open correctly in Excel.
- [ ] Export is disabled before the report loads.

### Responsive and accessibility

- [ ] No horizontal page overflow at 390 px.
- [ ] Period controls remain usable on touch and keyboard.
- [ ] Location multi-select is usable with touch, keyboard and screen reader.
- [ ] Chart and comparison do not rely on color alone.
- [ ] Focus remains visible.
- [ ] Loading, error and refreshed states are announced appropriately.
- [ ] At 200% zoom, controls and amounts do not overlap.

### Regression

- [ ] Dashboard Sales summary is unchanged.
- [ ] Activity CSV and Sales CSV remain separate and correct.
- [ ] Orders, Reservations and POS are unchanged.
- [ ] No migration or schema-version bump was added.
- [ ] Full test suite and production build pass.

## Required handoff from Claude

Before asking for commit/push/deploy, provide:

1. concise summary of what changed;
2. exact list of changed files;
3. tests and build commands with results;
4. desktop, tablet and mobile screenshots if available;
5. confirmation that no RPC, migration, schema version or money calculation changed;
6. confirmation that all seven real breakdowns remain reachable;
7. any known visual or browser limitation;
8. the remaining manual acceptance steps that require the authenticated production account.
