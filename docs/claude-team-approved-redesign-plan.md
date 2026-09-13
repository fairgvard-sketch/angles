# Claude implementation brief — Team one-page redesign

> **STATUS: DO NOT IMPLEMENT — OUTDATED.** The brief was written before the
> current `Hours` timesheet workflow was discovered. It incorrectly excludes
> time tracking and does not preserve `HoursManager`, monthly reports, CSV,
> manual shift corrections or audit behavior. A replacement brief must be
> produced after the product owner chooses whether Hours remains a separate
> Team tab or becomes a full-width section on the one-page Team screen.
> Replacement: `docs/claude-team-access-hours-redesign-plan.md`.

Read this document completely before changing code. Then inspect the current implementation and execute the work phase by phase.

## Exact prompt for Claude

> Read `docs/claude-team-approved-redesign-plan.md` completely and follow it as the source of truth. Redesign the ANGLE backoffice Team section as one scalable page using `docs/design-references/team-concept.png` as the visual reference. Remove the internal Staff / Roles / Permissions tabs, but preserve every real staff, PIN, role, permission, location, owner-protection and deletion rule. The People and Custom roles sections must remain usable with many records: compact searchable lists, stable headers, bounded desktop height and progressive disclosure on mobile. Preserve legacy Team tab URLs by opening and focusing the corresponding section. Do not add invitations, email, schedules, payroll, departments, analytics, migrations or hard-coded demo data. First inspect the current code and tests, protect unrelated dirty files and establish a passing baseline. Implement phase by phase, verify desktop/tablet/mobile and accessibility, then run focused tests, the full test suite and the production build. Do not commit, push or deploy unless I explicitly ask after reviewing the result. At the end, report changed files, tests run, remaining risks and manual acceptance steps.

## Objective

Redesign ANGLE backoffice `Team` so that all three existing areas live on one coherent page:

1. People;
2. Custom roles;
3. Default register permissions.

The page must work equally well for the current small Bulochka team and for organisations with many people and roles. “One page” means one route and one information hierarchy, not rendering an unlimited number of rows at once.

Team is access management for ANGLE POS. It is not an HR, payroll, scheduling or communications product.

## Approved visual reference

- `docs/design-references/team-concept.png`

Use the image for the ANGLE shell, typography, density, section hierarchy, row anatomy, action placement, permission controls, whitespace and color treatment.

The reference shows only two people and one sample custom role. Production values must always come from current queries. The scalability rules in this document override the static number of visible rows in the image.

## Functional source of truth

Read before editing:

- `backoffice/src/TeamManager.jsx`
- `backoffice/src/team.js`
- relevant Team styles in `backoffice/src/styles.css`
- location settings helpers used by permissions in `backoffice/src/settings.js`
- Team routing in `backoffice/src/App.jsx`, routing/navigation helpers and tests
- all Team, permission, staff and role tests found by repository search
- shared modal, button, layout, form and confirmation primitives used by Team
- POS permission definitions in `src/lib/perms.ts` or their current repository equivalent
- migrations/RPC definitions for staff and roles, for understanding only

Search for every usage of:

- `fetchStaff`
- `createStaff`
- `updateStaff`
- `setStaffPin`
- `deleteStaff`
- `fetchRoles`
- `saveRole`
- `deleteRole`
- `PERM_KEYS`
- `PERM_DEFAULTS`
- `permLevel`
- `patchLocationSettings`
- `create_staff`
- `update_staff`
- `set_staff_pin`
- `delete_staff`
- `save_role`

Existing server enforcement remains the authorization source of truth.

## Non-negotiable product rules

1. Remove the internal visual tabs `Staff`, `Roles` and `Permissions` from Team.
2. Keep Team as one route and one vertically coherent page.
3. Preserve all existing staff, custom-role and permission functionality.
4. Preserve owner protection: only an owner may edit an owner row or assign the owner base role.
5. Preserve PIN rules: 4–8 digits, stored encrypted, replaceable but never readable.
6. Preserve the distinction between base roles (`owner`, `manager`, `barista`) and custom roles.
7. A custom role remains an override over a base level, action by action.
8. Custom roles can never grant owner access or team/settings management.
9. Default permissions remain location-scoped in `locations.settings.perms`.
10. Preserve the two real permission levels only: `Everyone` and `Manager`.
11. Preserve optimistic permission saving, successful Saved feedback and rollback on error.
12. Preserve staff activation/deactivation.
13. Preserve deletion rules: a person with sales/history cannot be deleted and must be offered deactivation instead.
14. Preserve role deletion behavior: holders fall back to their base level.
15. Preserve all server-side authorization, RLS and RPC validation. UI visibility is not authorization.
16. Do not add email invitations, invite links, phone numbers, profile photos, messaging or onboarding flows.
17. Do not add schedules, shifts planning, attendance, payroll, salaries, departments, job boards, performance analytics or HR documents.
18. Do not add bulk permission editing, bulk staff deletion or destructive row selection.
19. Do not create migrations, RPCs, schema-version changes or permission keys in this task.
20. Do not change POS permission meanings or defaults.
21. Do not redesign the POS login/staff screen, Locations or Settings as part of this task.
22. Do not hard-code Bulochka, Vlad, Snif Pinsker 29 or the sample Senior barista role in production rendering.
23. Do not touch unrelated dirty files.
24. Do not commit, push or deploy until the user explicitly asks after reviewing the implementation.

