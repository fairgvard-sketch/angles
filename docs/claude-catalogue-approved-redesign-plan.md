# Claude handoff: approved ANGLE Catalogue workspace redesign

## Status and authorization

This document is the approved UX/UI direction and implementation plan for the
ANGLE back-office Catalogue workspace.

Read this file completely before editing.

This document is not authorization to commit, push, deploy, apply migrations,
change external services, delete production catalogue data, or absorb unrelated
working-tree changes. Implement only when the user explicitly asks you to do so.

## Approved visual references

Inspect all three images before implementation. Together they define one
Catalogue workspace, not three unrelated page designs.

### Items

`/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-e36bc37b-8dcc-4bdc-ac9c-ca9934e49ade.png`

This is the corrected Items reference. It supersedes the earlier version that
contained only `Add item` and omitted the category-creation action.

### Modifiers

`/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-6ddfcfea-840e-4656-9ff2-2eb9be84b212.png`

This reference defines the group table, selection-rule language, modifier price
deltas and selected-group drawer.

### Stations

`/Users/enotov/.codex/generated_images/019f9c68-58d8-7520-a67a-347f11fb19d2/exec-85760964-f03c-4ac0-bd5a-1d97b0fb1395.png`

This reference defines preparation routing, assigned-item visibility and the
distinction between preparation stations and POS devices.

The required header hierarchy is explicit:

- secondary outlined button `Add category`;
- primary dark button `Add item`;
- both visible at the same time on desktop;
- do not hide category creation inside an overflow menu;
- do not add a `Categories` top-level tab merely to expose creation.

The images are structural and visual references, not literal data contracts.
Use real ANGLE fields, permissions, RPCs and business rules. Do not display
invented channel controls, states, counts, prices or actions just because they
appear in the concept image.

Also read and reconcile this plan with:

- `docs/claude-angle-platform-backoffice-master-plan.md`
- `docs/claude-backoffice-current-audit-plan-2026-08-02.md`
- `docs/claude-backoffice-improvement-plan.md`
- `docs/claude-product-separation-plan.md`

The platform plan owns the shared ANGLE shell. This file owns the Catalogue
workspace structure, density, interactions and acceptance criteria.

## Working-tree safety

At the time this plan was written, the repository had multiple untracked user
files and planning documents. Run `git status --short` before any edit.

Never overwrite, revert, delete, stage or silently include unrelated changes.
Catalogue work overlaps shared files such as `App.jsx`, `styles.css`, routing
and UI primitives; reconcile active work deliberately.

## Product intent

Catalogue is the universal source-of-truth workspace for everything a business
sells or exposes to a customer. Restaurant items are the first use case, not
the permanent limit of the product.

The structure must be able to grow toward:

- restaurant dishes and drinks;
- retail products and variants;
- service items and durations;
- location-specific availability;
- different sales surfaces and future channels;
- modifiers, options, preparation stations and fulfilment metadata when the
  business type supports them.

Do not rename the universal module to `Menu`. Restaurant-specific concepts can
exist inside it as capabilities, but the main workspace remains `Catalogue`.

Catalogue must answer, at a glance:

- what the item is;
- where it belongs;
- how it is identified;
- what it costs, including variants;
- whether it is currently available;
- what information is missing;
- where it is exposed, but only when real channel data exists;
- what will change before a bulk action is applied.

The page is an operational data workspace, not a gallery, a menu preview or a
marketing page.

## Current implementation: preserve before redesigning

Primary repository:

`/Users/enotov/Desktop/anglesite`

Inspect at minimum:

- `backoffice/src/MenuManager.jsx`
- `backoffice/src/ItemEditor.jsx`
- `backoffice/src/catalog.js`
- `backoffice/src/menu.js`
- `backoffice/src/MenuManager.test.js`
- `backoffice/src/catalog.test.js`
- `backoffice/src/App.jsx`
- `backoffice/src/routing.js`
- `backoffice/src/styles.css`
- shared components under `backoffice/src/ui/`

