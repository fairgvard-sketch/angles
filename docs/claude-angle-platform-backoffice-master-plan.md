# ANGLE back office: platform UX master plan for Claude

## How to use this document

Read this file completely before making changes. Treat it as the product and UX
direction for the ANGLE owner back office. It does not authorize an immediate
full rewrite, production deployment, database migration, or push.

Before implementation, reconcile this plan with the current source and with:

- `docs/claude-backoffice-current-audit-plan-2026-08-02.md`
- `docs/claude-backoffice-improvement-plan.md`
- `docs/claude-product-separation-plan.md`
- `docs/claude-angle-reserve-improvement-plan.md`
- `docs/reserve-audit-phase0.md`

The current audit plan owns confirmed release defects. This document owns the
long-term platform structure, design system, navigation, and execution order.
Do not reimplement work that already exists on `main`.

## Mission

Turn the ANGLE back office into a calm, dependable, fast operational workspace
that can reach the usability level of Square while preserving ANGLE's own
identity and restaurant strengths.

ANGLE starts with restaurants, but it must be able to grow into a broader
operating platform for local businesses. Do not design the shared shell, shared
data concepts, or navigation as if every future customer will be a restaurant.

The desired product model is:

1. a stable platform core;
2. optional vertical modules;
3. separately sellable online products/add-ons;
4. one account, organization, location, customer, catalogue, permission, and
   reporting foundation.

## UX reference direction

Use the following references for principles, not pixel copying:

- Square Dashboard: back-office hierarchy, density, predictability, tables,
  filters, progressive disclosure, and operational confidence;
- Wolt: guest-facing menu, cart, checkout flow, and motion quality;
- INNO: restaurant branding and visual customization;
- ANGLE: one coherent platform connecting POS, online channels, customers,
  reservations, devices, and reporting.

For this task, Square is the primary back-office reference.

## Non-goals

Do not:

- copy Square's visual design or protected assets;
- build Retail, Services, Loyalty, or Delivery functionality now;
- replace the application with a new framework;
- perform a mass rewrite;
- create a second implementation of shared entities for each vertical;
- make navigation visibility the only authorization layer;
- add payments, deposits, WhatsApp, or Telegram;
- rewrite historical migrations;
- mutate production customer, order, reservation, or fiscal data for testing;
- change DNS, deploy, commit, or push without explicit user authorization.

## Product architecture

### Platform core

These concepts must remain usable across business types:

- Dashboard
- Locations
- Orders
- Catalogue
- Customers
- Team
- Devices
- Reports
- Integrations
- Settings

### Optional modules

Modules are enabled through products/add-ons, entitlements, and permissions.

Restaurant:

- Floor
- Tables and zones
- Reservations
- Kitchen/KDS
- restaurant fulfilment and service modes

Online:

- QR Menu
- Online Ordering
- Booking Page
- custom domain and embed tools

Possible future modules, architecture only for now:

- Retail: inventory, suppliers, barcode workflows;
- Services: calendar, staff, bookable services and resources;
- Loyalty: rewards, customer segments and campaigns;
- Delivery: zones, couriers and delivery lifecycle.

### Shared-language rule

Use universal nouns in the platform core and vertical nouns inside a module.

Examples:

- Core entity: `Customer`; restaurant presentation may say `Guest`.
- Core entity: `Catalogue`; restaurant channel may say `Menu`.
- Core entity: `Booking`; Restaurant may say `Reservation`.
- Core entity: `Resource`; Restaurant presents it as a `Table`; a future
  Services module could present it as a staff member or room.

Do not rename internal entities or database tables merely for cosmetic reasons.
First document the existing model and introduce presentation-level vocabulary
only where it reduces coupling safely.

## Product principles

1. One clear primary task per page.
2. One primary CTA; secondary actions are compact or placed in an overflow
   menu.
3. Dense does not mean cramped. Desktop screens should show useful information
   without oversized mobile-style controls.
4. Details and edits should usually open in a side drawer so the user retains
   list, filter, and scroll context.
5. Complexity should appear progressively, not all at once.
6. Every action must expose its scope: organization, location, device, channel,
   or current user.
7. Every destructive or immediately published action must explain its effect
   and offer recovery when feasible.
8. Empty, loading, offline, permission-denied, stale-data, partial-failure, and
   success states are part of the product, not edge cases.
9. URL state, browser Back/Forward, keyboard focus, and scroll restoration must
   be predictable.
10. A standalone Menu or Reserve customer must never be told that POS is
    required unless a specific feature actually depends on POS.

## Target information architecture

The final navigation is capability-aware and omits empty groups.

### Work

- Dashboard
- Orders
- Reservations, when Restaurant/Reserve is enabled
- Floor, when Restaurant POS is enabled

### Sales and customers

- Sales
- Reports, only when it is a real working destination
- Customers
- Activity

### Management

- Catalogue
- Locations
- Team
- Devices

### Online

- QR Menu
- Online Ordering
- Booking Page
- Integrations, only when a real integration exists

### System

- Settings
- Help

The exact labels may be refined after a source audit and usability check, but
the separation between core, vertical, and online modules must remain.

