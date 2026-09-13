# Claude implementation brief — Team & Hours redesign

Read this document completely before changing code. Then inspect the current implementation and execute the work phase by phase.

## Exact prompt for Claude

> Read `docs/claude-team-access-hours-redesign-plan.md` completely and use it as the source of truth. Redesign ANGLE Team into exactly two internal views: `People & access` and `Hours`. On `People & access`, place the people list, custom roles and default location permissions on one scalable page, using `docs/design-references/team-concept.png` as the visual reference. Keep `Hours` as a separate full timesheet view because it is a distinct payroll-oriented workflow. Preserve every existing staff, PIN, access-summary, owner-protection, custom-role, permission-effect preview, Undo, monthly-hours, Excel, print, manual correction, soft deletion and audit rule. Preserve legacy links for `people`, `access`, `hours`, `staff`, `roles` and `perms`. Do not add invitations, email, scheduling, payroll calculation, migrations or hard-coded demo data. First inspect the current source and tests, protect unrelated dirty files and establish a passing baseline. Implement phase by phase, verify desktop/tablet/mobile and accessibility, then run focused tests, the full suite and the production build. Do not commit, push or deploy unless I explicitly ask after review. At the end report changed files, tests, screenshots, remaining risks and authenticated manual checks.

## Product decision

Team has exactly two internal views:

1. `People & access`
2. `Hours`

Do not keep three separate `People / Access / Hours` tabs and do not put the full timesheet underneath the access matrix on one long page.

Why:

- People, custom roles and permission defaults answer one question: who can do what.
- Hours answers a different operational question: who worked when and what goes into payroll.
- Combining People and Access removes unnecessary navigation.
- Keeping Hours separate prevents a dense monthly timesheet and correction workflow from overloading the access page.

## Visual reference

- `docs/design-references/team-concept.png`

Use the image for the ANGLE shell and the `People & access` hierarchy:

- People first and visually dominant;
- Custom roles and default permissions below;
- compact controls;
- thin borders;
- restrained blue active states;
- no enterprise-style permission wall.

The image predates the Hours view and contains sample records. Never hard-code its people, roles, location names or counts. For Hours, preserve the current information architecture while bringing it into the same approved visual system.

## Functional source of truth

Read before editing:

- `backoffice/src/TeamManager.jsx`
- `backoffice/src/roster.js`
- `backoffice/src/team.js`
- `backoffice/src/HoursManager.jsx`
- `backoffice/src/timesheet.js`
- `backoffice/src/hours.js`
- Team/Hours styles in `backoffice/src/styles.css`
- `backoffice/src/roster.test.js`
- `backoffice/src/hours.test.js`
- Team/Hours browser tests and routing/navigation tests
- `docs/backoffice-platform-phase9.md`
- shared components used by these screens:
  - `backoffice/src/ui/Tabs.jsx`
  - `backoffice/src/ui/Layout.jsx`
  - `backoffice/src/ui/Button.jsx`
  - `backoffice/src/ui/Drawer.jsx`
  - `backoffice/src/ui/FormDialog.jsx`
  - `backoffice/src/ui/ConfirmDialog.jsx`
- POS permission rules in their current source file
- staff/time-entry RPC definitions for understanding only

Search all usages of:

- `resolveTab`
- `sortRoster`
- `filterRoster`
- `accessSummary`
- `accessRows`
- `accessSource`
- `permissionEffect`
- `roleEffect`
- `fetchStaff`
- `fetchRoles`
- `fetchHours`
- `saveEntry`
- `deleteEntry`
- `hoursToCsv`
- `hoursFileName`
- `idleStaff`

The existing server enforcement remains authoritative.

## Non-negotiable rules