The current implementation already contains working behavior that must not be
lost in a visual rewrite:

- URL-backed top-level tabs: `Items`, `Modifiers`, `Stations`;
- catalogue search across name, description, SKU and category;
- category, availability and completeness filters;
- `Needs attention` derived from missing price, photo or description;
- flat `List` and `By category` modes;
- manual ordering inside a category;
- explicit keyboard-accessible up/down ordering buttons;
- item creation and editing;
- category creation scoped to a location;
- variants/sizes;
- modifier-group assignments;
- station assignment;
- image upload and removal;
- bulk hide/show, move-to-category and percentage price changes;
- mandatory bulk preview with `from -> to` values;
- warning that variants change too;
- exact affected-item count;
- undo where the server model makes undo truthful;
- honest non-undo behavior for percentage price changes;
- tests that render all three tabs and protect against whole-page crashes.

Do not replace these with static mock data or decorative controls.

## Important truthfulness constraint: Channels

The approved mockup shows a `Channels` column and POS / QR Menu / Online
controls. The current `menu_items` query and `save_menu_item` payload expose a
single `is_available` value, not verified per-channel visibility.

Therefore:

1. Audit the real schema, RPC contracts and capabilities first.
2. If per-channel visibility does not exist, omit the `Channels` column and
   controls in this implementation.
3. Do not infer three independent channels from one `is_available` boolean.
4. Do not render always-checked fake boxes.
5. If channel support is requested later, treat it as a separate backend and
   product phase with an explicit data model, permissions, migration, RPC and
   cross-client release plan.

The same rule applies to any concept-only action such as `Duplicate`, `Archive`
or multi-location overrides. Use it only when the server supports it safely.

## Approved visual direction

- calm, compact, Square-inspired operational density without copying Square;
- shared ANGLE shell and navigation;
- warm off-white application background;
- white work surfaces;
- near-black/navy text;
- subtle gray borders;
- restrained cobalt selection and focus;
- semantic green, amber, gray and red states;
- 36-40 px desktop controls;
- table rows around 56-64 px where thumbnails are present;
- 8/12/16/24 spacing rhythm;
- minimal shadows;
- no KPI cards above the catalogue;
- no large product cards or photo gallery as the default management view;
- no gradients, glassmorphism, neon, 3D or decorative AI-looking elements;
- no giant mobile-style buttons on desktop;
- no controls whose purpose is discoverable only through an icon.

## Target workspace structure

### 1. Shared ANGLE shell

Use the grouped, capability-aware platform navigation from the approved master
plan. `Catalogue` is selected under `Manage`.

Do not build a Catalogue-specific navigation shell.

### 2. Page header

One compact desktop row contains:

- page title `Catalogue`;
- current location selector;
- search field with placeholder similar to `Search items, SKU or barcode`;
- secondary `Add category` button;
- primary `Add item` button.

Requirements:

- both creation actions are visible without opening a menu;
- `Add item` is visually primary because it is used more often;
- `Add category` remains easy to discover and has a text label;
- search can shrink within a sensible min/max width but must not push actions
  outside the viewport;
- the current location remains obvious because category and item ownership can
  depend on it;
- capability restrictions hide or disable creation honestly, with an
  explanation where needed.

On smaller screens, actions may wrap or move into a compact sticky action area,
but neither creation path may disappear.

### 3. Top-level tabs

Keep exactly the real tabs:

- `Items`;
- `Modifiers`;
- `Stations`.

Do not add a fake `Categories` tab. Category creation and management belong to
the Items workflow unless a future product decision explicitly promotes them
to a real workspace.

The existing deep link must keep working:

`/account?view=menu&tab=stations`

Reload and browser Back/Forward must restore the selected tab.

### 4. Filter toolbar

Use one compact toolbar below the top-level tabs:

- category filter;
- availability/status filter;
- `Needs attention` filter with a real computed count;
- optional sort control, but only for real sort modes;
- `Select` to enter bulk-selection mode;
- clear/reset action only when a filter is active;
- compact result count.

Do not duplicate search in both the header and toolbar.

`Needs attention` is derived from current rules in `catalog.js`:

- missing or zero price;
- missing photo;
- missing description.

Do not hard-code the count shown in the mockup.

If filter persistence is added, use URL state intentionally and test reload,
Back and Forward. Do not produce half-persistent state where the tab survives
but filters silently reset without a product decision.

## Items table

The default Items view is a compact data table, not a gallery.

### Truthful columns for the current model

Recommended current columns:

- selection checkbox, only in selection mode or in a conventional table header;
- thumbnail;
- Item;
- Category;
- SKU;
- Price;
- Availability;
- Completeness/status;
- Actions.

Add `Station` only if it remains useful at the current viewport width. Add
`Channels` only after the truthfulness constraint above has been satisfied.

### Row requirements

- fixed thumbnail box around 44-48 px;
- `object-fit: cover` or another consistent crop policy;
- image container never changes row geometry while loading;
- item name is the primary text;
- variants show a truthful range or base price plus a secondary `N sizes` label;
- SKU is visible and searchable;
- category is visible without opening the item;
- availability is text plus semantic color, not color alone;
- `Needs attention` is amber and includes the actual missing fields in accessible
  text or secondary detail;
- hidden/unavailable is neutral gray, not an error-red state;
- true blocking errors use red;
- one compact overflow menu holds low-frequency/destructive actions;
- selected row uses a restrained cobalt outline/tint;
- loading skeleton uses final row geometry;
- empty, filtered-empty, permission and failed states are distinct.

Use the shared currency formatter and locale behavior. Do not hard-code the
visual mockup's currency order if it conflicts with current ANGLE locale rules.

### Table semantics and keyboard behavior

Do not create a clickable `role="button"` row that contains other buttons.
That pattern causes nested-interactive semantics and keyboard-event bubbling.

Prefer a semantic `<table>` with:

- a real text button/link in the Item cell that opens details;
- separate checkbox, order and overflow controls;
- visible focus rings;
- `Enter` and `Space` activating the focused control only;
- no arrow action that also opens the item drawer;
- focus restored to the originating item control when the drawer closes.

### Manual order

Ordering is meaningful within a category, not across a flat mixed-category
search result.

Therefore use one of these truthful patterns:

- keep manual up/down controls in `By category` mode; or
- show them in the table only when exactly one category is selected and the
  sort mode is `Manual`.

Do not implement the mockup's global arrow column in a way that reorders items
across unrelated categories.

Buttons must work with mouse, touch, `Enter` and `Space`. The first Up and last
Down action are disabled with accessible names.

## Item details and editing

### Desktop interaction

Selecting an item opens a right-side drawer around 420-520 px while preserving:

- table context;
- current filters;
- selection state;
- table scroll position;
- the highlighted source row.

The read view should summarize only real data:

- photo;
- item name;
- category;
- SKU;
- availability;
- completeness warnings;
- description;
- base price or variants/sizes;
- station when applicable;
- modifier groups when applicable.

Primary action: `Edit item`.

Low-frequency actions may appear in an overflow menu only when supported.
Do not add `Duplicate`, `Archive` or per-channel toggles without verified API
behavior.

### Edit mode

The current `ItemEditor` is a centered modal. Replace it carefully with either:

- edit mode inside the same drawer; or
- a wider right-side editor drawer that preserves the catalogue behind it.

Do not lose existing fields or validation:

- name;
- base price;
- category;
- SKU;
- station;
- availability;
- description;
- photo upload/replace/remove;
- variants and default variant;
- modifier-group assignment;
- ask-modifiers behavior;
- deletion confirmation for an existing item.

Keep save errors inside the drawer near the affected workflow. Disable close or
warn appropriately while a save/upload is in flight. Escape closes only when it
is safe, and focus returns to the source item.

