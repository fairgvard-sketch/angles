# Claude implementation brief — QR Menu & Online redesign

Read this document completely before changing code. Then inspect the existing implementation and execute the work in the phases below. Do not reinterpret the product structure from the mockups.

## Objective

Redesign the backoffice section `QR Menu & Online` so it uses the approved ANGLE/Square-inspired visual language while preserving every working setting and interaction.

The module contains exactly two products and exactly two top-level tabs:

1. `QR menu & ordering`
2. `Reservations`

Do not create `Overview`, `Branding`, `QR codes`, `Ordering`, `Design`, `Menu`, `Analytics`, or any other tabs.

## Approved visual references

- QR menu composition and visual language: `docs/design-references/qr-menu-first-approved.png`
- Reservations composition and visual language: `docs/design-references/reservations-approved.png`
- Exact two-tab source: `docs/design-references/qr-online-two-tabs-source.png`

Important: the QR-menu reference contains invented inner tabs. Ignore those inner tabs. Use its layout, hierarchy, spacing, setting rows, status/link treatment, and right-side preview only. The navigation must still be the two real tabs shown in `qr-online-two-tabs-source.png`.

The images are design references, not permission to replace existing behavior with static summaries. All existing controls must remain accessible inside expandable setting groups.

## Functional source of truth

Read these files before editing:

- `backoffice/src/QrChannels.jsx`
- `backoffice/src/qr-blocks.jsx`
- `backoffice/src/online.js`
- the relevant QR/online styles in `backoffice/src/styles.css`
- existing tests covering these modules

If a mockup conflicts with existing working behavior, preserve the behavior and adapt the presentation. Do not delete data fields, backend calls, validation, optimistic updates, rollback behavior, accessibility attributes, URL handling, or preview safeguards.

## Non-negotiable product rules

1. Keep exactly the existing two tabs and the existing URL/deep-link contract.
2. Keep automatic saving. Do not add `Publish changes`, drafts, or a new publishing workflow.
3. Keep a visible enabled/paused switch for each channel. A colored status label alone is not enough.
4. The complete row header is clickable and keyboard operable; a small `Edit` label may reinforce the action but must not be the only target.
5. Keep at most one setting group expanded at once, as the current implementation does.
6. Keep every existing QR-menu and reservation setting listed below.
7. Keep the menu and reservation pages on `menu.angle.co.il`; do not point public links back to POS or the account application.
8. Do not add payments, deposits, credit-card setup, WhatsApp, Telegram, delivery, marketing automation, or invented analytics.
9. Do not change the public guest flows as part of this task.
10. Do not introduce a migration, schema-version bump, RPC, or backend change.
11. Do not redesign unrelated backoffice sections.
12. Do not deploy, push, or commit until the user explicitly asks after reviewing the implementation.

## Existing functionality that must not disappear

### QR menu & ordering

Preserve:

- enable/pause toggle and the paused-state explanation;
- public URL, short slug/address editing, copy link, open link, QR rendering and PNG download;
- order-type selection and the rule preventing the final active order type from being disabled;
- opening hours;
- display name;
- Google review, Instagram, and Facebook links;
- hero-video URL and upload flow;
- background presets/custom background behavior;
- table selector and individual table QR codes;
- website button snippet and iframe snippet;
- real guest-page preview;
- lazy preview arming, refresh, blocked/unconfirmed states, explicit `Enter preview`, iframe focus handling, and scroll-position restoration;
- optimistic saving, success feedback, error feedback, and precise rollback;
- location switching and location-specific state reset.

Add one useful navigation affordance from the approved design:

- `Manage catalogue`, leading to the existing Catalogue section through the existing application navigation mechanism.

Do not duplicate catalogue editing inside `QrChannels`. The button is only a shortcut.

### Reservations

Preserve:

- enable/pause toggle and the closed-state guest explanation;
- booking link, source-aware reservation QR, copy/open/download actions;
- weekly schedule with multiple windows;
- date exceptions and timezone-aware previews;
- slot length and maximum party size;
- minimum lead time and maximum booking horizon;
- cancellation and rescheduling cut-offs;
- waitlist toggle and cancellation-policy text;
- manual versus instant confirmation;
- combine-tables option;
- visit duration and buffer between visits;
- display name;
- effective business address and override/reset behavior;
- Google review, Instagram, and Facebook links;
- header-image and map-pin source explanation;
- all disabled-channel guardrails and hints;
- optimistic saving, errors, success feedback, and rollback.