## Existing behavior that must remain

### Staff data

Preserve:

- organisation-scoped staff loading;
- fields currently used by Team: id, name, base role, active state, location, created time and custom role id;
- active/inactive status;
- base-role labels;
- custom-role name resolution;
- location assignment when creating a person;
- optional custom-role assignment for non-owner staff;
- editing name, base role, custom role and active state;
- changing PIN from the same editor flow;
- owner/manager restrictions;
- loading, empty and error states.

### Add and edit person

Preserve:

- required name;
- required 4–8 digit PIN when creating;
- optional PIN replacement when editing;
- location requirement for a new person;
- location chooser only when more than one location exists;
- custom-role chooser only when custom roles exist and base role is not owner;
- `None — use base role and location settings` behavior;
- Active checkbox when editing;
- Save/Cancel disabled and busy states;
- server errors shown as errors, not silent failure;
- destructive confirmation when deleting;
- explicit guidance to deactivate a person who has records.

Do not replace PIN with passwords, email sign-in or invitation acceptance.

### Custom roles

Preserve:

- organisation-wide role list;
- role name;
- base level: Barista or Manager;
- allowed permission keys;
- count of allowed actions;
- number of current holders;
- create, edit and delete;
- delete consequence explaining that people return to their base level;
- role editor checkboxes for allowed actions;
- server filtering of forbidden `manage` access;
- empty/loading/error states.

### Default permissions

Preserve exactly these nine actions:

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

- per-location settings;
- default value fallback through `permLevel`;
- one-of-two choice semantics;
- manager/owner PIN challenge for restricted actions;
- immediate optimistic response;
- disabled state while saving;
- Saved state after success;
- rollback and visible error after failure;
- location switching for organisations with multiple locations.

## Target one-page information architecture

### Header

- Title: `Team`.
- Description: `People, roles and register access in one place.`
- Primary action: compact `Add person` with plus icon.
- No global Team tabs.
- No dashboard metrics or decorative cards.

### Section 1 — People

People is the primary and largest section.

#### Section header

- Title: `People`.
- Quiet truthful count, for example `42 active · 4 inactive`.
- Search field with placeholder `Search team`.
- Search matches person name and resolved role name locally for the current result set unless a real server-side search contract already exists.
- Do not add a fake total if the query does not provide one.

Only when the data makes them useful, show compact filters:

- Status: All / Active / Inactive;
- Base or custom role;
- Location, only for organisations with multiple locations.

Do not show three empty dropdowns for a two-person team. Use progressive disclosure: filters appear when there is more than one meaningful value or when the list passes a sensible threshold.

#### Desktop table

Use one compact bordered table/list with stable columns:

1. Person
2. Access
3. Location
4. Status
5. Actions

Row rules:

- simple initials avatar, never a photo;
- name is primary;
- Access shows custom role when assigned, otherwise base role;
- optionally show the base role as quiet secondary text when a custom role is assigned;
- location name is resolved from context;
- status uses text plus a restrained dot, not color alone;
- explicit `Change PIN` and `Edit` actions;
- owner row remains visibly protected when the current user cannot edit it;
- inactive rows remain in the same list with a muted state;
- no separate Active/Inactive tabs;
- no checkbox, bulk actions or three-dot menu;
- row height approximately 60–70 px.

#### Many people

The People section must not grow without limit and push Roles/Permissions many screens down.

Desktop/tablet behavior:

- set a bounded list viewport sized for approximately 6–8 rows;
- keep the section toolbar and column header sticky within the list surface;
- the staff rows scroll inside the bounded list, not the whole Team layout;
- preserve visible focus when keyboard navigation scrolls a row into view;
- show a subtle bottom boundary so the scroll area is discoverable;
- do not hide the scrollbar in desktop accessibility modes.

