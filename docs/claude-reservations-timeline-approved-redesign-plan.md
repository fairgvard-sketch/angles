# Claude handoff: approved ANGLE Reservations workspace redesign

## Status

This document is the approved UX/UI direction for the ANGLE back-office
Reservations workspace: Timeline, List, Waitlist, and Tables & zones.
Analytics is explicitly outside this visual-redesign scope. This is an
implementation plan, not authorization to commit, push, deploy, apply
migrations, or change production data.

Read this file completely before editing.

## Visual reference

Inspect all four approved generated concepts before implementation:

- Timeline:
  `/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-6d77bad9-a919-44da-a34e-019cfe0130df.png`
- List:
  `/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-e3d37bc6-6528-4f6e-bf34-83670ea5dbcd.png`
- Waitlist:
  `/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-34d93edf-e702-4151-88df-82e24693eda2.png`
- Tables & zones:
  `/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-ace11cae-a956-4f3a-96fe-d22f926db657.png`

The images are structural and visual references, not pixel-perfect sources of
truth. Use real ANGLE data, current permissions, existing routes, and existing
business rules. Keep all four screens recognizably part of the same product.

## User decision

The user approved the overall Reservations visual direction, with two explicit
removals from Timeline:

1. Remove the summary cards `Busy now`, `Seats free`, and `Next hour` from the
   Reservations timeline.
2. Remove `View settings`. Its purpose is not clear and it must not be replaced
   with another vague control.

Preserve and implement the parts the user approved:

- compact Square-like information density;
- fixed table/zone column on the left;
- fixed time scale across the top;
- horizontal time-based reservation blocks;
- the approved semantic reservation color palette;
- visible current-time line;
- inline conflict treatment;
- right-side booking drawer that does not replace the timeline;
- compact desktop controls and restrained visual hierarchy;
- grouped ANGLE platform navigation.

The List, Waitlist, and Tables & zones concepts extend this approved system.
Do not redesign them with a different component library, spacing system,
density, drawer pattern, or status language.

## Product intent

Reservations is a professional host/manager workspace. Timeline remains the
primary spatial/time view, while the other tabs answer complementary questions:

- which tables are available at a given time;
- who is arriving and when;
- how long each visit occupies a table;
- which bookings are pending, confirmed, seated, completed, or conflicting;
- what action is needed for the selected visit.

List answers: which bookings exist, how can they be searched and filtered, and
what is the current state of each booking.

Waitlist answers: who is waiting, for how long, what was quoted, what they need,
and who should be seated next.

Tables & zones answers: what resources exist, where they are positioned, what
capacity and booking rules they have, and whether they are active.

Do not turn the page into a dashboard of metrics. The timeline itself is the
main content and should receive the available vertical space.

## Target page structure

### 1. Existing ANGLE application shell

Keep the shared platform shell and grouped capability-aware navigation. This
task must not create a second Reservations-only shell.

Reservations remains selected under the Work group.

### 2. Page header

Use one compact row containing:

- page title `Reservations`;
- location selector;
- previous-day button;
- date picker/current date;
- next-day button;
- reservation search;
- one primary CTA: `New reservation`.

Avoid oversized headings and controls. The header must remain usable at common
laptop widths.

### 3. View tabs

Keep:

- Timeline
- List
- Waitlist
- Tables & zones
- Analytics

The selected tab is clear through text weight and a restrained underline or
indicator. Preserve URL-backed tab state and browser Back/Forward behavior.

### 4. Timeline toolbar

Do not render the three KPI cards.

Use a compact toolbar only for controls that directly affect the timeline:

- zone filter;
- `Today` or `Now` action;
- earlier/later navigation when necessary;
- optional compact search/filter affordance if it is not already in the page
  header.

Every control must have an obvious effect. Do not add `View settings` or a
generic gear button.

If zoom is required for real usability, keep the explicit `- / 100% / +`
control with accessible labels and tooltips. Do not hide unrelated settings
behind it.

### 5. Timeline grid

The timeline is the dominant working surface.

