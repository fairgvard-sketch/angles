# Claude handoff: ANGLE products, standalone modules, and add-ons

## Objective

Separate ANGLE into four independently sellable products:

- `ANGLE POS`
- `ANGLE Menu`
- `ANGLE Orders`
- `ANGLE Reserve`

Every product must:

- be purchasable as the customer's first standalone product without POS;
- be attachable later to an existing ANGLE account as an add-on;
- use the same account, organization, locations, catalog, tables, and data;
- avoid a separate backend or duplicated domain data.

An add-on is not a separate technical edition of a product. For example,
`ANGLE Menu standalone` and `ANGLE Menu added to POS` must use the same `menu`
entitlement and the same implementation.

## Repositories

### POS and shared backend

Path: `/Users/enotov/Desktop/kassa`

Contains:

- React/Vite POS;
- Supabase migrations, RLS, RPCs, and Edge Functions;
- guest routes for menu, orders, and reservations.

Before modifying it, read completely:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `docs/architecture.md`
- `docs/development.md`
- `docs/database.md`
- `docs/online-orders.md`
- `docs/reservations.md`
- `docs/standalone-products.md`
- `docs/deployment.md`

### Marketing site and owner back office

Path: `/Users/enotov/Desktop/anglesite`

Contains:

- the ANGLE marketing site;
- the authenticated owner back office under `backoffice/`.

Before modifying either repository:

1. Inspect `git status`, the current branch, and recent commits.
2. Preserve every pre-existing untracked or modified file.
3. Never use destructive reset or checkout commands.
4. Work in small, independently verifiable phases and atomic commits.

At handoff time, the following untracked files exist in
`/Users/enotov/Desktop/kassa` and are user-owned. Do not edit, delete, rename,
stage, or commit them:

- `.claude/launch.json`
- `checks-log.txt`
- `docs/claude-handoff-standalone-digital-products.md`
- `run-phase1-push-and-pgtap.command`
- `src/assets/drinks/capuccino2.png`

Recheck the status before starting because it may have changed.

## Current implementation

Migration `100_module_entitlements.sql` already provides:

- `organization_products`;
- product keys `menu`, `online_orders`, `reservations`, and `pos`;
- `org_has_product`;
- server-side gates for online orders and reservations;
- digital-only onboarding;
- `products` in `get_backoffice_context`.

The owner back office already has module-aware navigation, an orders inbox,
a reservation desk, QR management, and a product card.

Current problems:

1. `bootstrap_org` automatically grants all four products.
2. `bootstrap_digital_org` trusts a product array from the browser and grants
   those products for free.
3. A sellable product and an internal technical capability are treated as the
   same concept.
4. POS catalog management can be confused with the public QR Menu product.
5. There is no safe post-sale provisioning path.
6. The current product card is mostly informational and does not represent a
   real product lifecycle.

## Scope locks

- Do not build subscription payments in this task.
- Do not build guest payments.
- Do not add WhatsApp or Telegram integrations.
- Do not build a second backend.
- Do not duplicate catalogs, locations, guests, tables, orders, or
  reservations per product.
- Do not delete data when a product is disabled.
- Do not allow an authenticated customer to grant themselves a product.
- Do not deploy migrations, Edge Functions, frontend builds, DNS changes, or
  production changes without explicit user approval for the concrete payload.

## Core model

Keep these concepts separate:

### Product

What the customer buys:

- POS
- Menu
- Orders
- Reserve

### Capability

What the purchased product technically permits.

### Entitlement

Which products a particular organization has been granted.

### Operational setting

Whether the restaurant has enabled the feature and whether it is currently
available.

For example:

```text
reservations entitlement is active
+ restaurant enabled reservations
+ current schedule allows reservations
= guest reservation flow is available
```

An operational `enabled` flag must never replace a commercial entitlement.

## Capability map

Use stable internal product keys even if the customer-facing names differ.

| Product key | Customer name | Capabilities |
|---|---|---|
| `pos` | ANGLE POS | catalog management, POS operation, shifts, receipts, POS reports |
| `menu` | ANGLE Menu | catalog management, public QR Menu |
| `online_orders` | ANGLE Orders | catalog management, public menu, cart, order submission, web orders inbox |
| `reservations` | ANGLE Reserve | reservation settings, public reservation flow, web host desk |

Important behavior:

- `ANGLE Orders` includes the technical public-menu capability without
  requiring the customer to purchase a second `ANGLE Menu` line item.