Data behavior:

- do not render hundreds of rows into the DOM at once;
- if the existing query can be safely paged with stable ordering and without a migration, use a page size around 50 and preserve loaded pages while searching/filtering only when truthful;
- do not apply client-only search to one server page and imply it searched the whole organisation;
- if safe server pagination/search requires a separate backend contract, do not invent it silently in this visual task: keep current complete loading, render progressively in chunks, and document the scalability limitation in the handoff;
- never lose the complete role-holder counts because only the first staff page was loaded.

Mobile behavior:

- no nested scroll area inside the page;
- rows become compact stacked summaries;
- render the first 20 people, then `Load more` progressively;
- search and useful filters remain above the list;
- actions remain explicit and touch-friendly;
- no horizontal table scroll.

### Section 2 — Custom roles

Custom roles is secondary but remains visible on the same page.

#### Section header

- Title: `Custom roles`.
- Compact `New role` action.
- Quiet role count when truthful.
- Search appears when the role list is large enough to need it; it does not dominate an empty or one-role state.

#### Role list

Use compact rows/table rather than large cards. Each row shows:

- role name;
- base level;
- number of allowed actions;
- number of people assigned;
- clear edit/chevron affordance.

Do not render every permission as a chip in the list. The complete permission set belongs in the existing role editor.

Empty state remains compact and useful:

- `No custom roles yet`;
- one sentence explaining the purpose;
- `New role` remains available in the section header.

#### Many roles

Desktop/tablet behavior:

- use a bounded role-list viewport rather than allowing dozens of rows to push permissions away;
- keep its header stable;
- show approximately 5–7 role rows before internal scrolling;
- add local search by name when the complete role set is loaded;
- optional filters `Barista base / Manager base` and `Used / Unused` appear only when useful;
- preserve accurate holder counts across the complete staff set;
- do not paginate roles in a way that removes options from the Staff editor.

Mobile behavior:

- no nested role-list scroll;
- render the first 10 roles, then `Load more`;
- opening/editing a role uses the existing accessible modal/sheet behavior;
- role names and counts never collide.

### Section 3 — Default register permissions

This section remains on the same page below or beside Custom roles according to viewport width.

#### Header

- Title: `Default register permissions`.
- Description: `Applied to baristas without a custom role. Restricted actions ask for a manager PIN.`
- Saved/error state aligned to the end.
- For one location, show its name quietly but do not render a redundant interactive selector.
- For multiple locations, use one compact accessible location selector rather than a wide row of location tabs.

#### Permission rows

- render all nine actions;
- use a compact two-column grid on wide desktop;
- each action has one segmented radiogroup: `Everyone` / `Manager`;
- selected and unselected states must remain obvious without relying only on color;
- never use two independent switches or checkboxes;
- keep DOM/reading order logical when visually arranged in columns;
- on tablet/mobile collapse to one column;
- retain optimistic save, Saved feedback and rollback behavior.

## Desktop composition

Use the approved reference as the starting point:

1. Header and Add person.
2. Full-width People section with bounded list height.
3. Below it, a two-column row:
   - Custom roles: approximately 32–36% width;
   - Default register permissions: approximately 64–68% width.

The three sections should remain reachable in one normal desktop viewport for a small team and within one short page for a large team because the two lists have bounded height.

Avoid making the permissions section look like a giant enterprise matrix.

## Responsive behavior

### Wide desktop

- People uses the full content width.
- Roles and Permissions share the lower row.
- Both list headers remain stable while their rows scroll when necessary.

### Tablet

- People remains first.
- Roles and Permissions may stack when the permission controls become cramped.
- Toolbars may wrap into two clean rows.
- Permission grid may become one column.

### Mobile

- All sections stack in document order.
- Avoid nested scroll areas.
- People and roles use progressive `Load more` rendering.
- Staff rows are stacked summaries, not a squeezed desktop table.
- `Change PIN` and `Edit` remain reachable.
- Permission controls use the full available row width.
- Editors use mobile-safe modal/sheet behavior and safe-area insets.
- No horizontal page overflow at 390 px.

## Visual rules

- Follow `team-concept.png` and the established ANGLE/Square-inspired design system.
- Reuse existing tokens and shared UI primitives.
- White canvas and surfaces, thin cool-gray borders, dark navy text and restrained cobalt active/focus states.
- Compact controls around 40 px high.
- Modest 8–12 px radii.
- Use Lucide outline icons already in the project.
- Initials avatars are quiet orientation aids, not decorative profile photography.
- Use green only for active/saved success and red only for destructive/error states.
- No gradients, glassmorphism, decorative illustrations, strong shadows, giant buttons or giant empty states.
- No hard-coded mock people, roles, locations or counts.
- Avoid inline styles when reusable CSS belongs in `styles.css`.
- Honor `prefers-reduced-motion`.