Requirements:

- first column contains zone, table name, and capacity;
- first column remains sticky during horizontal scrolling;
- time scale remains sticky during vertical scrolling;
- major time divisions are clear;
- half-hour divisions are visible but visually secondary;
- the selected restaurant/service day is bounded correctly;
- no previous-day booking expands a normal day incorrectly;
- legitimate overnight bookings remain visible in the correct service window;
- current time is shown by one thin cobalt line with a small time label;
- rows have enough height for readable blocks without wasting space;
- zone rows may collapse, but default behavior must be predictable;
- scrolling one region keeps the header and body aligned;
- no layout jump when data loads, a drawer opens, or a booking updates.

### 6. Reservation blocks

Each reservation block must encode:

- start and end time;
- guest name or `Walk-in`;
- party size;
- status text;
- conflict/warning state when applicable.

Duration determines block width. Avoid truncating the most important content
before less important metadata.

Use status text in addition to color. Color alone is not sufficient.

## Approved color system

Use the concept image as the visual reference and introduce tokens rather than
page-local color literals.

Suggested starting tokens; adjust only as needed to meet contrast:

| State | Background | Foreground / accent | Intent |
|---|---|---|---|
| Confirmed | `#0B2345` | white | stable, committed reservation |
| Seated | `#168A4B` | white | guest is currently seated |
| Pending | `#F3C85B` | `#3A2A00` | needs attention, not an error |
| Completed | `#D9DDE2` | `#49515C` | historical/finished visit |
| Conflict | `#D92D20` or pale red surface with red border | accessible red text | action required |
| Selected | existing status fill plus `#2563EB` focus/selection ring | — | current booking |
| Current time | `#2563EB` | — | temporal orientation |

Rules:

- no gradients;
- no neon;
- no translucent glass effects;
- no arbitrary color per zone or table;
- pending must not look like a destructive error;
- selected state must remain visible for every status;
- meet WCAG contrast for text and interactive states;
- support forced-colors/high-contrast mode where practical.

## Selected visit drawer

Opening a booking from the timeline must create a right-side drawer, not a
center modal and not a replacement page.

Desktop target width: approximately 420-440 px.

The timeline remains visible and keeps its scroll position behind/next to the
drawer.

Drawer content order:

1. guest name;
2. party size;
3. date and time;
4. assigned table(s) and zone;
5. status;
6. phone/contact;
7. note and guest requirements;
8. source and creation metadata;
9. primary operational actions;
10. secondary/destructive actions in an overflow menu.

Actions should include only what the current state and permissions allow, for
example:

- Edit booking
- Confirm
- Guest seated
- Completed
- No-show
- Cancel

Interaction requirements:

- Escape closes the drawer;
- clicking the close button closes it;
- focus returns to the reservation block that opened it;
- the timeline, zone selection, date, horizontal scroll, and vertical scroll
  do not reset;
- opening one booking replaces drawer content without closing/reopening the
  whole layout;
- no background page disappearance or white flash;
- on smaller screens the drawer may become a full-screen sheet, while retaining
  a clear Back/Close path.

## Conflict presentation

Conflicts must be understandable at the point of work.

Timeline:

- show a compact conflict indicator on the affected booking;
- use a pale red inline strip or outline without covering adjacent rows;
- provide an explicit `View conflict` action when details are useful.

Create/edit form:

- server remains authoritative;
- show the exact conflict message;
- show free-table alternatives and nearest available times;
- tapping a free table replaces the conflicting table selection;
- tapping a time updates the date/time selection;
- clear the stale conflict message and old suggestions as soon as the user
  changes the conflicting table or time;
- explain when choosing a time switches table assignment back to Automatic;
- check availability again on save.

Do not merely clamp, hide, or cosmetically suppress a server conflict.

## Remove ambiguous/native interactions

Do not use `window.prompt`, `window.confirm`, or other browser-native dialogs
for operational flows.

Cancellation must use an ANGLE modal or drawer section with:

- optional reason;
- clear confirmation action;
- Cancel/Back action;
- correct focus management;
- no action when the user dismisses the dialog.

This is required because the current native cancellation prompt is unclear and
is not supported consistently in embedded/in-app browser environments.

## Cross-tab consistency

Timeline, List, Waitlist, and Tables & zones must share:

- the same page header and location/date context;
- the same tab component and URL-backed selected state;
- the same 8/12/16/24 spacing rhythm and compact control heights;
- the same status tokens and accessible status labels;
- the same right-side drawer component and close/focus behavior;
- the same loading, empty, error, offline, and permission states;
- the same search/filter grammar;
- the same responsive breakpoints;
- the same approach to primary, secondary, overflow, and destructive actions.

Changing tabs must not remount the whole application shell, flash a white page,
or lose the location unnecessarily. Browser Back/Forward and reload must reopen
the URL-selected tab.

## Approved List view

Visual reference:

`/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-e3d37bc6-6528-4f6e-bf34-83670ea5dbcd.png`

List is a compact operational data table, not a grid of large booking cards.

### Toolbar

Use one compact row containing only useful controls:

- date/day range;
- status filter;
- zone filter;
- source filter;
- reservation search when it is not already provided by the shared header.

Filters must be reflected in URL state where appropriate and survive reload.

### Table

Recommended columns:

- Time
- Guest
- Party
- Table
- Status
- Source
- Notes
- Actions

Requirements:

- sticky column header;
- subtle grouping by day, such as Today and Tomorrow;
- chronological sort is obvious and reversible;
- selected row has a restrained cobalt treatment;
- notes truncate safely with full content available in the drawer;
- actions use one compact overflow trigger;
- status uses the approved color system plus text;
- pagination or virtualisation must not lose selection unexpectedly;
- no giant empty rows or repeated card chrome;
- opening a row shows the shared right booking drawer while the table remains
  visible and keeps scroll/filter state.

Responsive behavior:

- desktop uses the full table;
- tablet may hide lower-priority columns behind row details;
- mobile uses an intentional compact booking list, not a horizontally crushed
  eight-column table.

## Approved Waitlist view

Visual reference:

`/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-34d93edf-e702-4151-88df-82e24693eda2.png`

Waitlist is a live operational queue.

### Toolbar

Use:

- waitlist search;
- day/date;
- status filter;
- zone/preference filter;
- one primary action: `Add to waitlist`.

### Queue table

Recommended columns:

- Position
- Guest
- Party
- Waiting
- Quoted
- Preference
- Status
- Actions

Group rows by operational state when useful:

- Waiting now
- Notified
- Seated
- Removed / expired

Requirements:

- waiting duration updates without remounting the table;
- queue position is clear and reorderable only for authorized users;
- do not rely on drag and drop alone; provide an accessible alternative;
- quoted wait and actual wait remain distinct;
- status tokens are consistent with Reservations while retaining Waitlist
  semantics;
- empty state says clearly that nobody is waiting;
- selected entry opens the shared right drawer;
- the drawer shows party, wait duration, quote, phone, preference, note, source,
  and a server-backed suggested table when available;
- primary action is `Seat guest` when allowed;
- secondary actions may include `Mark notified` and `Edit entry`;
- do not add WhatsApp or Telegram;
- server remains authoritative for seating and table availability.

Mobile must prioritize position, guest, party, wait duration, and the next
action. Lower-priority details belong in the entry sheet.

## Approved Tables & zones view

Visual reference:

`/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-ace11cae-a956-4f3a-96fe-d22f926db657.png`

Tables & zones is a resource and floor-layout editor, not a decorative room
render and not a plain list with no spatial meaning.

### Toolbar

Use compact controls:

- zone selection;
- Add zone;
- Add table;
- Undo;
- Redo;
- one primary action: `Save layout`.

Do not autosave every drag. Make the publish/save boundary explicit and protect
unsaved changes on navigation.

### Editor

Requirements:

- subtle light alignment grid;
- simple top-down square, rectangle, and round table shapes;
- clear table name/number and capacity;
- selected table uses a cobalt outline and visible handles;
- optional minimal structure labels such as Entrance, Window, or Bar;
- no 3D furniture, perspective room rendering, or excessive chair detail;
- keyboard-accessible position adjustment or another non-drag alternative;
- sensible snap/alignment behavior;
- zoom/pan only if required, with explicit accessible controls;
- out-of-service tables are visibly muted and remain editable;
- grouping/merging tables is explicit and reversible;
- zone/table counts reconcile with the saved server state;
- realtime operational availability is not confused with layout-edit state.

### Table inspector

Selecting a table opens the shared right drawer/inspector with:

- zone;
- name/number;
- capacity;
- shape;
- active/out-of-service state;
- optional minimum party;
- online-booking eligibility;
- Duplicate table;
- Out of service / Restore;
- destructive delete only in overflow with confirmation.

The floor remains visible while editing. Escape closes the inspector and
restores focus/selection context without discarding unsaved layout changes.

Responsive behavior:

- desktop uses editor plus inspector;
- tablet supports touch dragging and explicit selection;
- mobile should prioritize safe table/property management and may use a
  full-screen inspector; do not present an unusably tiny floor canvas.

## Responsive behavior

### Desktop

- full timeline plus right drawer;
- sticky headers and first column;
- compact controls;
- no KPI cards.

### Tablet

- preserve timeline as the primary surface;
- allow horizontal scrolling;
- drawer may overlay part of the grid but must be easy to close;
- touch targets are at least 44 by 44 px.

### Mobile

- do not shrink the desktop grid until it becomes unreadable;
- use a focused day/agenda or table-row view if required;
- booking details open as a full-height sheet;
- preserve date and filters when returning;
- no fixed action area may cover timeline content.

## Implementation phases

### Phase 0: audit and baseline

Before editing:

1. Read repository instructions and relevant existing plans.
2. Inspect current `TimelineDesk`, List, Waitlist, `FloorPlanEditor`, booking
   drawer/sheet, reservation form, shared tokens/components, routing, and
   responsive styles.
3. Record `git status`, HEAD, origin/main, test result, and production build.
4. Reproduce and record:
   - opening a timeline visit;
   - Escape closure;
   - scroll preservation;
   - selected-day boundaries;
   - server table conflict and suggestions;
   - stale conflict alert after choosing an alternative;
   - native cancellation prompt;
   - List filters, sorting, selection, pagination and drawer behavior;
   - Waitlist queue order, timers, state changes and seating flow;
   - Tables & zones selection, editing, persistence and unsaved-change
     behavior.
5. Map every existing behavior that must be preserved.

Do not edit before reporting Phase 0 findings.

### Phase 1: layout and shared tokens

1. Add/consolidate reservation status tokens.
2. Remove the three KPI cards from Timeline only.
3. Remove `View settings`.
4. Build the compact page/header/toolbar structure.
5. Ensure skeleton/loading geometry matches the final layout.
6. Establish shared table, filter bar, status, selection and drawer primitives
   for Timeline, List and Waitlist.

### Phase 2: timeline grid and blocks

1. Implement sticky time header and table column.
2. Match booking block density and typography to the approved concept.
3. Apply the approved status colors through shared tokens.
4. Add selected, focus, hover and conflict states.
5. Preserve correct restaurant-day and overnight calculations.

### Phase 3: right-side booking drawer

1. Use the existing shared Drawer where possible.
2. Match the approved information hierarchy.
3. Preserve timeline context and focus.
4. Verify Escape, close, switching bookings, and responsive behavior.

### Phase 4: conflict and cancellation UX

1. Clear stale conflict state after alternatives are selected.
2. Make table/time substitution explicit and predictable.
3. Replace native cancellation prompt with an accessible ANGLE dialog.
4. Preserve server validation and authorization.

### Phase 5: List view

