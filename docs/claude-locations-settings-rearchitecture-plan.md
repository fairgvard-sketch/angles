# Claude master brief — Locations, Settings, Loyalty and Fiscal reports

Read this document completely before changing code. This is a staged product rearchitecture, not permission for a single large rewrite.

## Exact prompt for Claude

> Read `docs/claude-locations-settings-rearchitecture-plan.md` completely and use it as the source of truth. First perform Phase 0 and report the real data scopes, permissions, receipt snapshot behavior, routes and migration dependencies. Then implement Release A only: reorganise Locations around location-specific settings, move the existing Loyalty UI under Customers, move Fiscal export under a real Reports section, and turn Settings into a useful global account/business/products surface using only existing safe data contracts. Preserve all existing behavior, capability gating, unsaved-change protection and legacy URLs. Do not create migrations, change fiscal calculations, move database columns, alter issued documents, invent editable controls without RPC support, or implement Legal entities/organisation-wide Loyalty in Release A. Stop and request explicit approval before Release B, which may introduce forward-only schema changes, legal-entity modelling, fiscal snapshots/audit and organisation loyalty defaults. Protect unrelated dirty files. Verify desktop/tablet/mobile, accessibility, focused tests, the full test suite and production build. Do not commit, push or deploy unless I explicitly ask after reviewing the result. At handoff, report changed files, tests, screenshots, compatibility redirects, remaining risks and the exact Release B proposal.

## Product objective

Fix the information architecture of ANGLE backoffice so each section answers one clear question:

- `Settings`: how the organisation and my account are configured;
- `Locations`: how a specific physical location operates;
- `Customers`: who the customers are and how Loyalty works;
- `Reports`: what happened and what must be exported;
- `Devices`: how a specific terminal behaves;
- `QR Menu & Online`: how guest channels behave.

Locations must stop being a container for every feature that happens to store a `location_id`.

## Product decisions

### Move out of Locations

1. `Loyalty` moves to Customers.
2. `Fiscal export` moves to Reports.

### Keep in Locations

1. location identity and public details;
2. service mode and location operational defaults;
3. receipt appearance/contact overrides;
4. VAT and current legal receipt linkage until the Legal entities model is approved;
5. POS defaults that apply to every register at that location.

### Move to Settings only after safe modelling

1. organisation profile;
2. legal entities and protected tax identity;
3. products/add-ons;
4. personal account/security;
5. future billing/payout settings.

Do not put Fiscal export in Settings. It is a report action, not configuration.

Do not put location-level POS defaults in global Settings.

## Current functional source of truth

Read before editing:

- `backoffice/src/LocationSettings.jsx`
- `backoffice/src/settings.js`
- `backoffice/src/navigation.js`
- `backoffice/src/navigation.test.js`
- routing logic and tests used by `backoffice/src/App.jsx`
- `backoffice/src/App.jsx`, especially:
  - `SalesOverview` integration;
  - planned Reports behavior;
  - `AccountSettingsPage`;
  - product cards;
- `backoffice/src/GuestsManager.jsx`
- `backoffice/src/customers.js`
- `backoffice/src/guests.js`
- customer/routing/browser tests
- `backoffice/src/SalesOverview.jsx`
- `backoffice/src/reporting.js`
- `backoffice/src/QrChannels.jsx`
- `backoffice/src/DevicesManager.jsx`
- shared Tabs, Drawer, FormDialog, ConfirmDialog, Layout and Button primitives
- receipt/fiscal document creation and persistence code in the POS repository/workspace
- migrations/RPC definitions for:
  - `update_location_config_web`;
  - `patch_location_settings_web`;
  - Uniform Format export;
  - fiscal document storage;
  - loyalty earning/redemption;
  - organisation and location membership.

Search every usage of:

- `LOCATION_TABS`
- `visibleLocationTabs`
- `updateLocationConfig`
- `patchLocationSettings`
- `runUfExport`
- `loyalty_mode`
- `loyalty_stamps_goal`
- `loyalty_points_percent`
- `loyalty_points_min_redeem`
- `loyalty_stamps`
- `receipt_business_name`
- `receipt_tax_id`
- `receipt_address`
- `vat_rate`
- fiscal document/invoice snapshot fields
- `view=locations`
- `view=guests`
- `view=sales`
- `view=reports`
- `view=account`