Deposits must remain absent from the UI.

## Target information architecture

### Shared shell

- Keep the existing backoffice sidebar and page header.
- Header title: `QR Menu & Online`.
- Keep the location selector in the normal ANGLE header position.
- Put the two real tabs directly below the header.
- Active tab: dark ink background and white label.
- Inactive tab: white surface, quiet border, dark muted label.
- Tabs must stay on one line on supported mobile widths; allow horizontal scrolling if necessary instead of wrapping.
- Preserve URL-driven tab selection and browser Back/Forward behavior.

### Desktop layout

Use a two-column workspace below the tabs:

- left: channel state, public link and expandable settings;
- right: sticky live phone preview;
- thin divider between columns;
- right column should be prominent but not wider than the settings area;
- opening or closing a group must not make the preview jump or steal focus.

Suggested breakpoint behavior:

- wide desktop: approximately `minmax(0, 1fr) 400–440px`;
- tablet/mobile: one column, settings first and preview below;
- no horizontal page overflow at 390 px, 768 px, or desktop widths.

### Status/link area

Replace the oversized hero treatment with a compact operational header inspired by the reference, while keeping the actual controls:

- channel name and enabled/paused switch;
- clear live/paused state;
- canonical public URL;
- copy/open/QR-download actions;
- QR itself may remain compact or open in the relevant group, but must stay easy to reach;
- `Saved`/error feedback must remain visible and non-disruptive;
- do not show fake `last published` metadata.

### Setting rows

Use the approved compact row language:

- consistent 38–40 px outline-icon area;
- title, one-line hint, concise current-value summary;
- subtle separators and white background;
- full-width row button with `aria-expanded`;
- selected/open state visible without a large filled card;
- expanded body contains the real existing form controls;
- do not replace controls with modal-only editing unless the current behavior already requires a modal.

Do not make buttons or cards larger than the rest of the backoffice design system.

## QR menu & ordering tab

Use `qr-menu-first-approved.png` as the primary visual reference.

The left side should surface these concepts without deleting the underlying groups:

1. `Link & address`
2. `How guests order`
3. `Opening hours`
4. `Look of the guest page`
5. `Table QR codes`
6. `Put the menu on your website`

Add a compact `Manage catalogue` shortcut near the guest-experience/menu summary. It must navigate to Catalogue and must not create a new catalogue implementation.

The right preview uses the existing real guest menu iframe. It must keep:

- loading, ready, unconfirmed, and blocked states;
- refresh;
- `Enter preview` for intentional keyboard entry;
- `Open full page`;
- lazy loading;
- the current anti-scroll-jump/focus-restoration logic.

Do not replace the iframe with a fake phone screenshot.

## Reservations tab

Use `reservations-approved.png` as the primary visual reference.

Show these existing setting groups as compact expandable rows:

1. `Booking hours`
2. `Slots & booking window`
3. `Cancellation & changes`
4. `Confirmation`
5. `Look of the booking page`

The row summaries may follow the approved mockup, but their values must be derived from current settings rather than hard-coded example data.

Add a real right-side booking-page preview using the existing public reservation URL. Reuse/generalize the proven preview component rather than duplicating its iframe lifecycle logic.

Refactor `GuestPreview` only as much as necessary to support both channel types through props, for example:

- URL;
- accessible iframe title;
- heading and description;
- open-page label;
- preview caption;
- expected ready origin/message contract if it differs.

Preserve all focus, scroll-restoration, loading, refresh, and blocked-state safeguards. The reservation preview must not steal focus or move the owner’s page.

If the public reservation page does not emit the same `angle-public` ready message, treat it as `unconfirmed` after load rather than incorrectly hiding a working iframe.

## Visual rules

- Use existing ANGLE CSS variables and primitives whenever possible.
- White surfaces, cool-gray hairline borders, dark ink text, restrained blue focus/active states.
- No gradients, glassmorphism, oversized shadows, decorative blobs, or presentation-dashboard KPI cards.
- Maintain the same sidebar/header scale as Catalogue, Orders, and Reservations.
- Keep actions compact and predictable.
- Use icons already available through the project’s icon library.
- Do not add inline styles when the rule belongs in `styles.css`.
- Support hover, focus-visible, active, disabled, loading, success, and error states.
- Honor `prefers-reduced-motion`.

## Accessibility requirements