### Mobile behavior

On mobile the drawer becomes a full-height sheet/page with safe-area padding,
sticky header and sticky save actions. The catalogue behind it must not scroll.

Inputs must remain at least 16 px text size on iOS to avoid unwanted zoom.

## Category creation and management

`Add category` opens a compact, explicit category-creation dialog or drawer.

Required fields and behavior:

- category name;
- location selector only when more than one location is available;
- current location preselected;
- clear Cancel and Add category actions;
- inline validation;
- busy state that prevents duplicate submission;
- server error displayed in the dialog;
- success closes the dialog, refreshes data and makes the new category
  immediately selectable.

Do not leave category creation as a small inline input that unpredictably shifts
the toolbar.

Preserve `By category` as the operational place for:

- manual item ordering;
- empty-category visibility;
- expand/collapse;
- category-level actions.

If category rename is exposed, first confirm `updateCategory` is correctly wired
and tested. Category deletion must retain its current warning that items remain
but lose their category. Never make destructive category actions primary.

## Bulk actions

Keep selection as an explicit mode so normal row interaction remains simple.

Required bulk operations currently supported:

- hide;
- put on sale;
- move to category;
- percentage price change.

Before Apply, show a review step containing:

- every selected item affected;
- exact `from -> to` value;
- no-op rows distinguished from changed rows;
- `N sizes change too` for items with variants;
- exact button label such as `Apply to 3 items`;
- server error without losing the preview.

Do not claim that a percentage price change is perfectly undoable. Preserve the
current honest message about rounding to agorot. Availability/category undo may
remain only where `undoPlan` can restore all changed rows truthfully.

## Modifiers workspace

Modifiers is a structured options workspace. A modifier group defines the
selection rule; an individual modifier defines one available choice and its
price delta. The UI must make this distinction obvious.

### Real current model

Verify the current queries and mutation functions, but the repository already
exposes these concepts:

- modifier-group name;
- minimum selection;
- maximum selection;
- group sort order;
- modifier name;
- price delta in agorot;
- default modifier;
- modifier availability;
- modifier sort order;
- item-to-modifier-group assignments.

`createModifierGroup`, `updateModifierGroup`, `deleteModifierGroup`,
`createModifier`, `updateModifier` and `deleteModifier` exist in `menu.js`.
Their presence does not replace end-to-end verification of permissions, payload
shape, errors and refresh behavior.

### Modifiers header

When `Modifiers` is selected, the contextual header contains:

- the shared `Catalogue` title;
- current location context;
- search `Search groups or modifiers`;
- one primary action `Add modifier group`.

Do not show `Add item` or `Add category` on this tab. Do not make the user type a
new group name into an always-visible inline field that shifts the toolbar.

### Modifiers toolbar

Use compact, truthful controls:

- group/usage filter only if it filters real data;
- `Needs attention` with a computed count;
- sort control only for supported sort modes;
- real group count;
- clear/reset only when filters are active.

Search must include group names and modifier names. If usage counts are derived
client-side from item assignments, calculate them once with stable memoized
maps rather than scanning every item for every rendered row.

### Modifier-group table

The desktop table uses these columns when supported:

- Group;
- Selection rule;
- Modifiers;
- Used by;
- Status/attention;
- Actions.

Selection rules must be translated into natural language:

- `min=0, max=1` -> `Optional · up to 1`;
- `min=1, max=1` -> `Required · choose 1`;
- `min=0, max=3` -> `Optional · up to 3`;
- rules with a real unlimited representation -> `Optional · unlimited`;
- otherwise show an accurate `Choose N-M` form.

Do not describe a rule as unlimited unless the server contract actually has an
unlimited representation.

`Needs attention` may cover real actionable problems such as:

- group has no modifiers;
- minimum is greater than maximum;
- required group has no available/default choice;
- default modifier is unavailable;
- other verified integrity problem.