## Non-negotiable safety rules

1. Issued receipts, invoices, refunds and fiscal exports must never change when settings change later.
2. Do not assume fiscal snapshots exist. Verify them in Phase 0.
3. If issued documents currently read mutable location fields at render/export time, stop and report a release-blocking compliance risk before moving legal fields.
4. Release A must not create or modify database migrations, RPCs, triggers or schema version.
5. Release A must not move database columns; it moves presentation/navigation only.
6. Preserve integer-agorot money handling.
7. Preserve all fiscal calculations, document numbering and Uniform Format generation.
8. Preserve Loyalty earning, redemption, balances and category eligibility.
9. Preserve current location scope honestly. Do not label per-location Loyalty as organisation-wide.
10. Preserve current capability/RLS enforcement. Navigation visibility is not authorization.
11. Preserve unsaved-change protection in Location settings.
12. Do not add editable organisation/legal fields unless a safe authorised RPC already exists.
13. Do not create fake save buttons or optimistic UI over read-only data.
14. Tax ID and legal identity editing must not be silently broadened to managers/staff.
15. Do not add bank-account/payout fields in this task.
16. Do not add notification, marketing, CRM, accounting or billing features that do not exist.
17. Do not touch unrelated dirty files.
18. Do not commit, push or deploy until explicitly requested.

## Target navigation

### Insights

- `Reports`

Reports contains exactly:

1. `Sales`
2. `Fiscal`

The existing approved Sales UI remains the Sales report. Do not redesign it as part of this task beyond the minimum shell integration.

Remove the duplicate standalone Sales navigation item only when the Reports route and redirects are proven. Preserve `view=sales` as a compatibility route to Reports → Sales.

### Manage

- Catalogue
- Locations
- Team

### Customers

Customers contains exactly:

1. `Directory`
2. `Loyalty`

The current customer list/duplicates/profile behavior remains inside Directory.

### Settings

Settings contains:

1. `Business`
2. `Products`
3. `Account & security`

`Legal & tax` is added in Release B only after the data model and permissions are approved. Do not expose an empty or misleading tab in Release A.

## Target Locations information architecture — Release A

Visible tabs:

1. `Details`
2. `Receipts & tax`
3. `POS defaults`

Do not show Loyalty or Fiscal export.

### Details

Keep and clearly scope:

- internal location name;
- guest-facing display name;
- service mode;
- current location VAT field until Release B determines the tax-profile model.

If safe existing fields already provide location address, public phone, timezone or currency, show them here. Do not invent storage or duplicate receipt-only address into a new canonical field without an approved migration.

Use scope copy:

> Applies to [Location] only — other locations are configured separately.

### Receipts & tax

Keep current per-location data and behavior:

- business/legal name printed on receipt;
- Tax ID;
- receipt address;
- receipt phone;
- receipt footer;
- print modifiers;
- receipt copies.

But visually separate two subsections:

#### Legal details

- business/legal name;
- Tax ID;
- receipt/legal address.

#### Receipt appearance and contact

- public receipt phone;
- footer;
- modifier visibility;
- copies.

Release A requirements:

- label the scope truthfully as location-specific because that is how data is currently stored;
- add clear copy that changes affect future receipts only only if snapshot behavior is verified;
- if snapshot behavior is not verified, do not add that promise;
- preserve Save/dirty/error behavior;
- do not create a legal-entity selector yet;
- do not move Tax ID into global Settings yet.

### POS defaults

Keep current location-wide register defaults:

- default opening float;
- close-shift reminder;
- business-day cutoff;
- cash warning threshold;
- All items tab visibility;
- Inventory visibility.

Clarify that these apply to all registers at the selected location.

Do not move device-local printer profiles, quick amounts, customer display or auto-lock settings here. They remain terminal/device settings.

### Capability behavior

- Details remains visible to every account with a location.
- Receipts & tax and POS defaults retain current POS capability gating unless Phase 0 proves a more precise existing capability.
- Non-POS Menu/Reserve accounts must not see POS configuration promises.