1. Render exactly two Team tabs/views: `People & access` and `Hours`.
2. Merge the current People and Access presentations without removing any functionality.
3. Keep Hours as a separate full view.
4. Preserve all staff, role, permission and timesheet data contracts.
5. Preserve owner protection and server authorization.
6. PIN remains 4–8 digits, encrypted, replaceable and never readable.
7. Custom roles remain exhaustive permission sets: when a person has one, location permission defaults do not apply to them.
8. Owner always has every action and cannot be restricted by a custom role.
9. Custom roles cannot grant owner/team/settings management.
10. Default permissions remain location-scoped.
11. Preserve all nine permission actions and only the two levels `Everyone` / `Manager`.
12. Preserve permission effect explanation and one-click Undo.
13. Preserve role change preview showing who gains or loses actions before Save.
14. Preserve staff activation/deactivation and deletion-with-history protection.
15. Preserve role deletion fallback to location/base rules.
16. Preserve monthly timesheet semantics, venue timezone, Excel and print.
17. Preserve manual Add/Edit shift and soft Remove behavior with audit history.
18. Preserve open and overnight shifts.
19. Do not add shift scheduling, payroll rates, salaries, payslips, leave, attendance scoring or HR documents.
20. Do not add email invitations, messaging, phone numbers, photos or departments.
21. Do not create migrations, RPCs or schema-version changes.
22. Do not change POS permission keys/defaults or time-entry audit semantics.
23. Do not touch unrelated dirty files.
24. Do not commit, push or deploy until explicitly requested.

## Existing behavior to preserve — People

Preserve the current People behavior, including:

- organisation staff loading;
- active and inactive staff in one sorted list;
- search/filter behavior from `filterRoster`;
- conditional location filtering;
- active, inactive and `On shift` status;
- last-shift information from the bounded Hours report window;
- location label, including `All locations`;
- base role and custom-role title;
- truthful per-person access summary, including `Varies` across locations;
- accessible person-row label;
- person drawer/card;
- Add person;
- Edit person;
- base role and custom role assignment;
- Active state;
- Change PIN;
- Open hours for the selected person;
- delete versus deactivate behavior;
- human-readable server errors;
- owner-only protections;
- loading, empty, filtered-empty and error states.

Do not simplify Access to only a role label. A person may have:

- owner access;
- a custom role deciding all nine actions;
- location rules plus base level;
- different effective rights across locations.

The UI must continue to state this truth.

## Existing behavior to preserve — Access

### Default location permissions

Preserve all nine actions and their explanations:

1. Discounts
2. Price override
3. Refunds
4. Void order
5. Close shift
6. Cash in / cash out
7. Pause online orders
8. Receive stock
9. Stock take

Preserve:

- per-location selection;
- `PERM_DEFAULTS` fallback;
- real radiogroup semantics;
- immediate optimistic update;
- saving/disabled state;
- Saved feedback;
- rollback and visible error;
- effect text naming affected people;
- exclusion of owners and custom-role holders from location-rule effects;
- Undo using the same server patch path;
- role exceptions shown alongside the matrix.

### Custom roles

Preserve:

- role list;
- base level;
- complete allowed-action set;
- role-holder count;
- create, edit and delete;
- role editor action hints;
- pre-save gain/loss preview for current holders;
- `Nobody has this role yet` state for new/unused roles;
- delete consequence and fallback to location/base rules;
- loading, empty and error states.

## Existing behavior to preserve — Hours

Hours is a real monthly time report used for payroll preparation.

### Period and scope

Preserve:

- current calendar month by default;
- previous/next month navigation;
- calendar date boundaries, not rolling day counts;
- venue timezone from the current timesheet contract;
- optional location filter for multi-location organisations;
- total hours in `H:MM` and decimal format;
- server report through `staff_hours_report`;
- independent staff loading so active people with zero punches still appear;
- people who worked in the period remain in the report even when later inactive;
- inactive people without period entries remain omitted;
- report error without crashing the rest of Team.

### Hours list

Preserve columns:

- Employee
- Days
- Shifts
- Hours

Preserve:

- worked people first;
- active people without hours as quiet zero/blank rows;
- `on shift` marker;
- selected-row state;
- opening/closing the staff Hours drawer;
- opening Hours directly from a People card;
- keeping the selected person stable across report refresh where possible.

### Staff hours drawer

Preserve:

- employee name;
- selected month/range;
- location information;
- total `H:MM` and decimal hours;
- Print;
- per-person Excel;
- day rows in calendar order;
- Date, weekday, In, Out, Break and Total;
- open shift ellipsis/state;
- split-day ranges and break calculation;
- edited-by indicator;
- monthly total;
- Add shift;
- venue-clock explanation;
- non-modal side-by-side desktop behavior;
- mobile full-screen drawer behavior.

