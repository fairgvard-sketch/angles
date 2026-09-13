# Claude implementation brief — Customers redesign

Read this document completely before changing code. Then inspect the current implementation and execute the work phase by phase.

## Objective

Redesign the ANGLE backoffice `Customers` section according to the approved visual reference while preserving all current customer, loyalty, duplicate-management and privacy behavior.

Customers is an organisation-wide customer database. It is not scoped to one location and it is not a marketing CRM.

## Approved reference

- `docs/design-references/customers-approved.png`

Use the image for visual hierarchy, density, list columns, segment chips, selected-row state and profile-drawer composition.

The image contains example names and values only. Production values must always come from the existing RPC responses and helpers.

## Functional source of truth

Read before editing:

- `backoffice/src/GuestsManager.jsx`
- `backoffice/src/guests.js`
- `backoffice/src/customers.js`
- customer-related styles in `backoffice/src/styles.css`
- `backoffice/src/customers.test.js`
- customer-related navigation tests and route handling
- shared UI components used by the page:
  - `backoffice/src/ui/Drawer.jsx`
  - `backoffice/src/ui/Tabs.jsx`
  - `backoffice/src/ui/ConfirmDialog.jsx`
  - `backoffice/src/ui/Button.jsx`

Search for all usages of these RPCs before editing:

- `get_backoffice_guests`
- `get_guest_tags_web`
- `get_guest_card`
- `find_guest_duplicates_web`
- `set_guest_profile`
- `merge_guests_web`
- `anonymize_guest_web`

If the mockup conflicts with working server behavior, preserve the behavior and adapt the presentation.

## Non-negotiable product rules

1. Do not add an `Add customer` action. Customers appear through the existing POS/loyalty flows.
2. Do not add email, SMS, WhatsApp, Telegram, campaigns, coupons, memberships or marketing automation.
3. Do not add manual points, stamps or balance adjustment in the backoffice.
4. Keep Customers organisation-wide. Do not add a location selector that implies location filtering.
5. Preserve server-side search, segments, tags and sorting.
6. Preserve the 300 ms search debounce.
7. Preserve the current 200-row server limit and do not invent client pagination without backend support.
8. Preserve the addressable duplicates view through the existing URL tab state.
9. Preserve profile editing, duplicate merging and personal-data erasure exactly, including server validation and human-readable errors.
10. Merging and erasing remain explicitly irreversible operations with confirmation.
11. Orders and receipts remain after anonymisation because they are accounting records.
12. Do not add migrations, RPCs, schema-version changes or backend permissions.
13. Do not weaken RLS or treat navigation visibility as authorization.
14. Do not redesign Orders, Reservations or the POS customer search as part of this task.
15. Do not touch unrelated dirty files.
16. Do not commit, push or deploy until the user explicitly asks after reviewing the implementation.

## Existing functionality that must remain

### Customer list

- Server-side search by name or phone.
- Server-side segment filters:
  - `Everyone`
  - `Regulars`
  - `Top spenders`
  - `Seen this month`
  - `Lapsed`
- Multi-select tag filters with organisation-wide tag counts.
- Server-side sorting:
  - `Last visit`
  - `Total spent`
  - `Visits`
  - `Newest`
  - `Name`
- Loaded customer count and segment summary.
- Refresh of the list, tags and duplicate suggestions.
- Empty, filtered-empty, loading and error states.
- Opening a customer profile from the full row.

### Loyalty values

- Support both points and stamps modes.
- The organisation’s loyalty mode is currently learned from the first opened customer card.
- Before the mode is known, retain the existing safe fallback that shows a non-zero stamps balance or points balance.
- Do not hard-code points mode from the visual reference.
- Money remains stored as integer agorot and displayed through `formatMoney`.

### CSV export

Preserve:

- export of exactly the currently loaded filtered rows;
- UTF-8 BOM for Hebrew names in Excel;
- CRLF rows;
- CSV escaping;
- timezone-aware last-visit and customer-since dates;
- name, phone, visits, spend, points, stamps, dates, tags and notes;
- disabled export when the current list is empty;
- current filename convention;
- object URL cleanup.

### Customer profile drawer

Preserve:

- lazy card loading by customer ID;
- name and formatted phone in the drawer header;
- Edit action;
- points/stamps, visits, total spent and last visit;
- reservation summary:
  - total visits;
  - upcoming bookings;
  - no-shows;
  - cancellations;
  - preferred zone;
  - average party size;
- internal tags and notes;
- usually ordered items;
- exactly two history tabs:
  - `Orders`
  - `Loyalty log`
- order number, date, total and expandable item composition;
- variant names and loyalty-discount rows;
- points/stamps event deltas;
- loading, empty and error states;
- close behavior and focus management supplied by the shared Drawer.

### Profile editing

Preserve:

- editing name;
- editing phone;
- normalising phone input to digits;
- only sending a phone value when it actually changed;
- editing internal tags and note;
- tag parsing, de-duplication, length limits and maximum count;
- explicit Cancel and Save states;
- server errors such as `phone_taken`, `phone_invalid`, `too_many_tags`, merged/anonymised profile and insufficient permission;
- refreshing the card, list, tags and duplicates after a successful change.