Do not invent a group-level `Active` field if it does not exist. If the visual
reference's green `Active` badge cannot be backed by a truthful condition,
replace it with a real completeness state or omit the column.

### Selected modifier-group drawer

Selecting a group opens a right-side drawer while preserving table search,
scroll and selection.

Show:

- group name;
- human-readable selection rule;
- minimum and maximum values;
- real item usage count;
- modifier list;
- modifier price delta;
- default choice;
- availability;
- modifier order controls;
- `Add modifier`;
- `Edit group`;
- low-frequency delete action in overflow.

Price is always shown as a delta:

- `No extra charge` for zero;
- `+₪3` for a positive delta;
- a negative value only if the server and product intentionally support it.

Never present a modifier delta as if it were the item's base price.

### Add/edit modifier group

Use a compact drawer or dialog with:

- group name;
- minimum selection;
- maximum selection;
- natural-language preview of the rule;
- validation preventing impossible rules;
- Cancel and Save/Add actions;
- busy state preventing duplicate submission;
- server errors inside the form.

### Add/edit modifier

Use an explicit form rather than `window.prompt` or a toolbar-expanding inline
row. Preserve:

- modifier name;
- extra price in shekels converted safely to agorot;
- default choice;
- availability when supported;
- order;
- group ownership.

Changing the default must not leave multiple defaults unless that is explicitly
allowed by the current server contract. Deleting a group remains destructive
and must clearly state that its modifiers are deleted too.

### Modifiers accessibility

- a group row has one explicit details control;
- modifier order buttons are separate interactive elements;
- Enter/Space on order controls must not open the parent drawer;
- rules and statuses are expressed as text, not color alone;
- drawer close restores focus to the group row;
- form errors are associated with their fields or announced in an alert region.

## Stations workspace

A station is a preparation-routing destination such as Bar, Hot kitchen, Cold
kitchen or Bakery. It is not a register, terminal, printer, device-health row
or employee workstation.

### Real current model

The current application exposes:

- station id;
- station name;
- location ownership;
- sort order;
- item `station_id` assignment;
- `createStation`, `updateStation` and `deleteStation` mutations.

Assigned-item counts and examples may be derived from the already-loaded Items
data. Do not invent hardware or operational telemetry.

### Stations header

When `Stations` is selected, the contextual header contains:

- shared `Catalogue` title;
- current location context;
- search `Search stations or assigned items`;
- one primary action `Add station`.

Do not show Items or Modifiers creation actions on this tab.

Add one restrained explanatory line:

`Preparation stations route sold items to the right team. They are not POS devices.`

This prevents a predictable collision with the separate `Devices` module.

### Unassigned items

Compute the real count of catalogue items with no preparation station where a
station is relevant. Show a slim amber attention strip:

`N catalogue items have no preparation station`

Provide a clear `Review items` action that applies the real filter or navigates
to a supported assignment workflow. Do not show a hard-coded count. Do not use
red unless the missing assignment truly blocks sale or fulfilment.

The helper text must remain honest: unassigned items can remain visible for sale
but are not routed to a preparation team, if that matches actual runtime
behavior.

### Stations table

Use a compact table:

- Order;
- Station;
- Assigned items;
- Item examples;
- Actions.

Rows show a small neutral preparation/routing icon, not a register, screen,
printer or online-status symbol.

Manual order buttons operate on the full station ID list expected by the server.
They must work with mouse, touch, Enter and Space. First Up and last Down are
disabled. Do not use drag-and-drop as the only ordering mechanism.

Do not add unsupported columns such as:

- online/offline;
- printer connection;
- device serial number;
- ticket speed;
- production performance;
- staff currently assigned;
- hardware health.

### Selected station drawer

Selecting a station opens a right-side drawer containing:

- station name;
- label `Preparation station`;
- real assigned-item count;
- `Rename` or `Edit station` backed by `updateStation`;
- searchable list of assigned items;
- compact item thumbnail, name, category and price;
- explicit `Unassign` control;
- `Manage assigned items`;
- explanation of the effect of leaving an item unassigned;
- station deletion in overflow, not as a primary red button.