### Add/Edit/Remove shift

Preserve:

- date;
- clock-in time;
- optional clock-out time;
- overnight-shift calculation when Out is earlier than In;
- required location for a new record where applicable;
- correction note;
- inability to create a future shift;
- manual Add and Edit through `save_time_entry`;
- soft Remove through `delete_time_entry`;
- explicit confirmation that the record remains in the audit trail;
- busy, validation and server error states;
- reload after a successful correction.

### Export

Preserve:

- all-staff Excel/CSV for worked staff only;
- per-person Excel/CSV;
- UTF-8 BOM;
- timezone-aware dates/times;
- day rows plus summary;
- H:MM and decimal hours;
- location and correction note fields;
- current filename behavior;
- disabled export when there is no worked report data;
- object URL cleanup.

## Target navigation and URL behavior

### Visible tabs

Show exactly:

1. `People & access`
2. `Hours`

The tab row is compact and consistent with other ANGLE sections. Do not create a third tab.

### Canonical state

- default view: `tab=people` or an equivalent stable canonical key;
- Hours: `tab=hours`.

### Legacy compatibility

Preserve existing/bookmarked URLs:

- `tab=people` → People & access, focused at People;
- `tab=access` → People & access, scrolled/focused at Access;
- `tab=hours` → Hours;
- legacy `tab=staff` → People & access, focused at People;
- legacy `tab=roles` → People & access, focused at Custom roles;
- legacy `tab=perms` → People & access, focused at Default permissions.

Requirements:

- reload opens the expected place;
- Back/Forward remains predictable;
- no URL rewrite/render loop;
- section focus happens only after the target is rendered;
- `Open hours` from a person selects that employee in Hours;
- returning to People & access does not unexpectedly reopen a stale drawer.

## Target layout — People & access

### Header

- Page title: `Team`.
- Description: `People, roles and register access in one place.`
- top-right compact primary `Add person` action;
- two-tab navigation directly below the header.

### People section

People remains first and full width.

Header/toolbar:

- title `People`;
- truthful active/inactive count;
- search `Search team`;
- location filter only when multiple locations exist;
- other filters appear only when the dataset makes them useful.

Desktop columns:

1. Person
2. Access
3. Location
4. Last shift / Status
5. Actions or row-open affordance

Use the current selected-person drawer rather than forcing every action into the row. Keep `Change PIN`, editing, access details and `Open hours` easy to find inside the drawer.

Large-team behavior:

- bounded desktop/tablet list height for roughly 6–8 rows;
- sticky table header;
- internal list scroll on desktop/tablet;
- no hidden scrollbar in accessibility modes;
- progressive mobile rendering: first 20, then `Load more`;
- no mobile nested scroll or horizontal table scroll;
- do not pretend client filtering of one server page is global;
- preserve complete role-holder and access calculations.

### Access section

Place Access below People on the same view.

Wide desktop:

- Default permissions approximately 64–68% width;
- Custom roles approximately 32–36% width;
- align both panels at the top;
- keep the effect/Undo message close to the permission just changed.

Default permissions:

- location selector only for multiple locations;
- concise explanatory copy;
- two-column grid for the nine permission rows when readable;
- each row includes action label, short hint and Everyone/Manager radiogroup;
- custom-role exceptions remain visible without becoming a chip wall.

Custom roles:

- compact list/table, not large cards;
- New role in the section header;
- each row: role name, base, allowed actions, holder count;
- large-role behavior: bounded list height, sticky header and search when useful;
- mobile: first 10 then `Load more`, no nested scrolling;
- role editor remains a drawer/card/dialog with full action list and impact preview.

## Target layout — Hours

Hours gets the full content canvas; do not squeeze it into a small card below permissions.

### Header toolbar

One compact row where space allows:

- previous month;
- clear month title;
- next month;
- location selector only for multiple locations;
- compact `Export Excel`;
- total hours aligned to the end.

Do not turn total hours into a giant KPI card.