Do not expose tags or notes to guests.

### Duplicate profiles

Preserve:

- the addressable `duplicates` view;
- the possible-duplicates count and `Back to list` behavior;
- duplicate reasons;
- explicit radio selection of the profile to keep;
- preview of visits, spend, notes, tags and old-number behavior;
- confirmation naming both the kept profile and the profiles disappearing from the list;
- old phone numbers continuing to resolve to the merged target;
- sequential pairwise merges and honest partial-error handling;
- refreshed list/tag/duplicate data after merging;
- the `No duplicates left` exit state.

### Personal-data erasure

Preserve:

- the privacy action at the bottom of the profile, separated from Edit;
- explicit explanation of what will be erased;
- explicit explanation that accounting records and the unclaimable loyalty balance remain;
- phone-number confirmation;
- upcoming-reservation blocker;
- irreversible warning and server error mapping;
- closing/removing the profile after successful anonymisation.

## Target layout

### Header

- Title: `Customers`.
- Description: `Loyalty members, their visits and what they buy.`
- No global location selector.
- Right actions:
  - compact secondary `Export CSV`;
  - icon-only refresh with accessible name and loading state.
- No primary create button.

### Toolbar

Use one compact row on desktop:

1. wide search field with placeholder `Name or phone`;
2. sort selector;
3. `Possible duplicates (N)` when suggestions exist or the duplicate view is active;
4. quiet loaded-customer count aligned to the end.

The count is the number of currently loaded customers, not an invented database total.

### Segments and tags

- Preset segments use a single-select radiogroup.
- Tags remain independent multi-select chips using `aria-pressed`.
- Visually distinguish tag chips subtly without turning every tag into a bright color.
- Keep chips compact and horizontally scrollable on narrow screens.
- Show tag counts without making them look like notification alerts.

### Customer list

Use one bordered list panel with stable desktop columns:

1. `Customer`
2. `Loyalty`
3. `Visits`
4. `Total spent`
5. `Last visit`

Row rules:

- entire row remains one accessible button;
- show name, formatted phone and compact tags in the customer cell;
- loyalty cell adapts to points or stamps mode;
- numeric values align consistently;
- selected/open customer has a subtle pale-blue state and focus outline;
- no avatar photos;
- no checkbox;
- no overflow menu;
- no row actions;
- long names, phones and tags truncate or wrap safely;
- approximately 68–74 px high on desktop.

The approved image has slight example-column ambiguity. Implement the semantic column mapping listed above, not the accidental pixel placement in the generated image.

### Profile drawer

Use the existing shared Drawer and the approved right-side composition.

- Width approximately 420–460 px on a wide desktop.
- Header with name, phone, Edit and close.
- Compact 2×2 statistics grid.
- Bookings, Tags, Internal note and Usually orders are separate quiet sections, not giant cards.
- Orders/Loyalty log tabs remain in one row.
- Order rows remain expandable and keyboard operable.
- Privacy stays at the bottom with clear visual separation.
- Do not make the drawer wider than the list on normal desktop widths.

On mobile, use the Drawer’s full-screen/overlay behavior rather than squeezing a side-by-side layout.

## Visual rules

- Follow `customers-approved.png` and the established ANGLE/Square-inspired system.
- Use existing design tokens and shared primitives.
- White canvas and surfaces, thin cool-gray borders, dark ink text and restrained blue active/focus states.
- Compact 40 px toolbar controls.
- Quiet tag and status treatments.
- Consistent Lucide outline icons.
- No gradients, glassmorphism, decorative shapes, KPI cards, charts, oversized shadows or giant buttons.
- Do not introduce hard-coded sample customers into production code.
- Avoid inline styles where reusable CSS belongs in `styles.css`.
- Honor `prefers-reduced-motion`.

## Accessibility requirements

- Search retains a programmatic label.
- Sort retains a programmatic label.
- Segment controls remain a radiogroup with `role="radio"` and `aria-checked`.
- Tags retain `aria-pressed`.
- Possible-duplicates toggle retains `aria-pressed` in duplicate view.
- Each customer row has a clear accessible name and visible keyboard focus.
- Drawer has an accessible title, closes with Escape and restores focus to the triggering row.
- Order expanders expose expanded/collapsed state programmatically.
- Duplicate keep-options remain a radiogroup.
- Confirmation dialogs remain focus-trapped and correctly labelled.
- Error messages retain `role="alert"`.
- Icon-only refresh and close actions have accessible names.
- Color is never the only signal for selected, warning or destructive state.
- Contrast meets WCAG AA.

## Responsive behavior

### Desktop

- List and drawer coexist without overlapping.
- Toolbar remains one clean row when space permits.
- Columns align and the selected row remains visible beside the drawer.

### Tablet

- Toolbar may wrap into two rows.
- List may reduce secondary tag content before removing essential columns.
- Drawer may overlay rather than permanently consume half the viewport.