1. Implement the approved compact reservation table.
2. Add sticky header, day grouping, sorting and URL-backed filters.
3. Reuse the shared booking drawer and status tokens.
4. Preserve selection, filters and scroll when the drawer opens/closes.
5. Implement deliberate tablet/mobile column reduction and entry layout.

### Phase 6: Waitlist view

1. Implement the approved queue table and operational state groups.
2. Keep waiting duration live without remounting rows.
3. Provide accessible reordering where authorized.
4. Reuse the shared right drawer for entry details and actions.
5. Verify suggested-table and seating flows against server authority.
6. Implement a clear empty state and mobile queue layout.

### Phase 7: Tables & zones

1. Implement the approved visual editor using the simplest maintainable
   rendering technology already compatible with the project.
2. Add zone selection, table shapes, capacity, selection and inspector.
3. Add explicit Save layout plus undo/redo for unsaved edits.
4. Protect unsaved changes during tab, route, location and browser navigation.
5. Preserve server IDs, authorization and operational table state.
6. Verify keyboard/non-drag editing and responsive inspector behavior.

### Phase 8: responsive, accessibility and performance

1. Test common desktop widths, tablet, and phone.
2. Verify keyboard operation and screen-reader semantics.
3. Respect reduced motion.
4. Prevent layout shift and unnecessary remounts.
5. Avoid data refetches caused only by opening/closing the drawer.
6. Verify all four approved screens at common desktop, tablet, and phone sizes.

### Phase 9: tests and live acceptance

Add or update focused tests for:

- status token/class mapping;
- selected restaurant-day window;
- previous-day exclusion and overnight inclusion;
- block positioning and duration;
- drawer open/close/Escape/focus restoration;
- timeline state preservation;
- table conflict alternatives;
- stale error clearing;
- cancellation modal dismissal and submission;
- List sorting, filters, day grouping, selection and pagination;
- Waitlist live duration, reorder, status groups, empty state and seating;
- Tables & zones save, undo/redo, unsaved navigation warning, table inspector,
  out-of-service state and keyboard adjustment;
- shared drawer behavior from Timeline, List and Waitlist;
- responsive overflow;
- URL-backed tab/date/filter state for every included tab.

Run:

- focused tests;
- full configured test suite;
- lint/typecheck when configured;
- production build;
- live browser smoke with no production mutations except explicit test records.

## Acceptance criteria

The redesign is accepted only when:

- the three metric cards are absent from Timeline;
- `View settings` is absent;
- the timeline receives the recovered vertical space;
- booking colors closely match the approved concept and meet contrast;
- statuses remain understandable without color;
- current time and selection are immediately visible;
- opening a booking shows the right-side drawer;
- Escape closes it and restores focus;
- the timeline and all table rows remain mounted and preserve position;
- conflict alternatives appear after server rejection;
- tapping an alternative visibly updates the form;
- the stale conflict alert clears after the conflicting value changes;
- cancellation uses a real ANGLE dialog, not `window.prompt`;
- List matches the approved compact table concept and does not regress into
  large cards;
- List filters, sorting, selection and drawer state survive expected navigation;
- Waitlist clearly distinguishes Waiting, Notified, Seated and Removed/Expired;
- Waitlist timers update without whole-table flashing;
- Waitlist seating and suggested-table actions remain server-validated;
- Tables & zones provides an understandable spatial editor with explicit Save;
- table capacity, status, online-booking eligibility and zone persist correctly;
- unsaved layout changes cannot be lost silently;
- all included tabs share the approved spacing, controls, colors and drawer;
- Analytics behavior and visuals are not changed by this redesign;
- no route-change flash, white screen, or horizontal page overflow appears;
- browser Back/Forward and reload preserve the intended route state;
- existing permissions and server-side conflict rules remain intact;
- tests and production build pass;
- no new console errors appear.

## Working protocol for Claude

Do not implement this as one large diff.

For each phase:

1. state the problem and intended files;
2. show the focused diff;
3. run tests and production build;
4. report manual verification and remaining risk;
5. stop for user review;
6. do not commit, push, deploy, or apply migrations without explicit
   authorization.