### Timesheet table

Use one bordered table/list with stable numeric alignment:

- Employee receives most width;
- Days, Shifts and Hours align right;
- H:MM is primary and decimal hours are quiet secondary text;
- open shift is explicit and not color-only;
- zero-hour active staff remain subdued but selectable;
- selected employee receives a restrained blue state;
- rows remain around 56–64 px.

Large-team behavior:

- search by employee name;
- bounded/virtualized or safely paged list when needed;
- do not filter only one incomplete server page;
- mobile progressive rendering with `Load more`;
- preserve zero-hour active staff behavior.

### Employee drawer

- keep non-modal right drawer on desktop so another employee can be opened directly;
- use full-screen sheet on mobile;
- drawer must not make the underlying table disappear;
- compact header actions Print and Excel;
- day rows remain table-like and readable;
- Add shift remains a clear secondary action;
- edit affordance is explicit for corrected entries;
- long notes/location names never break numeric columns.

## Responsive behavior

### Desktop

- People & access follows the approved reference hierarchy.
- Hours uses a full-width timesheet with optional right drawer.
- No giant blank cards or oversized buttons.

### Tablet

- Access panels may stack.
- Permission grid may become one column.
- Hours drawer may overlay rather than permanently consume half the width.
- toolbars wrap into clean rows.

### Mobile

- two Team tabs remain one horizontally stable row;
- People rows become stacked summaries;
- roles and people use Load more, not nested scroll;
- access controls use full-width rows;
- Hours list becomes employee summaries with Days/Shifts/Hours;
- employee Hours drawer is full-screen;
- shift editor respects safe areas and keyboard viewport;
- no horizontal page overflow at 390 px.

## Visual rules

- Follow the approved ANGLE/Square-inspired system.
- White canvas and surfaces, cool-gray borders, dark navy text and restrained cobalt selection/focus.
- Compact controls around 40 px.
- Modest 8–12 px radii.
- Existing Lucide outline icons.
- Green only for active/saved/success; red only for destructive/error.
- No gradients, glassmorphism, decorative art, heavy shadows or giant buttons.
- No hard-coded sample values.
- Avoid inline styles where shared CSS belongs.
- Honor `prefers-reduced-motion`.

## Accessibility requirements

- The two visible tabs retain correct tab semantics and keyboard behavior.
- Search and filters have programmatic labels.
- Person/role/hour rows have accurate accessible names.
- Status, allowed/denied and selected states are not color-only.
- Permission choices remain labelled radiogroups.
- effect/Undo updates are announced without excessive repetition.
- drawers and dialogs have titles, focus management, Escape and focus restoration.
- non-modal desktop drawers do not trap focus incorrectly.
- scroll regions are labelled and keyboard usable.
- errors use `role="alert"`.
- saved/loading states use restrained status/live regions.
- destructive actions require explicit confirmation.
- focus remains visible at 200% zoom.
- contrast meets WCAG AA.

## State coverage

Test at minimum:

1. no locations;
2. no staff;
3. small and large staff lists;
4. active, inactive and on-shift staff;
5. owner viewed by owner and manager;
6. person access varies by location;
7. no roles, one role and many roles;
8. role gain/loss preview;
9. permission save, effect, Undo and rollback error;
10. current month with no punches;
11. month with worked and zero-hour active people;
12. open shift;
13. overnight shift;
14. split day with calculated break;
15. edited entry with audit marker;
16. Add/Edit/Remove shift success and errors;
17. multi-location Hours filter;
18. global and per-person export;
19. long Hebrew/English names, roles, locations and notes.

Loading Hours must not erase Team access data when returning to the first tab, and a failure in the shift-summary hint must not break People.

## Implementation phases

### Phase 0 — baseline

1. Read all listed source, tests and Phase 9 notes.
2. Record `git status` and protect unrelated changes.
3. Run focused roster/hours/routing tests and full baseline tests.
4. Capture current People, Access, Hours, person card, role card and hours drawer at desktop/mobile sizes if possible.
5. Confirm current RPC inputs, output shapes and authorization.

### Phase 1 — two-view navigation