If bulk assign/unassign is not supported by an atomic backend operation, do not
fake it. Either use the verified `save_menu_item` mutation per item with clear
partial-failure handling, or keep assignment inside the existing item editor
until a safe bulk contract exists.

Deleting a station must explain what happens to currently assigned items. Do
not assume cascade, nulling or blocking behavior; verify the database contract.

### Add/edit station

Use a compact dialog or drawer with:

- station name;
- location when multiple locations are present;
- current location preselected;
- validation and duplicate-submission protection;
- Cancel and Save/Add actions;
- server error shown in context.

Do not keep station creation as an unlabeled plus beside an always-visible input.

### Shared behavior across all three tabs

- retain the shared compact header and tab system;
- contextual creation actions change with the selected tab;
- reuse table density, drawers and form controls;
- preserve every supported CRUD workflow;
- preserve empty, filtered-empty, loading and error states;
- never show Items bulk controls inside Modifiers or Stations;
- do not invent restaurant-only controls for businesses without the capability;
- switching `Items -> Modifiers -> Stations -> Items` must never crash;
- returning to Items must not corrupt its filters, selection or scroll state.

## Responsive requirements

### Desktop, 1280 px and wider

- Items header, search and both creation buttons fit without clipping;
- Modifiers and Stations show their single contextual creation action;
- table and details drawer coexist;
- no horizontal page overflow;
- sticky table header where useful;
- drawers do not cover navigation.

### Tablet, roughly 768-1279 px

- preserve the most important columns;
- lower-priority fields may move into secondary row text;
- details drawer may overlay content but must have a clear close action;
- toolbar wraps intentionally, not one control at a time.

### Mobile, below roughly 768 px

- no squeezed desktop table with unreadable columns;
- use compact semantic lists appropriate to each tab: item, modifier group or
  preparation station;
- filters open in a compact sheet if they cannot fit;
- each tab's contextual creation actions remain discoverable;
- item, modifier-group and station drawers become full-height and safe-area
  aware;
- no control or text leaves the viewport;
- test at 320, 375 and 430 CSS px widths.

## Loading, images and performance

- reserve thumbnail dimensions before images load;
- use lazy loading for off-screen thumbnails;
- avoid reloading the entire catalogue for a purely local drawer open/close;
- do not make item images flash when filters or selection mode change;
- keep row keys stable;
- avoid layout shifts when status text or variant count appears;
- preserve user scroll position after save where practical;
- show a focused row-level or drawer-level busy state instead of blanking the
  whole page for every mutation;
- maintain current correctness if optimistic updates are introduced; otherwise
  prefer a reliable targeted reload.

## Accessibility requirements

- semantic table on desktop;
- every icon button has a stable accessible name;
- text accompanies every status color;
- focus is visible on all controls;
- drawers/dialogs have an accessible name;
- Escape closes the topmost non-busy overlay;
- focus is trapped appropriately inside a modal/full-screen mobile editor;
- focus returns to the originating control;
- category and item forms expose labels, errors and busy states;
- row details, checkboxes, order buttons and overflow menus do not trigger one
  another through event bubbling;
- reduced-motion users do not receive unnecessary drawer animation.

## Implementation phases

### Phase 0: truth audit and regression baseline

Before visual work:

1. Record `git status --short`.
2. Run the existing Catalogue tests and production build.
3. Map every proposed column/action to a real field or API.
4. Explicitly mark concept-only features, especially Channels, Duplicate and
   Archive.
5. Verify current URL tabs and multi-location behavior.
6. Capture desktop and mobile screenshots of the current Catalogue.

Deliverable: a short written field/action matrix and passing baseline, not UI
changes.

### Phase 1: header, tabs and toolbar

Implement:

- compact Catalogue header;
- location context;
- one search field;
- contextual search and creation actions:
  - Items: `Add category` and `Add item`;
  - Modifiers: `Add modifier group`;
  - Stations: `Add station`;