## Target Customers information architecture — Release A

### Directory

Preserve all approved/current customer behavior:

- search;
- segments and tags;
- duplicate management;
- profile drawer;
- orders and Loyalty log;
- edit, merge and erasure;
- addressable legacy duplicate state.

### Loyalty

Move the current Loyalty editor from Locations without changing its storage or server behavior.

Preserve:

- Off / Stamps / Points;
- stamps goal;
- categories that earn stamps;
- points cashback percentage;
- minimum redeem amount;
- validation;
- category update errors;
- Save/dirty/error states;
- POS capability gating.

Because Release A remains per-location, Loyalty must include:

- a visible location selector for multi-location organisations;
- current location name in the section heading/scope line;
- explicit copy `Applies to [Location] only`;
- no language implying one organisation-wide programme;
- warning when different locations have different modes, if this can be determined from existing data without new backend work.

Do not create email/SMS campaigns, coupons, tiers, birthdays or manual balance adjustment.

### Customer route compatibility

Choose stable routing that does not destroy the existing duplicates view.

Recommended:

- `view=guests&tab=directory`
- `view=guests&tab=loyalty`
- `view=guests&tab=directory&mode=duplicates`

Preserve legacy `view=guests&tab=duplicates` by mapping it to Directory/duplicates without reload loops.

## Target Reports information architecture — Release A

### Sales

Reuse the current Sales report and approved Sales redesign contract.

Preserve:

- periods and comparison;
- server scope;
- location selection;
- chart;
- all breakdowns;
- CSV;
- permissions and loading/error states.

### Fiscal

Move the current Fiscal export out of Locations and preserve:

- previous calendar month default;
- From/To dates;
- validation;
- location-scoped server generation;
- missing Tax ID error;
- INI.TXT;
- BKMVDATA.zip;
- record count and returned range;
- control report by document type;
- no-documents state;
- base64 download and object URL cleanup.

Add:

- required location selector at the report level;
- clear selected-location scope;
- link to the selected location’s Receipts & tax settings when Tax ID is missing;
- concise explanation that this is Uniform Format 1.31 for the Israeli Tax Authority.

Do not add filing/submission to the Tax Authority. ANGLE currently generates files only.

### Reports capability

- Reports is visible to accounts with `pos_reports`.
- Fiscal generation may require a stricter existing server permission; preserve it.
- Do not expose Reports to Menu/Reserve-only accounts unless they have a real reporting capability.

### Report route compatibility

Recommended canonical routes:

- `view=reports&tab=sales`
- `view=reports&tab=fiscal`

Compatibility:

- `view=sales` → Reports/Sales;
- `view=locations&tab=export` → Reports/Fiscal with the same selected location;
- Back/Forward and reload remain stable;
- no redirect/render loops.

## Target Settings information architecture — Release A

Settings must become useful without pretending unavailable features exist.

### Business

Show existing organisation-level facts:

- organisation name;
- account/workspace type where relevant;
- default brand/logo only if an existing safe data contract already exists;
- existing organisation contact/default fields only if they are truly organisation-scoped.

Editing rule:

- if a safe update RPC exists and Phase 0 confirms permissions, implement editing;
- otherwise present values honestly as read-only and state where they currently come from;
- do not repurpose location fields as organisation fields.

Do not show Tax ID here in Release A because it is currently location-scoped.

### Products

Move/reuse the current product cards and preserve:

- ANGLE Menu;
- ANGLE Orders;
- ANGLE Reserve;
- ANGLE POS;
- Developer/Active/Included/Pending/Add-on states;
- product request behavior;
- capability-derived visibility.

Do not invent pricing, card payment or subscription cancellation if not implemented.

### Account & security

Preserve current:

- signed-in email;
- current membership/role if available;
- sign out.

Show password, MFA, session management or recovery controls only if real flows exist. No `Coming soon` form fields inside customer settings.

### Settings route compatibility

Recommended:

- `view=account&tab=business`
- `view=account&tab=products`
- `view=account&tab=account`

Legacy `view=account` opens a sensible default without breaking the account menu.

## Release B — gated schema/product work

Do not implement Release B without explicit approval after Release A review.