### Mobile

- No horizontal page overflow at 390 px.
- Search is full width.
- Sort and duplicate action fit below it.
- Segment/tag chips scroll horizontally in one row or two clearly separated rows.
- Customer rows become compact stacked summaries instead of a compressed desktop table.
- Opening a customer uses a full-screen drawer/sheet.
- Drawer close, Edit, history tabs and Privacy remain reachable.
- Safe-area insets are respected.

## Implementation phases

### Phase 0 — baseline

1. Read all listed files and tests.
2. Record `git status` and protect unrelated work.
3. Run focused customer tests.
4. Capture current list, duplicate view, profile drawer, Edit, merge confirmation and erase panel if the local app/session allows it.
5. Confirm current route/tab behavior for `list` and `duplicates`.

### Phase 1 — list information architecture

1. Implement the approved header and toolbar arrangement.
2. Preserve all server-driven state and debounce behavior.
3. Separate preset segments from tag chips visually while keeping current semantics.
4. Implement stable semantic list columns.
5. Preserve all empty/loading/error states.

### Phase 2 — profile drawer

1. Apply the approved compact drawer hierarchy.
2. Preserve all statistics, reservation details, tags, notes, favorites and history.
3. Keep order expansion and loyalty mode behavior.
4. Verify Edit and reload flows.
5. Keep Privacy at the bottom and separated.

### Phase 3 — duplicate and privacy flows

1. Restyle duplicate groups consistently without changing selection or merge behavior.
2. Keep full consequence previews and confirmation text.
3. Verify sequential merges and partial errors.
4. Verify erasure copy, phone confirmation and upcoming-reservation blocker.
5. Do not soften destructive warnings merely for visual compactness.

### Phase 4 — responsive and accessibility pass

1. Verify 390 px, 768 px, 1024 px and wide desktop.
2. Verify full keyboard flow through list, drawer, Edit, history, duplicates and dialogs.
3. Verify focus restoration after closing the drawer/dialog.
4. Test long names, phones, tags, notes and item names.
5. Test both points and stamps modes.
6. Verify reduced motion and high zoom.

### Phase 5 — verification

Run at minimum:

```bash
npm test
npm run build
```

Also run the narrowest customer tests throughout implementation.

Review the final diff for:

- invented CRM features;
- client-only search or segmentation;
- lost error mapping;
- weakened merge/erase confirmation;
- hard-coded loyalty mode;
- unrelated formatting churn.

## Acceptance checklist

### Search, filters and export

- [ ] Search remains debounced and server-side.
- [ ] All five preset segments work through server parameters.
- [ ] Multiple tags can be combined.
- [ ] All five sort modes work.
- [ ] Refresh updates list, tags and duplicates.
- [ ] CSV exports exactly the current loaded slice with BOM and CRLF.
- [ ] Export is disabled when the current list is empty.

### List and profile

- [ ] Row columns are semantically aligned.
- [ ] Entire rows are keyboard/click targets.
- [ ] Selected row state is visible.
- [ ] Points and stamps modes both render correctly.
- [ ] Profile shows visits, spend, last visit and loyalty balance.
- [ ] Reservation summary, tags, notes and favorites remain available.
- [ ] Orders expand and show items/variants/discounts.
- [ ] Loyalty log shows correct deltas.

### Editing, duplicates and privacy

- [ ] Name, phone, tags and note edit correctly.
- [ ] An unchanged phone is not resubmitted.
- [ ] Human-readable server errors remain specific.
- [ ] Duplicate view survives reload/deep linking.
- [ ] User explicitly chooses the profile to keep.
- [ ] Merge preview and confirmation name all consequences.
- [ ] Old phone numbers keep leading to the target profile after merge.
- [ ] Personal-data erasure requires the matching phone.
- [ ] Upcoming reservation prevents erasure with a clear message.
- [ ] Orders/receipts remain after erasure as required.

### Responsive and accessibility

- [ ] No horizontal overflow at 390 px.
- [ ] Segment and tag controls remain usable on touch screens.
- [ ] Drawer works as side panel on desktop and full-screen overlay on mobile.
- [ ] Escape closes drawer/dialog and focus returns correctly.
- [ ] All controls have visible focus and accessible names/states.
- [ ] Destructive actions are separated and not color-only.
- [ ] Contrast meets WCAG AA.

## Stop conditions

Stop and report before continuing if:

- a migration, RPC or backend change appears necessary;
- the approved design requires data absent from current RPC responses;
- a shared Drawer/Tabs change risks unrelated sections;
- unrelated dirty files overlap necessary edits;
- the existing merge or erase behavior differs materially from this document.

## Required handoff

After implementation, report:

1. changed files;
2. preserved server/RPC behavior;
3. how points and stamps modes were verified;
4. focused and full test/build commands with exact results;
5. manual checks for list, profile Edit, duplicates and privacy erasure;
6. desktop/tablet/mobile checks;
7. any intentional difference from the approved reference and why.

Do not commit, push or deploy until the user explicitly requests it.