## Design-system requirements

Create or consolidate shared primitives before polishing individual pages:

- AppShell
- Sidebar and mobile navigation
- PageHeader
- Tabs
- Button and IconButton
- Card and MetricCard
- DataTable
- FilterBar and SearchField
- FormField, Select, RadioGroup, Checkbox and Switch
- Modal, Drawer and Popover
- Toast and inline feedback
- ConfirmationDialog
- StatusBadge
- EmptyState, ErrorState and PermissionState
- Skeleton and progress indicators

### Base visual rules

- spacing scale: 4, 8, 12, 16, 24, 32;
- compact control: 32-36 px;
- default desktop control: about 40 px;
- minimum touch target: 44 by 44 px;
- large buttons only for the primary action;
- consistent typography, radii, borders and shadows;
- minimal nested cards and decorative containers;
- no content touching viewport or card edges;
- no accidental horizontal overflow;
- visible focus, hover, active, selected, disabled and loading states;
- equivalent RTL and LTR quality;
- respect `prefers-reduced-motion`.

Avoid page-specific CSS patches when a shared component or token is the real
solution.

## Execution plan

### Phase 0: reconcile source, production and existing work

Before editing:

1. Read repository instructions, README, package scripts, relevant source, and
   recent history.
2. Run `git status --short` and preserve all user-owned changes and untracked
   files.
3. Map every current back-office route, query parameter, permission,
   entitlement, layout component, and responsive breakpoint.
4. Compare current `main`, `origin/main`, and production asset/version.
5. Read the existing plans listed at the top and mark every item as:
   implemented, partially implemented, still reproducible, obsolete, or owned
   by another plan.
6. Capture baseline desktop, tablet, and mobile screenshots for primary pages.
7. Run baseline tests, typecheck/lint when configured, and production build.
8. Produce `docs/backoffice-platform-phase0.md` with findings before broad UI
   changes.

Acceptance:

- no already-fixed defect is implemented again;
- current production mismatch or stale-cache behavior is identified;
- responsibilities between `anglesite` and `/Users/enotov/Desktop/kassa` are
  explicit;
- no production data is changed.

### Phase 1: design tokens and shared components

1. Inventory duplicated buttons, inputs, cards, tabs, tables and dialog styles.
2. Introduce or consolidate tokens without visually rewriting every page in one
   diff.
3. Build shared primitives with accessible semantics.
4. Add component tests or focused render tests for critical states.
5. Migrate one representative page first to validate the system.

Acceptance:

- repeated controls share one implementation;
- RTL/LTR, keyboard focus and responsive states work;
- existing business behavior remains unchanged;
- no large global CSS regression.

### Phase 2: application shell and navigation

Implement a stable Square-like work shell:

- compact grouped sidebar;
- consistent page header;
- location switcher in the header;
- profile/account actions;
- Help and diagnostics;
- stable content region;
- mobile navigation designed for mobile rather than scaled desktop.

Routing requirements:

- preserve existing links or provide intentional redirects;
- keep `view`, `tab`, `loc`, date, filters and selection in URL state where
  appropriate;
- browser Back/Forward restores the expected page state;
- new destinations start at the top;
- Back/Forward may restore prior scroll;
- sidebar/header must not flash or remount unnecessarily;
- capability filtering must not leave empty group headings.

### Phase 3: Dashboard

The Dashboard must answer within a few seconds:

- what is happening now;
- what needs attention;
- how many orders/bookings are expected today;
- whether a shift is open;
- whether devices are offline or outdated;
- whether catalogue or online-channel changes are unpublished;
- what the owner should do next.

Use entitlement-aware widgets:

- Today
- Needs attention
- Orders
- Reservations
- Devices
- Online channels
- Quick actions

Do not show restaurant metrics to accounts without the relevant module.

### Phase 4: Reservations as a Restaurant/Reserve module

Preserve Timeline, List, Waitlist, Tables and zones, and Analytics, while making
the host workflow clearer.

Timeline requirements:

- sticky time scale and resource labels;
- selected service day has bounded geometry;
- no previous-day leak except a legitimate crossing-midnight interval;
- clear current-time marker;
- visually distinct status and conflict states;
- predictable zoom/scale;
- booking details in a drawer;
- conflict explanation plus available alternatives;
- explicit server-selected table behavior.

Forms:

- preserve entered data after server errors;
- show validation next to the field;
- explain the scope and consequence of editing time/table/status;
- keep New reservation and Walk-in intentionally different;
- do not create real production visits during automated or exploratory testing.

### Phase 5: Catalogue

Make the default mode a compact management surface, not a gallery.

Required behavior:

- search by name, SKU/article and barcode where data exists;
- useful filters including Needs attention;
- compact table/list for bulk work;
- optional visual preview;
- bulk selection and actions in one stable toolbar;
- preview `before -> after` for bulk price changes;
- exact affected item and size/variant counts;
- reorder controls usable without drag and drop;
- recoverability through Undo or an explicit change log where feasible;
- clear publication/channel status.

Catalogue is the platform entity. Menu is a restaurant-facing sales channel or
presentation of catalogue data.