### Legal entities

Target model:

```text
Organisation
├── Legal entity A
│   ├── legal name
│   ├── Tax ID
│   ├── legal address
│   └── fiscal settings/numbering scope
├── Legal entity B
└── Locations
    ├── Location 1 → Entity A
    └── Location 2 → Entity B
```

Before designing the migration, determine:

- whether one organisation can legally contain multiple Tax IDs;
- whether document numbering is per terminal, location or legal entity;
- how historical fiscal documents store issuer data;
- how refunds reference historical issuer data;
- how Uniform Format export groups legal entities;
- whether POS startup/schema guard requires a coordinated release.

Required safety for protected legal edits:

- Owner-only server authorization;
- step-up confirmation using a real existing authentication mechanism;
- explicit old/new preview;
- audit record with actor/time;
- changes apply only to future documents;
- historical receipts/invoices/refunds remain immutable;
- Tax ID change may require creating a new legal entity instead of overwriting the old one.

Do not claim compliance without an Israel-focused accounting/legal review.

### Organisation Loyalty with location overrides

Recommended target:

- organisation-wide customer balances;
- one default programme at organisation level;
- optional per-location earning/redeeming overrides;
- explicit scope and inheritance UI;
- future `loyalty_manage` capability/add-on entitlement;
- migration/backfill from current location columns;
- defined behavior when locations currently have conflicting modes.

Before migration, decide:

- whether points earned at one location can be redeemed at another;
- whether Stamps and Points can coexist across locations;
- how eligible categories map when catalogue/category scope differs;
- how an account turns Loyalty off without losing balances/history;
- how Menu/Orders/Reserve-only products interact with Loyalty.

### Settings after Release B

Add a real `Legal & tax` tab only after the model exists:

- legal-entity list;
- protected editor;
- assigned locations;
- tax identity status;
- no fiscal export controls.

Future banking/payout details belong to a separate protected `Billing & payouts` surface, not Receipts or Locations.

## Visual and UX rules

- Follow the established ANGLE/Square-inspired system.
- Keep navigation labels plain and task-oriented.
- Compact controls, thin cool-gray borders, dark navy text, restrained cobalt focus/selection.
- No oversized buttons, decorative KPI cards, gradients or heavy shadows.
- Use one clear primary action per screen.
- Scope is always visible: organisation, legal entity or location.
- Location selectors appear only when multiple locations exist, except Fiscal where scope must always be unambiguous.
- Forms use existing dirty-state protection and Saved/error feedback.
- Destructive/protected changes use explicit confirmation.
- Mobile has no horizontal page overflow at 390 px.
- Honor `prefers-reduced-motion`.

## Accessibility requirements

- All tab sets use correct semantics and keyboard navigation.
- Scope selectors have programmatic labels.
- Form fields retain visible labels and useful hints.
- Saved uses a status/live region.
- Errors use `role="alert"`.
- Unsaved-change dialog traps/restores focus correctly.
- Compatibility redirects do not steal focus unexpectedly.
- Downloads have clear accessible names and disabled states.
- Legal/protected state is not indicated by color alone.
- Focus is visible and contrast meets WCAG AA.

## Phase 0 — mandatory audit and stop report

Before code changes, report:

1. every current Location field and its actual DB scope;
2. current role/RPC authorization for each edit/export;
3. whether issued fiscal documents snapshot legal name, Tax ID, address, VAT and location name;
4. whether printed/reopened receipts read historical fields or live location fields;
5. whether Uniform Format export reads document snapshots or live location config;
6. current Loyalty balance scope and earning/redemption rules;
7. current URL/tab contracts;
8. current capability visibility;
9. dirty-worktree files to protect;
10. baseline test/build results.

If fiscal immutability cannot be proven, stop Release A before moving/editing legal fields and report the blocker. Loyalty and Fiscal navigation can still be planned, but do not make unsafe legal claims.

## Release A implementation phases

### Phase A1 — routing and navigation contracts

1. Add real Reports routing/tabs.
2. Add Customers Directory/Loyalty routing without breaking duplicates.
3. Add Settings Business/Products/Account routing.
4. Define new Location tab keys.
5. Implement compatibility mappings and tests before moving components.
6. Verify reload and Back/Forward.