- Tabs keep `role="tablist"`, `role="tab"`, and correct `aria-selected` state.
- Expandable rows keep `aria-expanded` and remain buttons, not clickable `div`s.
- Every icon-only action has an accessible name.
- Focus order is logical from tabs to channel controls, settings, then preview actions.
- Expanded content does not trap focus.
- The iframe remains outside ordinary tab order until the explicit entry action is used.
- Error and saved messages retain appropriate live-region semantics.
- Contrast must meet WCAG AA for text and controls.

## Implementation phases

### Phase 0 — baseline

1. Inspect the listed source and tests.
2. Record the current `git status`; do not modify or stage unrelated user files.
3. Run the focused existing tests for QR/online behavior, then the full test suite if practical.
4. Confirm current deep-link values for both tabs and preserve them.

### Phase 1 — shared shell and responsive workspace

1. Keep exactly the two existing tabs.
2. Introduce the two-column workspace and sticky preview region.
3. Restyle the channel status/link area without altering its actions or save behavior.
4. Establish responsive stacking and overflow rules.

### Phase 2 — QR menu presentation

1. Restyle existing setting groups into the approved compact rows.
2. Keep every existing body control.
3. Add the Catalogue navigation shortcut.
4. Move the existing preview into the right sticky column without changing its lifecycle behavior.

### Phase 3 — Reservations presentation

1. Apply the same compact setting-row language.
2. Keep every reservation field and conditional rule.
3. Generalize the preview component safely.
4. Add the real booking preview in the right column.

### Phase 4 — verification and polish

1. Add/update tests for exact two-tab navigation and preserved interactions.
2. Test keyboard access, focus, saved/error feedback, iframe entry/exit, and reduced motion.
3. Verify desktop, tablet, and phone layouts.
4. Run full tests and production build.
5. Review the diff for accidental functional deletions and unrelated changes.

## Acceptance checklist

### Stop conditions

Stop and report before continuing if any of these occurs:

- a migration or backend/API change appears necessary;
- public menu or booking behavior must change to complete the layout;
- an existing setting cannot be represented without being deleted;
- the public booking page cannot safely be embedded;
- unrelated dirty files overlap the required edits.

### Navigation

- [ ] Exactly two tabs exist: `QR menu & ordering` and `Reservations`.
- [ ] Reloading a deep link returns to the correct tab.
- [ ] Browser Back/Forward restores tab state.
- [ ] Location switching updates links, settings, QR codes, and previews.
- [ ] No invented inner tabs exist.

### QR menu

- [ ] Enable/pause works and the guest-facing paused state remains honest.
- [ ] Link copy/open, slug editing, QR rendering and download work.
- [ ] All order types, hours, appearance, hero upload and background controls remain available.
- [ ] Table QR selection and downloads work.
- [ ] Button and iframe snippets remain copyable.
- [ ] `Manage catalogue` opens the existing Catalogue section.
- [ ] Preview remains lazy, refreshable and keyboard-safe.
- [ ] Preview never scrolls the owner’s page on load or refresh.

### Reservations

- [ ] Enable/pause and booking link/QR actions work.
- [ ] Schedule windows, exceptions, lead time, horizon, slots and party limit remain editable.
- [ ] Cancellation/rescheduling cut-offs, waitlist and policy remain editable.
- [ ] Manual/instant confirmation and instant-only options retain their conditions.
- [ ] Business-address source and override/reset remain correct.
- [ ] Social/review fields remain available inside the expanded appearance group.
- [ ] No deposit or payment control appears.
- [ ] Booking preview loads the real page, handles blocking honestly and does not steal focus.

### Responsive and visual

- [ ] No horizontal overflow at 390 px, 768 px, 1024 px, or wide desktop.
- [ ] Tabs remain in one row.
- [ ] Preview is sticky on desktop and stacks below settings on narrow screens.
- [ ] Long URLs and summaries truncate or wrap safely.
- [ ] Buttons, rows and form fields match the density of the rest of ANGLE.
- [ ] Opening a row does not cause a disruptive layout jump.

### Commands

Run at minimum:

```bash
npm test
npm run build
```

Also run the narrowest relevant QR/online tests during development.

## Required handoff

When implementation and verification are complete, report:

1. changed files;
2. preserved functionality and any internal refactor;
3. tests/build commands and exact results;
4. manual viewport/accessibility checks performed;
5. any remaining difference from the approved references and why;
6. whether the booking iframe uses confirmed or unconfirmed readiness.

Do not commit, push, deploy, alter migrations, or touch unrelated files unless the user explicitly requests it after reviewing the result.