- current three tabs;
- compact, truthful filters and result count.

Do not change data mutations in this phase.

### Phase 2: Items table

Implement:

- stable table geometry;
- thumbnails;
- current truthful columns;
- status/completeness badges;
- selection state;
- responsive column reduction;
- loading, empty, filtered-empty and error states.

Keep manual ordering in a truthful category context.

### Phase 3: details and editor drawer

Implement:

- selected-row state;
- read-only details drawer;
- edit mode with all current ItemEditor capabilities;
- safe close, Escape, focus return and scroll preservation;
- mobile full-height behavior.

No data-field regression is acceptable.

### Phase 4: category and bulk workflows

Implement:

- explicit Add category dialog/drawer;
- current location handling;
- category management in By category mode;
- bulk-action bar;
- review step and exact affected count;
- truthful undo/result messaging;
- keyboard/touch ordering.

### Phase 5: Modifiers workspace

Implement the approved Modifiers reference:

- searchable group table;
- computed selection-rule labels;
- real modifier and usage counts;
- truthful Needs attention logic;
- selected-group drawer;
- group add/edit flow;
- modifier add/edit flow;
- price deltas, defaults and availability;
- keyboard/touch order controls;
- destructive group action with an explicit consequence warning.

Preserve the existing RPC/API contracts and all tab-render regression tests.

### Phase 6: Stations workspace

Implement the approved Stations reference:

- clear preparation-routing explanation;
- real unassigned-item count and review path;
- compact station table;
- assigned-item counts and examples;
- selected-station drawer;
- add/rename workflow;
- safe assignment/unassignment behavior;
- verified delete consequence;
- keyboard/touch station order controls.

Do not add hardware/device fields.

### Phase 7: design-system cleanup and verification

Bring all three tabs into the same density and component system without
changing their domain meaning. Extract only reusable primitives proven by the
three real Catalogue tabs; do not build speculative abstractions.

Run automated and manual acceptance below. Fix regressions before proposing a
commit. Do not commit/push/deploy unless separately authorized.

## Automated verification

At minimum keep and extend tests for:

- `Items -> Modifiers -> Stations -> Items` on populated data;
- all three tabs on empty data;
- Modifiers never rendering Items bulk actions;
- search by name, description, SKU and category;
- availability and `Needs attention` filters;
- real Needs attention count;
- price/variant display;
- both `Add category` and `Add item` rendered with unique accessible names;
- category dialog location default and validation;
- item drawer open/close and focus return;
- item form field preservation;
- selection-mode entry and exit;
- bulk preview from/to values;
- variant warning `N sizes change too`;
- exact changed-item count;
- honest non-undo result for price changes;
- order buttons producing the correct complete category ID list;
- Enter/Space on order buttons reordering without opening item details;
- current route opening `tab=stations` after reload;
- no unsupported Channels UI when the backend field is absent;
- `Add modifier group` rendered only on Modifiers;
- modifier search matching both group and option names;
- natural-language rules for verified min/max combinations;
- impossible modifier-group rules rejected;
- empty groups receiving a truthful Needs attention state;
- modifier delta formatting, including zero and positive amounts;
- only one default option when the contract requires it;
- modifier order buttons producing the correct ordered ID list;
- Enter/Space on modifier order controls not opening group details;
- `Add station` rendered only on Stations;
- real assigned and unassigned item counts;
- station search matching station and assigned-item names;
- station order buttons producing the correct complete ID list;
- Enter/Space on station order controls not opening station details;
- station deletion consequence matching the verified database behavior;
- no device connectivity or hardware-health UI inside Stations.

Use existing test infrastructure. Add focused unit/component tests rather than
one brittle snapshot of the entire page.

## Manual acceptance

Test with the signed-in developer account and a safe test item/category.

### Desktop: Items