### Phase A2 — move Fiscal to Reports

1. Extract/reuse Fiscal export without changing generation logic.
2. Add truthful report-level location scope.
3. Preserve every result/download/error state.
4. Add missing-Tax-ID navigation back to selected location.
5. Remove Fiscal tab from Locations only after the new route works.

### Phase A3 — move Loyalty to Customers

1. Extract/reuse Loyalty editor.
2. Add explicit location scope.
3. Preserve category eligibility and all validations.
4. Preserve customer Directory/duplicates/profile behavior.
5. Remove Loyalty tab from Locations only after the new route works.

### Phase A4 — simplify Locations

1. Implement Details, Receipts & tax and POS defaults.
2. Visually separate legal from presentation fields.
3. Preserve capability filtering.
4. Preserve dirty-state/leave confirmation.
5. Verify location switching with dirty forms.
6. Do not move DB fields.

### Phase A5 — fill Settings with real functions

1. Implement Business with real organisation data only.
2. Move/reuse Products card.
3. Implement Account & security with existing account behavior.
4. Do not create empty fake controls.
5. Preserve account menu and sign-out behavior.

### Phase A6 — responsive/accessibility pass

Verify:

- 390 px;
- 768 px;
- 1024 px;
- wide desktop;
- keyboard navigation;
- focus restoration;
- long Hebrew/English legal and location names;
- one and many locations;
- reduced motion;
- 200% zoom.

### Phase A7 — verification

Run at minimum:

```bash
npm test
npm run build
```

Also run focused routing, navigation, Location, Customer/Loyalty, reporting and fiscal-export tests throughout.

Review the final diff for:

- altered RPC inputs;
- changed fiscal values/files;
- missing document rows;
- changed Loyalty behavior;
- scope lies;
- broken duplicate routing;
- capability regressions;
- lost unsaved-change protection;
- fake Settings controls;
- migrations or unrelated churn.

## Release A acceptance checklist

### Navigation

- [ ] Locations shows only Details, Receipts & tax, POS defaults.
- [ ] Customers shows Directory and Loyalty.
- [ ] Reports shows Sales and Fiscal.
- [ ] Settings shows Business, Products, Account & security.
- [ ] Legacy URLs open the correct new destination.
- [ ] Reload and Back/Forward work.

### Locations

- [ ] Every existing location configuration field remains reachable.
- [ ] Legal fields and receipt appearance are visually separated.
- [ ] Scope names the selected location.
- [ ] POS-only tabs remain hidden without POS capability.
- [ ] Unsaved-change protection works across tabs, location changes and browser close.

### Loyalty

- [ ] Existing mode, stamps, points and category behavior is unchanged.
- [ ] Current location scope is explicit.
- [ ] Multi-location switching is correct.
- [ ] Customer Directory, duplicates and profile remain intact.

### Fiscal

- [ ] Export bytes/results match the existing implementation for the same location/period.
- [ ] INI.TXT and BKMVDATA.zip download.
- [ ] Control report matches.
- [ ] Missing Tax ID links to the correct location.
- [ ] No filing/submission is implied.

### Settings

- [ ] Business shows only real organisation-scoped data.
- [ ] Products states/actions are preserved.
- [ ] Account email/role/sign-out work.
- [ ] No nonfunctional editable controls are shown.

### Safety/regression

- [ ] Existing fiscal documents remain unchanged.
- [ ] POS receives the same location settings.
- [ ] Loyalty balances/events are unchanged.
- [ ] No migration/schema bump was added.
- [ ] Full tests and production build pass.

## Required Claude handoff after Release A

Before asking for commit/push/deploy, provide:

1. Phase 0 findings;
2. concise Release A summary;
3. exact changed files;
4. test/build commands and results;
5. desktop/tablet/mobile screenshots of Locations, Customers/Loyalty, Reports/Fiscal and Settings;
6. compatibility redirect table;
7. confirmation that no migration/RPC/fiscal/Loyalty logic changed;
8. known limitations;
9. a separate Release B proposal with schema/RPC/version impact;
10. authenticated manual acceptance steps.