- POS without `menu` still permits management of the POS catalog.
- POS without `menu` does not expose a public QR Menu.
- Reserve does not require POS, Menu, or Orders.
- Any product may be the organization's first product.
- Any other product may later be added to the same organization.

## Developer account

Treat this existing account as an internal developer account:

```text
fairgvard@gmail.com
```

Requirements:

- all products are active indefinitely;
- no payment or expiration is required;
- all screens and combined flows are available for testing;
- the back office displays `Developer workspace`;
- do not implement a runtime check such as `if (email === ...)`;
- mark the organization itself as `developer` or `internal`;
- grant normal product entitlement rows with `source = developer`;
- prevent ordinary customer-facing mutation paths from disabling protected
  developer grants.

The email may be used only in a one-time migration to resolve the existing
user's organization. Runtime authorization must use `org_id`, the organization
type, and normal entitlement records.

Resolve the organization robustly through both JWT app metadata and
`organization_members`, because the account may have been created through
either the POS or digital onboarding path.

If the account cannot be found during migration, do not silently grant another
organization. Produce a clear migration notice and provide a verification query.

## Phase 0: audit and baseline

Before editing:

1. Read the required repository instructions and docs.
2. Inspect migrations `100`, `101`, and `102`.
3. Inventory every use of:
   - `organization_products`
   - `org_has_product`
   - `bootstrap_org`
   - `bootstrap_digital_org`
   - `get_backoffice_context`
4. Inventory public Edge Functions and SECURITY DEFINER RPCs for menu, online
   orders, reservations, POS bootstrap, shifts, orders, and reports.
5. Run the existing tests and record the baseline.
6. Do not change migrations `100`–`102`; create forward-only migrations.

## Phase 1: product and capability model

Create the next forward-only migration, expected to be migration `103`.

Add a product registry:

```text
product_catalog
- key
- display_name
- can_be_primary
- can_be_addon
- is_active
- sort_order
```

Seed:

```text
pos
menu
online_orders
reservations
```

All four products must support both:

```text
can_be_primary = true
can_be_addon = true
```

Add a capability mapping:

```text
product_capabilities
- product
- capability
```

Extend `organization_products` with the minimal entitlement lifecycle:

```text
status:
  active
  trialing
  suspended
  expired

source:
  developer
  manual
  trial
  subscription

starts_at
expires_at
metadata
```

Do not add prices, invoices, payment-provider fields, or automatic renewal in
this phase.

Add:

```text
org_has_capability(org_id, capability)
```

Rules:

- it derives effective capabilities from active/trialing, non-expired product
  entitlements;
- expiration is evaluated at request time;
- `org_has_product` remains available for checking a directly granted product;
- invalid product or capability keys fail closed;
- functions have explicit grants and a safe `search_path`;
- RLS remains the actual security boundary.

Add an organization account type using the least invasive safe design:

```text
customer
developer
demo
```

Seed `fairgvard@gmail.com` as `developer` and grant all four products with:

```text
status = active
source = developer
expires_at = NULL
```

Add pgTAP coverage in the same phase.

## Phase 2: secure provisioning

Remove automatic full-package grants.

### POS onboarding

`bootstrap_org` must no longer grant Menu, Orders, and Reserve.

It must also not become a way for any authenticated browser user to obtain a
free POS subscription. Separate organization/device setup from commercial
entitlement provisioning.

Design a minimal manual-provisioning flow suitable for the current pre-billing
stage:

- customer product entitlements are granted only through service-role or a
  future platform-admin path;
- customer-facing RPCs cannot write `organization_products`;
- attaching a POS terminal to an existing digital organization must not create
  a second organization;
- document the temporary operator procedure.

Do not create an insecure platform-admin page inside the customer back office.
If there is no platform-admin identity model yet, use a documented
service-role/operator procedure for this phase.

### Digital onboarding

`bootstrap_digital_org` must not treat `p_products` from the browser as an
entitlement grant.

The selected products may be stored as product interest or an activation
request, but not as active access.

An organization with no active product must land on a stable
`Choose a product / Pending activation` screen instead of a broken back office.

Do not assume a free trial unless the user explicitly approves a trial policy.

## Phase 3: server-side capability enforcement

Move feature gates to capabilities:

```text
public QR Menu       -> public_menu
order submission     -> online_orders
web orders inbox     -> orders_desk
public reservation   -> public_reservations
web host desk        -> reservations_desk
POS operation        -> pos_operate
POS reporting        -> pos_reports
catalog management   -> catalog_manage
```

Audit and protect:

- public menu Edge Function;
- online order submission and status RPCs;
- reservation submission and status RPCs;
- backoffice context and mutation RPCs;
- POS bootstrap;
- shifts;
- POS order placement/payment;
- reports and other sensitive POS-only operations.

UI visibility is not security.

When access is missing, return one stable application error:

```text
module_disabled
```

Disabling a product:

- blocks its protected reads and writes;
- does not delete or rewrite existing domain data;
- allows old data to become available again if the product is re-enabled.

## Phase 4: backoffice UX

Return both effective products and capabilities from the backoffice context.

Build navigation from capabilities, not from one raw product key.

The product card must support:

- `Active`
- `Included with ANGLE Orders`
- `Available as add-on`
- `Pending activation`
- `Developer`

Expected account experiences:

### POS only

- POS dashboard and catalog management are available;
- public QR Menu controls are unavailable;
- Orders and Reserve are unavailable.

### Menu only

- catalog management and QR Menu are available;
- cart, online order inbox, POS, and reservations are unavailable.

### Orders only

- catalog, public menu, cart, order submission, and web inbox are available;
- it must not require purchasing Menu separately;
- POS and Reserve are unavailable.

### Reserve only

- reservation settings, public booking, and host desk are available;
- POS and menu/order features are unavailable.

### No products

- show product choices or pending activation;
- do not render inaccessible operational screens.

### Developer

- show a `Developer workspace` badge;
- all products and capabilities are available;
- do not show payment or expiration warnings.

Locked product cards are marketing/UX states only. Server enforcement remains
mandatory.

## Phase 5: POS boundary

Ensure the POS frontend is a consumer of the `pos` capability rather than an
implicit owner of every product.

Requirements:

- POS device/session cannot operate without `pos_operate`;
- catalog editing remains available to POS-only accounts;
- absence of public Menu does not break the POS catalog;
- adding Menu, Orders, or Reserve later reuses the existing catalog and
  organization;
- adding POS to a Menu/Orders/Reserve organization reuses its existing data and
  does not bootstrap another organization.

Preserve the current fiscal, audit, money, RLS, and device-auth invariants from
`AGENTS.md`.

## Phase 6: tests

Add backend and frontend tests for this matrix:

| Entitlements | Expected behavior |
|---|---|
| POS | POS and catalog work; public QR Menu does not |
| Menu | catalog and QR Menu work; cart does not |
| Orders | catalog, public menu, cart, submission, and inbox work |
| Reserve | public booking and host desk work |
| POS + Menu | POS and QR Menu work; Orders and Reserve do not |
| All products | all product flows work |
| No products | only activation/pending UX is available |
| Developer | every product and capability is available indefinitely |

Also verify:

- cross-tenant isolation;
- a customer cannot grant themselves an entitlement;
- browser-supplied product keys do not activate products;
- disabling a product preserves data;
- re-enabling restores access to preserved data;
- expiration is enforced without requiring data deletion;
- Orders supplies the public-menu capability;
- operational `enabled` flags do not bypass entitlements;
- a developer grant cannot be accidentally expired by customer-facing RPCs;
- direct API/RPC calls remain blocked even when a navigation item is hidden.

Run all relevant existing test suites and builds in both repositories.

## Phase 7: documentation and delivery

Update:

- `docs/standalone-products.md`;
- database documentation;
- onboarding documentation;
- deployment order;
- production smoke checklist;
- manual product grant/revoke procedure;
- digital-to-POS upgrade procedure.

Recommended atomic commits:

1. product registry, capabilities, entitlement lifecycle, and pgTAP;
2. developer account and secure manual provisioning;
3. backend/Edge capability gates;
4. backoffice capability UX;
5. POS capability boundary;
6. documentation and smoke checklist.

Do not mix unrelated formatting or refactoring into these commits.

## Definition of Done

The work is complete only when:

1. An organization can own any combination of POS, Menu, Orders, and Reserve.
2. Every product can be the first standalone product.
3. Every product can later be added to the same organization as an add-on.
4. No product addition requires copying or migrating customer domain data.
5. POS catalog management and public QR Menu are separate capabilities.
6. ANGLE Orders includes the technical menu experience without requiring a
   duplicate paid Menu entitlement.
7. The browser cannot activate its own products.
8. Product removal blocks functionality without deleting data.
9. Server-side checks protect every critical flow.
10. `fairgvard@gmail.com` is an indefinite developer account with all products,
    implemented through organization type and normal protected entitlements,
    not an email-based runtime bypass.
11. All tests, builds, and documented smoke scenarios pass.