1. Replace three visible tabs with `People & access` and `Hours`.
2. Render People and Access together without duplicate data loading.
3. Implement legacy route mapping and focus targets.
4. Preserve `Open hours` with selected employee.
5. Add routing tests before visual refactoring.

### Phase 2 — People section

1. Apply the approved table/list hierarchy.
2. Preserve access/status/last-shift truth.
3. Implement scalable search/list behavior.
4. Preserve person drawer and all staff operations.
5. Verify large lists and mobile progressive rendering.

### Phase 3 — Access section

1. Place default permissions and roles on the same page below People.
2. Preserve permission hints, affected-person explanation and Undo.
3. Preserve role impact preview and complete role editor.
4. Implement scalable roles list.
5. Verify location-specific effects and custom-role exceptions.

### Phase 4 — Hours visual integration

1. Keep all Hours behavior intact.
2. Align toolbar, table and drawer with the approved ANGLE system.
3. Add truthful Hours search/large-list handling without breaking idle staff.
4. Preserve month, location, totals, Excel and print.
5. Preserve Add/Edit/Remove and audit behavior.

### Phase 5 — responsive/accessibility

1. Verify 390, 768, 1024 and wide desktop widths.
2. Verify keyboard flow through tabs, lists, permissions, drawers and dialogs.
3. Verify focus restoration and Back/Forward.
4. Verify high zoom, long content and reduced motion.
5. Confirm no page-level horizontal overflow.

### Phase 6 — verification

Run at minimum:

```bash
npm test
npm run build
```

Also run focused roster, hours, Team browser and routing tests throughout.

Review the diff for:

- lost Hours functionality;
- broken time-entry audit/soft deletion;
- changed timezone/date boundaries;
- incorrect role semantics;
- weakened owner restrictions;
- lost effect/Undo behavior;
- incomplete large-list search presented as global;
- broken legacy URLs;
- migrations or unrelated churn.

## Manual acceptance checklist

### Navigation

- [ ] Exactly two tabs are visible: People & access, Hours.
- [ ] People and Access appear on the first view.
- [ ] All six current/legacy tab URLs land correctly.
- [ ] Back/Forward and reload work.
- [ ] Open hours selects the correct employee.

### People & access

- [ ] People search, location filtering and large-list behavior are truthful.
- [ ] Active, inactive, on-shift and last-shift states are correct.
- [ ] Effective access and Varies states are correct.
- [ ] Add/Edit/PIN/deactivate/delete protection work.
- [ ] Owner restrictions hold.
- [ ] All nine permission rules, hints, effects and Undo work.
- [ ] Custom-role holder counts and gain/loss preview are correct.
- [ ] Many people/roles do not push Access out of practical reach.

### Hours

- [ ] Month navigation and location filtering are correct.
- [ ] Total, Days, Shifts, H:MM and decimal values match the server report.
- [ ] Worked, idle, inactive-with-history and on-shift rows behave correctly.
- [ ] Employee drawer, Print and per-person Excel work.
- [ ] Global Excel exports only worked staff and opens Hebrew correctly.
- [ ] Add/Edit shift handles open and overnight shifts.
- [ ] Split-day break is correct.
- [ ] Remove is soft, confirmed and remains audited.
- [ ] Edited-by/correction information remains visible.

### Responsive/accessibility

- [ ] No horizontal overflow at 390 px.
- [ ] Mobile uses progressive lists and full-screen drawers.
- [ ] Keyboard navigation and focus restoration work.
- [ ] Permission/access/status meaning is not color-only.
- [ ] 200% zoom remains usable.

### Regression

- [ ] POS PIN login and permission enforcement are unchanged.
- [ ] POS clock-in/out remains unchanged.
- [ ] No migrations/schema bump were added.
- [ ] Full tests and production build pass.

## Required Claude handoff

Before asking for commit/push/deploy, provide:

1. concise summary;
2. exact changed files;
3. tests/build and results;
4. desktop/tablet/mobile screenshots for both views;
5. confirmation that no RPC/schema/permission/time-audit contract changed;
6. explanation of large-list strategy;
7. confirmation of legacy URL behavior;
8. remaining authenticated manual checks and known limitations.