## Accessibility requirements

- Page sections use clear headings and landmarks.
- Search fields retain programmatic labels.
- Filters retain visible or programmatic labels.
- Staff and role rows remain keyboard reachable only when the whole row is an action; otherwise keep explicit action buttons and non-interactive row markup.
- `Change PIN`, `Edit`, `Add person` and `New role` have unambiguous accessible names.
- Status and owner protection are never communicated by color alone.
- Scrollable list regions are labelled, keyboard reachable when necessary and do not trap focus.
- Sticky headers never obscure focused rows.
- Permission pairs remain real radiogroups with distinct accessible labels per action.
- Saved feedback uses a restrained status/live region.
- Errors use `role="alert"`.
- Modals have accessible titles, focus trapping, Escape close and focus restoration.
- Destructive confirmation remains explicit.
- Visible focus meets contrast requirements.
- Color contrast meets WCAG AA.
- Reading order matches visual order at all breakpoints.

## Legacy URL behavior

Current links may contain:

- `?view=team&tab=staff`
- `?view=team&tab=roles`
- `?view=team&tab=perms`

After removing the visual tabs:

- all three URLs still open the same one-page Team view;
- `tab=roles` scrolls/focuses the Custom roles section after data/layout is ready;
- `tab=perms` scrolls/focuses Default register permissions;
- `tab=staff` focuses People;
- Back/Forward must remain predictable;
- do not create a render loop by rewriting the URL repeatedly;
- new section links may use stable anchors or the existing tab parameter, but must remain addressable after reload.

## State requirements

Explicitly design and test:

1. initial loading;
2. complete Team load error;
3. no locations linked;
4. no staff;
5. two staff members;
6. many staff members;
7. active and inactive staff mixed;
8. protected owner viewed by manager;
9. no custom roles;
10. one custom role;
11. many custom roles;
12. role with zero holders;
13. multiple locations;
14. permissions loading;
15. permission save success;
16. permission save error with rollback;
17. person deletion blocked by history;
18. long Hebrew/English names and role names.

Loading one section should not unnecessarily blank the other successfully loaded sections.

## Implementation phases

### Phase 0 — baseline and audit

1. Read every listed source, helper and test.
2. Record `git status` and protect unrelated user changes.
3. Run focused Team/routing tests and the full baseline suite.
4. Capture current Staff, Roles, Permissions, Add person, Edit person, New role and Edit role states if an authenticated local/production session is available.
5. Confirm real role/permission enforcement and owner restrictions from server code.
6. Confirm current routing behavior for all Team tab URLs.
7. Record current list sizes and query behavior before changing rendering.

### Phase 1 — one-page structure

1. Replace internal tabs with three section components rendered together.
2. Keep one shared staff/roles load rather than issuing duplicate requests per section.
3. Preserve independent permission loading by location.
4. Implement stable section refs/anchors for legacy URL focus.
5. Keep all existing editors functional before visual refinement.

### Phase 2 — scalable People section

1. Build the approved staff table/list.
2. Resolve location and custom-role labels correctly.
3. Add truthful search and only useful filters.
4. Implement bounded desktop/tablet viewport with sticky toolbar/header.
5. Implement progressive mobile rendering without nested scroll.
6. Preserve all row permissions and editor behavior.
7. Test large generated fixture data without putting mock values into production.

### Phase 3 — scalable Custom roles section

1. Implement the compact role list and New role action.
2. Preserve holder counts and base-level meaning.
3. Add search/filter visibility only for large role sets.
4. Implement bounded desktop/tablet list and progressive mobile rendering.
5. Preserve create/edit/delete consequences and Staff-editor role options.

### Phase 4 — permissions section

1. Replace location tabs with a compact selector only for multiple locations.
2. Implement the approved two-column permission layout.
3. Preserve radiogroup semantics and all nine actions.
4. Preserve optimistic saving, disabled state, Saved feedback and rollback.
5. Verify long labels and single-column tablet/mobile layout.

### Phase 5 — editor and state polish

1. Keep Add/Edit person compact and understandable.
2. Keep New/Edit role focused on name, base and allowed actions.
3. Verify PIN validation and destructive confirmation.
4. Verify independent loading/error states for Team and permissions.
5. Ensure closing a modal restores focus to the correct action.