### Phase 6: Customers

Create one coherent customer workspace:

- identity and contact data;
- visits, orders and bookings;
- spend/summary where correctly defined;
- notes and tags;
- consent;
- future loyalty extension point.

Requirements:

- fast search and filtering;
- details/editing in a drawer when possible;
- merge preview with explicit survivor and removed profile;
- irreversible actions require strong confirmation;
- merged-away profiles disappear consistently from back office and POS search;
- important changes are auditable;
- use dedicated test customers for destructive smoke tests.

### Phase 7: Devices

Display for each terminal:

- friendly name;
- location;
- active/offline/archived state;
- last activity;
- application version;
- service-worker/update state when available;
- human-readable problem reason;
- recommended next action.

Separate Active, Offline and Archived. Archiving must not be presented as
remote disabling unless it actually disables the terminal.

### Phase 8: QR Menu and Online products

Treat these as separately sellable products/add-ons, not subordinate settings
that require POS.

Provide:

- channel/product status;
- location context;
- custom domain;
- QR links and downloads;
- embed snippets;
- publication and last-update status;
- real phone preview;
- deliberate Menu/Booking preview switch;
- `Open as guest`;
- loading and failure states;
- readiness checklist containing real blockers only.

The preview iframe must not steal focus, move parent scroll, or fail silently.

### Phase 9: Team, permissions and settings

Team:

- clear role presets;
- understandable permission groups;
- correct radio/checkbox semantics;
- effective-access preview before saving;
- server authorization remains authoritative.

Settings:

- searchable categories;
- clear organization/location/device scope;
- protection against losing unsaved changes;
- inline save status and actionable errors;
- avoid one giant undifferentiated settings form.

### Phase 10: responsive adaptation

Desktop:

- compact tables and filter bars;
- drawers and split working areas;
- high useful density without crowding.

Tablet:

- deliberate split view;
- touch-friendly controls;
- no overflow or clipped actions.

Mobile:

- sequential full-screen tasks;
- one primary action per screen;
- bottom/sticky actions never cover content;
- tabs remain usable on one line or collapse intentionally;
- forms fit dynamic viewport and keyboard states;
- urgent actions remain possible without recreating the desktop experience.

### Phase 11: accessibility, performance and resilience

Verify:

- full keyboard operation;
- logical focus order and focus restoration;
- meaningful accessible names;
- correct radio, checkbox, tab and dialog semantics;
- sufficient contrast;
- reduced-motion behavior;
- screen-reader announcements for saving and errors;
- no navigation layout shift or whole-page flashing;
- skeletons match final geometry;
- large modules are lazy-loaded without visible flicker;
- data requests are deduplicated and stale states are explained;
- an error boundary prevents one module from blanking the whole workspace.

### Phase 12: end-to-end acceptance

Run a read-only or test-data-backed manual journey for:

1. sign-in and location switching;
2. browser Back/Forward and deep links;
3. new reservation, Walk-in, conflict and edit-conflict handling;
4. reservation timeline/list/waitlist/analytics;
5. catalogue search, Needs attention and safe bulk-change preview;
6. customer edit and test-customer duplicate merge;
7. terminal rename, archive, show archived and restore;
8. QR Menu and Booking preview, custom-domain and QR link generation;
9. Team permissions;
10. Help and copied diagnostics;
11. desktop, tablet and mobile layouts;
12. RTL and LTR;
13. refresh, offline/stale data and recoverable errors;
14. production build and browser console.

## Quality gates

A phase is not complete unless:

- the primary task is obvious without explanation;
- there is no accidental horizontal overflow;
- there is no route-change flash or large layout shift;
- controls use the shared design system;
- important actions are reachable within two or three intentional steps;
- server errors do not erase valid form input;
- unavailable modules are not shown as working destinations;
- URL and Back/Forward behavior are verified;
- keyboard and mobile behavior are verified;
- tests and production build pass;
- no new console errors appear on affected routes.

## Working and commit protocol

Do not implement all phases in one diff.

Use this order:

1. Phase 0 audit and reconciliation.
2. Confirmed release blockers from the current audit plan.
3. Design tokens and representative components.
4. App shell and navigation.
5. Dashboard.
6. Reservations.
7. Catalogue.
8. Customers and Devices.
9. QR Menu and Online.
10. Team, Settings, responsive, accessibility and final polish.

For every phase:

1. state the user problem and acceptance criteria;
2. list intended files before editing;
3. keep the diff independently reviewable;
4. run the relevant focused tests;
5. run the configured full test/typecheck/lint suite;
6. run the production build;
7. report changed files, test results, remaining risk, and manual checks;
8. do not commit, push, deploy, apply migrations, or change external services
   until the user explicitly authorizes that action.

## Definition of 10/10

The ANGLE back office is not 10/10 because it contains every possible feature.
It reaches that standard when an owner or manager can reliably understand the
business, find a problem, complete the main task, recover from mistakes, and
move between products without learning a different interface each time.

The final experience should feel like one platform whose restaurant module is
exceptionally strong, not a restaurant-only application that will need to be
rebuilt before ANGLE can serve another type of business.