1. Open Catalogue Items.
2. Confirm search, `Add category` and `Add item` fit on one header row.
3. Search by a real SKU.
4. Filter Needs attention and verify every result states what is missing.
5. Open an item and confirm the table does not disappear or jump.
6. Close with Escape and verify focus/scroll restoration.
7. Edit description, photo, SKU, station, availability and variants without
   losing existing modifier groups.
8. Add a category and verify it appears in filters and item editing.
9. Select one item and preview `Change price +5%`; compare before/after and the
   exact affected count before applying.
10. Verify an item with sizes states that its sizes change too.
11. Use order arrows with mouse and keyboard in the valid category context.
12. Reload `?view=menu&tab=stations` and verify the Stations tab remains active.

### Desktop: Modifiers

1. Open Modifiers and confirm only `Add modifier group` is shown.
2. Search by a modifier name and verify its parent group appears.
3. Open a group and compare the natural-language rule with min/max values.
4. Add a safe test group and verify impossible min/max combinations are blocked.
5. Add free and paid modifiers; verify `No extra charge` and `+₪N` formatting.
6. Set/change the default and verify the saved result after reload.
7. Reorder modifiers with mouse and keyboard without opening the group drawer.
8. Close the drawer with Escape and verify focus returns to the group.
9. Verify an empty group is actionable through Needs attention.
10. Do not delete a production group during visual acceptance.

### Desktop: Stations

1. Open Stations and confirm only `Add station` is shown.
2. Confirm the page explicitly distinguishes stations from POS devices.
3. Compare assigned/unassigned counts with real item `station_id` values.
4. Use `Review items` and confirm it opens a real filtered/assignment workflow.
5. Open a station and verify assigned items, category and prices.
6. Rename a safe test station and confirm the value after reload.
7. Reorder stations with mouse and keyboard without opening station details.
8. Assign and unassign only a dedicated test item; verify the station count and
   item editor agree after reload.
9. Verify deletion explains the actual effect on assigned items; do not confirm
   deletion of a production station.
10. Confirm no printer, online/offline or hardware-health fields appear.

Do not apply destructive or irreversible actions to real production items for
visual acceptance. Use a dedicated test item where mutation is necessary.

### Tablet and mobile

1. Verify 768 px, 430 px, 375 px and 320 px widths.
2. Confirm no horizontal page overflow.
3. Confirm every tab's contextual creation actions remain reachable.
4. Confirm filters, row actions and status labels are readable.
5. Open item, modifier-group and station drawers; verify each fills the usable
   viewport and does not sit under browser chrome or safe-area insets.
6. Upload/replace a test photo and verify image geometry remains stable.
7. Switch all three tabs and return without a white screen or lost state.

## Definition of done

Catalogue is complete only when:

- it visibly matches the approved ANGLE/Square-like compact direction;
- `Add category` and `Add item` are both explicit and accessible;
- `Add modifier group` and `Add station` appear in the correct contextual tabs;
- no current Catalogue capability is lost;
- the default management view is a fast table, not a card gallery;
- all displayed fields and actions are backed by real data and permissions;
- Needs attention is truthful and actionable;
- item details/editing preserve table context;
- manual order remains scoped to categories;
- bulk price changes remain previewed and honest about undo;
- Modifiers use clear group rules, deltas, defaults and usage context;
- Stations clearly represent preparation routing, assignments and unassigned
  items without pretending to be Devices;
- desktop, tablet and mobile layouts do not overflow;
- keyboard and screen-reader interactions are valid;
- automated tests and the production build pass;
- manual smoke evidence is recorded;
- no unrelated working-tree files were changed;
- commit, push and deploy occur only after explicit user authorization.

## Required Claude handoff report

When implementation is finished, report:

1. files changed;
2. real fields/actions implemented versus concept-only items omitted;
3. automated tests and build commands with results;
4. desktop/mobile manual checks performed;
5. remaining limitations or follow-up backend work;
6. exact working-tree status;
7. whether anything was committed, pushed or deployed.