### Phase 6 — responsive and accessibility pass

1. Verify 390 px, 768 px, 1024 px and wide desktop.
2. Verify keyboard-only operation through lists, editors and permissions.
3. Verify sticky headers and scroll regions at 200% zoom.
4. Verify reduced motion.
5. Verify long names, many rows and many roles.
6. Verify no page-level horizontal overflow.

### Phase 7 — verification

Run at minimum:

```bash
npm test
npm run build
```

Also run the narrowest Team, routing and permission tests during implementation.

Review the final diff specifically for:

- weakened owner protection;
- readable/stored PIN leakage;
- changed permission defaults or keys;
- lost custom-role overrides;
- inaccurate holder counts caused by pagination;
- search over only one server page presented as global search;
- location selection regressions;
- lost error rollback;
- broken legacy Team URLs;
- invented HR functionality;
- migrations or unrelated churn.

## Automated test expectations

Keep existing tests passing and add focused tests for changed pure/UI behavior. At minimum cover:

- active/inactive counts;
- staff search by name and role;
- useful filter combinations;
- progressive visible-row limits and Load more;
- custom-role holder counts;
- role search and Used/Unused filtering if implemented;
- owner row edit restrictions;
- owner assignment restriction;
- PIN validation;
- deletion blocked by records;
- role deletion consequences already represented by server errors/results;
- all nine permission rows and their current levels;
- permission optimistic update, success and rollback;
- one-location versus multi-location selector behavior;
- legacy `tab=staff`, `tab=roles` and `tab=perms` routing/focus;
- mobile rendering without horizontal overflow where the current test stack supports it.

Do not write brittle tests against incidental CSS order or sample names from the image.

## Manual acceptance checklist

### One-page navigation

- [ ] People, Custom roles and Default register permissions appear on one page.
- [ ] No Staff/Roles/Permissions tab bar remains.
- [ ] The three legacy tab URLs still land on/focus the correct section after reload.
- [ ] Browser Back/Forward remains predictable.

### People

- [ ] Small teams do not see unnecessary filters.
- [ ] Large teams use a bounded desktop list with stable header.
- [ ] Mobile uses Load more rather than a nested scroll area.
- [ ] Search results are truthful for the full loaded/server scope.
- [ ] Active and inactive staff remain in one list.
- [ ] Location and access labels are correct.
- [ ] Change PIN and Edit work for permitted rows.
- [ ] Managers cannot edit/assign owner access.
- [ ] Add person validates name, location and 4–8 digit PIN.
- [ ] Deletion with history is blocked and recommends deactivation.

### Roles

- [ ] Empty state is compact and New role remains visible.
- [ ] Many roles do not push permissions far down the page.
- [ ] Mobile uses Load more.
- [ ] Base level, allowed-action count and holder count are accurate.
- [ ] Role search/filter does not remove roles from Staff editor options.
- [ ] Create, edit and delete work.
- [ ] Deleting a role communicates fallback to base access.
- [ ] Custom roles cannot grant owner/team management.

### Permissions

- [ ] All nine real actions appear.
- [ ] Every action is a single Everyone/Manager choice.
- [ ] One location has no redundant selector.
- [ ] Multiple locations switch correctly.
- [ ] Saving responds immediately and shows Saved.
- [ ] Failure restores the previous value and shows an error.
- [ ] Restricted POS actions still request manager/owner PIN.

### Responsive and accessibility

- [ ] No horizontal page overflow at 390 px.
- [ ] Large lists remain keyboard usable.
- [ ] Sticky headers do not cover focused rows.
- [ ] Modals trap and restore focus correctly.
- [ ] Status and selected permission are not color-only.
- [ ] At 200% zoom controls and labels do not overlap.

### Regression

- [ ] POS staff login and permission enforcement are unchanged.
- [ ] Locations settings remain intact.
- [ ] Orders, Sales and Activity are unchanged.
- [ ] No migration/schema-version bump was added.
- [ ] Full tests and production build pass.

## Required handoff from Claude

Before asking for commit/push/deploy, provide:

1. concise summary of the one-page redesign;
2. exact changed-file list;
3. test/build commands and results;
4. desktop, tablet and mobile screenshots if available;
5. confirmation that no staff/role/permission RPC or database schema changed;
6. confirmation that all nine permission actions and all staff/role operations remain available;
7. explanation of the implemented large-list strategy and any honest backend limitation;
8. confirmation that legacy Team tab URLs still work;
9. remaining authenticated manual checks.
