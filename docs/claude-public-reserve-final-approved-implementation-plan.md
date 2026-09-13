# ANGLE Public Reservations — final approved implementation plan for Claude

Status: **approved direction; implement this document**\
Date: 2026-08-14\
Scope: public QR/online reservation guest flow, the minimum necessary back-office settings, API/database changes, and real conditional reservation prepayment.\
Primary repositories:

- `/Users/enotov/Desktop/kassa` — public guest page, API, Edge Function, database migrations, reservation logic.
- `/Users/enotov/Desktop/anglesite` — back-office settings and preview.

## Exact prompt to give Claude

> Read `/Users/enotov/Desktop/anglesite/docs/claude-public-reserve-final-approved-implementation-plan.md` completely before changing code. Then inspect both repositories and implement the plan phase by phase. The approved interactive reference is `/Users/enotov/.codex/visualizations/2026/07/26/019f9c68-58d8-7520-a67a-347f11fb19d2/angle-reserve-final-direction.html`; treat it as the visual source of truth and reproduce the actual product screens 1:1, but do not copy the prototype-only step switcher or device frame. Preserve all existing reservation availability, waitlist, self-service, analytics and security behavior. Do not fake payments. Run the required checks after every phase, show the result and diff, and do not push, deploy, apply a production migration, or touch unrelated dirty files without my explicit approval.

---

## 1. Outcome

The public reservation page must feel like the same premium product as the ANGLE QR menu: restrained, branded per venue, easy on a real phone, and operationally honest.

The completed guest journey is:

1. Venue introduction and quick selection of date and party size.
2. Zone preference first, then availability for that zone.
3. Venue rules/important information, only when configured.
4. Guest details: first name, last name, phone, email and optional requests.
5. Mandatory prepayment disclosure and payment, only when the venue has a real, configured per-guest prepayment flow.
6. Confirmation and self-service actions.

This is not a generic design exercise. Implement the approved reference while retaining the mature server-side behavior already present in ANGLE.

## 2. Source-of-truth hierarchy

If two sources conflict, use this order:

1. Existing server-side authorization, availability, conflict prevention, waitlist and self-service invariants.
2. This document for product behavior and scope.
3. The approved interactive reference for visual hierarchy, sizing, spacing, screen order and interaction direction:
   `/Users/enotov/.codex/visualizations/2026/07/26/019f9c68-58d8-7520-a67a-347f11fb19d2/angle-reserve-final-direction.html`
4. The annotated images below for the original intent behind specific decisions.
5. Existing implementation where it does not conflict with items 1–4.

Important supersessions:

- Earlier documents that said not to change the public reservation flow are superseded for this task only.
- Earlier “no payments” instructions are superseded only for **optional mandatory reservation prepayment** described here. Payments in QR menu ordering, WhatsApp and Telegram remain out of scope.
- Existing comments in `QrChannels.jsx` correctly prohibit exposing deposit settings without a real payment implementation. Keep that safety property: restore the controls only together with a working payment path.

### Canonical visual reference

Open the HTML locally and inspect every state. The buttons above the mock phone are prototype navigation only; they are **not product UI** and must not appear in production.

`/Users/enotov/.codex/visualizations/2026/07/26/019f9c68-58d8-7520-a67a-347f11fb19d2/angle-reserve-final-direction.html`

### Secondary annotated references

These paths may be temporary. Use them only to understand intent; the final HTML above is canonical.

- First-screen proportions and content regions:\
  `/var/folders/40/jnh7gx_136v3j0ygxhd23ws00000gn/T/codex-clipboard-39850749-2d92-46e5-96ca-e48592819e0d.png`
- Logo overlapping the photo/sheet seam:\
  `/var/folders/40/jnh7gx_136v3j0ygxhd23ws00000gn/T/codex-clipboard-0be8cc29-1cf2-4dbf-accc-5279e9338d21.png`
- Hours and navigation content idea:\
  `/var/folders/40/jnh7gx_136v3j0ygxhd23ws00000gn/T/codex-clipboard-fbef552a-ba92-4d1e-8dba-c0026c031e39.png`
- Important-information/rules content:\
  `/var/folders/40/jnh7gx_136v3j0ygxhd23ws00000gn/T/codex-clipboard-700b2213-7fc5-43a7-858b-2bdc176dc4d9.png`
- Mandatory prepayment wording idea:\
  `/var/folders/40/jnh7gx_136v3j0ygxhd23ws00000gn/T/codex-clipboard-71090274-eed8-414c-9822-bb99b9c24c28.png`

## 3. Read before editing

In both repositories:

1. Read all repository-local `CLAUDE.md`, `AGENTS.md` and relevant docs completely.
2. Run `git status --short`, record current branch and preserve every unrelated modification/untracked file.
3. Do not edit, delete, stage or format unrelated files.
4. Establish a baseline with the existing tests/build before implementation.
5. Inspect the actual data contracts and latest migration number; do not guess a migration ID.

Known user-owned dirty files that must be preserved:

- `/Users/enotov/Desktop/kassa/CLAUDE.md`
- `/Users/enotov/Desktop/kassa/.claude/launch.json`
- Untracked design documents and media in `/Users/enotov/Desktop/anglesite`.

Start from these implementation files, but follow imports and tests as needed:

### Kassa/public surface

- `/Users/enotov/Desktop/kassa/src/features/reservations/PublicReservePage.tsx`
- `/Users/enotov/Desktop/kassa/src/features/reservations/publicReserveApi.ts`
- `/Users/enotov/Desktop/kassa/src/features/reservations/funnel.ts`
- `/Users/enotov/Desktop/kassa/src/features/reservations/schedule.ts`
- `/Users/enotov/Desktop/kassa/src/features/online/viewTransition.ts`
- `/Users/enotov/Desktop/kassa/src/lib/i18n.ts`
- `/Users/enotov/Desktop/kassa/src/index.css`
- `/Users/enotov/Desktop/kassa/supabase/functions/public-reserve/index.ts`
- Reservation migrations and SQL tests under `/Users/enotov/Desktop/kassa/supabase/`.

### Back office

- `/Users/enotov/Desktop/anglesite/backoffice/src/QrChannels.jsx`
- `/Users/enotov/Desktop/anglesite/backoffice/src/QrChannels.test.js`
- `/Users/enotov/Desktop/anglesite/backoffice/src/online.js`
- Relevant styles used by QR Menu & Online.

## 4. Non-negotiable product decisions

- The first screen does **not** ask for a zone. Zones are on the second screen.
- The second screen asks for a zone **before** showing/selecting a time because availability depends on the zone.
- The date row appears above the party-size row.
- Date and party size are full-width horizontal rectangular controls, not small squares or two cramped columns.
- The hero is shorter than the current menu hero so the reservation form owns most of the viewport.
- The form sheet has large rounded top corners where it meets the photo.
- The circular venue logo overlaps that photo/sheet seam.
- Venue name replaces generic “Book a table” copy; the address sits directly under the name.
- The menu button stays over the hero and opens the correct menu for the same location.
- Opening hours and navigation are a compact information strip. Social links are not a permanent black block.
- Instagram, Facebook and Google are circular buttons inside the venue-information bottom sheet.
- Use the custom route/navigation icon from the reference, not an emoji and not a currency symbol.
- The rules screen comes after zone and time selection.
- Guest details come after rules.
- First and last name are separate fields.
- Phone and email are separate fields; email is required in the approved flow.
- Mandatory prepayment, when applicable, comes **after** guest details.
- There is no shekel icon beside the prepayment heading.
- A booking requiring prepayment is not confirmed until verified payment success.
- Do not show odd decorative squares beside zones. Use simple custom vector zone icons only when they add meaning.
- Never claim a payment, refund, hold or notification happened unless the server confirms it.

## 5. Dynamic state machine

Do not hard-code one linear four-step flow. Resolve it from venue settings and chosen slot.

| Configuration/state | Required path |
|---|---|
| No rules, no prepayment | Entry → Zones & time → Details → Submit → Confirmation |
| Rules, no prepayment | Entry → Zones & time → Rules → Details → Submit → Confirmation |
| No rules, prepayment required | Entry → Zones & time → Details → Prepayment → Provider → Confirmation |
| Rules and prepayment required | Entry → Zones & time → Rules → Details → Prepayment → Provider → Confirmation |
| Chosen zone/time is full | Zones & time → nearby alternatives and/or waitlist |
| Payments not configured/healthy | Never expose a prepayment-required slot as bookable; show an honest unavailable/configuration state to the owner and do not fake guest success |

The progress indicator must be derived from the actual visible steps. It must not count skipped rules or skipped prepayment, and it must not include the entry screen as a fake step if the approved reference does not.

Back behavior must be symmetric and preserve entered state:

- Prepayment → Details retains all guest fields.
- Details → Rules/Times retains zone, time, date and party.
- Rules → Times retains selected acknowledgements unless server data has changed.
- Returning to the entry screen retains date and party.
- Browser Back must not accidentally resubmit, double-track or lose a successful reservation.

## 6. Screen-by-screen 1:1 specification

### Screen 1 — venue and booking start

Match the approved reference, not the current generic reservation page.

Structure from top to bottom:

1. Short venue hero photo using real venue media and a stable fallback.
2. Menu pill over the hero.
3. Rounded white form sheet overlapping the hero edge.
4. Circular venue logo overlapping the seam.
5. Venue display name.
6. Business address immediately below the name; do not leave a large blank gap.
7. Full-width date control.
8. Full-width party-size control/stepper beneath date.
9. Compact opening-hours plus navigation strip.
10. Full-width dark pill CTA to show available times.

Interaction:

- Date opens an accessible native or well-tested date picker, respects venue timezone, lead time, exceptions and booking horizon.
- Party stepper uses server-provided maximum party size and has disabled end states.
- Hours control opens a mobile bottom sheet containing weekly hours, today state, full address, directions CTA and social circles.
- Directions use coordinates when available, then a safely encoded address fallback.
- The bottom sheet closes by its close button, backdrop, Escape and swipe/down gesture if a reliable sheet primitive already exists.
- The CTA continues to zone/time selection. It must never jump straight to a time that was calculated without a zone.

Visual rules:

- Use the same cool white/light neutral background as the QR menu, not a beige/cream canvas.
- Use actual brand/venue media; do not generate artificial food/venue imagery.
- Hero is about the upper 25–30% of a small phone viewport, with the form receiving the majority of the screen.
- Title uses a clean restrained display treatment; body/interface copy uses Heebo/system Hebrew-friendly fonts. Do not overuse bold.
- The logo must remain legible against both the photo and white sheet.
- Keep content clear of iOS safe areas and browser chrome.

### Venue information bottom sheet

This replaces the always-visible social block.

It contains:

- Venue name and close button.
- Today’s hours emphasized and the remaining week below.
- Address.
- Dark directions pill.
- Instagram, Facebook and Google circular icon buttons only when a valid URL exists.

Requirements:

- No empty buttons for missing links.
- External links use safe targets/rel attributes.
- Focus is trapped while open and restored to the opener on close.
- Background does not scroll.
- Sheet respects bottom safe area.

### Screen 2 — zone first, then time

Structure:

1. Back button, centered venue wordmark/name, compact progress.
2. Summary of chosen date and party.
3. Zone section.
4. Time section populated for the selected zone.
5. Sticky bottom CTA enabled only when a valid available time is selected.

Zone behavior:

- If two or more usable zones exist, a guest selects one before time availability is final.
- If exactly one usable zone exists, preselect it but keep the hierarchy understandable.
- If no public zone preference is available, use the server’s “any zone” behavior without inventing a fake zone.
- Selected zone is dark with white content; unselected zones are white with restrained borders.
- Zone cards must not contain arbitrary photo squares. A small custom vector icon is allowed only when consistent for every zone.

Availability behavior:

- Availability request must include location, date, party and selected zone.
- Changing zone cancels/invalidates stale availability responses and clears an invalid selected time.
- Show a stable skeleton only for the time area; do not flash the entire screen.
- Available, unavailable and selected time states must be distinguishable without relying on color alone.
- Keep server truth: the client may suggest, but the server makes the final conflict decision.

Full-slot state:

- Explain that the requested time/zone is unavailable.
- Show nearby available times for the same zone first.
- If useful, show availability in another zone as a clearly labelled alternative, never silently change the guest’s zone.
- Offer waitlist only when the server says waitlist is enabled.
- Preserve the existing honest server error when there is no capacity.

### Screen 3 — important information/rules (conditional)

Render only when the server returns rules.

Visual hierarchy:

- Clear “Important to know” title with a small information icon.
- Readable bullet list with normal and important variants.
- Important financial/critical text may use the restrained warning red; normal policy remains neutral.
- Required acknowledgements are explicit checkboxes beneath the relevant rules.
- Terms links are visibly links and open safely.
- Sticky CTA remains disabled until all server-required acknowledgements are checked.

Do not hard-code the sample text from the screenshot. Render venue-configured rules and their server-defined `ack`, `level` and `url` values. The sample concepts are table-hold duration, SMS cancellation, children/high chairs, allergies/accessibility and special-event notice.

### Screen 4 — guest details

Fields:

- First name — required.
- Last name — required.
- Phone — required, normalized server-side and using appropriate `autocomplete`/input mode.
- Email — required, using `type=email`, `autocomplete=email`, client validation for fast feedback and server validation as authority.
- Optional note/requests.

Layout:

- First name and last name may share one row where width permits; on very small devices they stack rather than shrink below usability.
- Phone and email are full-width, unambiguous fields.
- Optional request chips can include birthday, high chair, accessibility and note only if they map to real data/operations. Do not add dead controls.
- Show a concise reservation summary above the fields.
- Sticky CTA states exactly what happens next:
  - “Continue to payment” when real prepayment is required.
  - “Confirm booking” when no prepayment is required.

Validation:

- Never erase user-entered names when a returning guest lookup resolves.
- Existing phone lookup/returning-guest behavior must remain intact.
- Inline errors are adjacent to the field and announced accessibly.
- Button remains disabled only for truly invalid required data, not due to transient lookup/loading.

### Screen 5 — prepayment disclosure and payment (conditional)

This screen appears only after valid guest details and only if the selected booking requires prepayment and a real provider configuration is healthy.

Content:

- Neutral “Prepayment” title; **no shekel icon beside the heading**.
- Per-guest amount.
- Party size.
- Exact total calculated by the server in the venue currency.
- Explicit statement that the amount is charged now.
- Full-refund cancellation deadline using the configured cutoff.
- Late cancellation/no-show consequence.
- Required checkbox acknowledging the prepayment/cancellation terms.
- Small custom vector lock/security icon near the secure-payment explanation; no emoji.
- Dark full-width CTA to open/continue to the payment provider.

Financial correctness:

- Never calculate the authoritative amount only in the browser.
- Currency and minor-unit rounding come from the server.
- Total equals server-confirmed per-guest amount × party size or a server-returned total when policy is more complex.
- Do not expose raw provider errors or secrets.
- A checkbox is not proof of payment.
- A redirect return is not proof of payment. Confirm only from verified server/provider status.
- Repeated taps and provider callbacks must be idempotent.
- The chosen capacity must be protected by an expiring server-side hold or an equivalent atomic reservation/payment state.
- When the hold expires or the slot becomes unavailable, explain it and return the guest to fresh availability without losing contact details.
- Payment failure/cancel must allow retry without creating duplicate reservations.
- Refund/forfeit state transitions must be auditable.

If there is no real payment provider adapter/credential/configuration in the project, implement the provider-neutral contract and guarded UI but keep the feature disabled. Stop and report the exact external dependency; do not ship a fake successful flow.

### Screen 6 — confirmation

Match the premium brand treatment in the reference while preserving existing self-service capability.

Show:

- Confirmed/request status from server, not an optimistic generic success.
- Venue name/hero/logo.
- Date, time, party size and selected zone when applicable.
- Payment status/amount only when verified.
- Add-to-calendar.
- Directions and address.
- Manage booking/self-service link.
- Menu CTA.
- “Book again” behavior with only approved fields prefilled; do not pre-accept rules or preselect a stale time.

For non-instant request mode, copy must clearly say that the request awaits venue confirmation instead of calling it confirmed.

## 7. Visual system and responsive rules

Use the approved reference values as the baseline and translate them into reusable production classes/tokens rather than copying brittle prototype selectors.

### Palette

- Background: cool white/light gray consistent with QR menu.
- Surface: white.
- Primary ink/CTA: near-black (`#181a20` family).
- Secondary text: neutral gray.
- Borders: quiet neutral hairlines.
- Success/open: restrained green.
- Warning/financial consequence: one restrained red.
- Venue brand color may accent selected states only when contrast remains accessible.

### Shape and spacing

- Primary CTAs are full-width pills.
- Content sheets have generous but controlled rounding.
- Inputs and selection cards have consistent radii; avoid a mix of arbitrary squares/capsules.
- Minimum touch target: 44 × 44 CSS pixels.
- No horizontally clipped forms, crushed text or buttons touching viewport edges.
- Sticky CTA must not cover the last field; content receives matching safe-area padding.

### Typography

- Hebrew-friendly UI family: Heebo/system fallback; Manrope may be used sparingly for Latin display name when it matches the reference.
- Prefer regular/medium weights. Bold is for hierarchy, not every label.
- Do not use tiny 8–10px production copy simply because the scaled prototype does. Convert prototype scale into readable real-device sizes (generally 14–16px body, 12–14px secondary, 20–28px headings).
- Long Hebrew, English and Russian strings must wrap without overlapping controls.

### Breakpoints/devices

Verify at minimum:

- 360 × 800 small Android.
- 375 × 812 iPhone mini-class.
- 390 × 844 and 393 × 852 modern iPhone.
- 430 × 932 large iPhone.
- 768 × 1024 tablet.
- 1280/1440 desktop preview.

On desktop, keep a focused booking column rather than stretching the mobile form to the entire window. On tablet, increase breathing room without changing the flow order.

Use `100dvh` with safe fallbacks, `env(safe-area-inset-*)`, and stable scroll ownership. The document must not move horizontally in iOS Safari/Chrome. Browser bar color/background must not flash between steps.

## 8. Motion and navigation

Preserve the existing single-live-layer transition architecture and `navigateWithTransition`; do not mount two complete heavy screens on top of one another.

- Forward steps: a calm horizontal slide consistent with the current QR menu direction and RTL semantics.
- Back: the exact inverse direction with the same duration/easing.
- Bottom sheet: rises from the bottom.
- Avoid full-screen opacity flashes and skeleton remount flashes.
- Images remain stable/preloaded across transitions.
- Use transform/opacity only for primary motion; avoid animating layout dimensions.
- Honor `prefers-reduced-motion`.
- Lock repeated navigation while a transition is active.
- Preserve scroll/state on back.

## 9. Data contract and migration work

The current payload uses one `name` plus `phone`. The approved UI requires structured first/last names and required email. Do not solve this only in the browser.

### Required contract evolution

After inspecting current schema and compatibility consumers, add a forward-only migration using the next free migration number:

- Structured first name.
- Structured last name.
- Guest email.
- Keep/populate the existing composed `customer_name` for POS, CRM, exports and old clients until every consumer is migrated.
- Preserve phone-based guest matching unless the existing CRM model explicitly supports a safer identity merge.
- Normalize/validate email and phone on the server.
- Update public submit RPC/Edge Function payload and response types.
- Update self-service view and notification payloads only where necessary.
- Do not expose private contact details through public lookup/status endpoints.

Document exact compatibility behavior in the migration and tests. If the repo requires `MIN_SCHEMA_VERSION` changes, follow its coordinated release process and deployment order.

### Reservation prepayment settings

Use existing deposit placeholders only after auditing them. Introduce/normalize explicit settings such as:

- `enabled` / `required`.
- Amount per guest in integer minor units.
- Currency derived from location/business settings.
- Applicability rules if already supported (party threshold, dates, zones, services); do not invent a large rules engine in this phase.
- Refund/cancellation cutoff in minutes/hours.
- Provider configuration/health state stored securely outside public location JSON where secrets are involved.

Public `info` may expose only the guest-safe policy/amount needed to render the screen. It must not expose provider secrets.

### Payment state machine

Design explicit server states rather than treating existing `deposit_status` as sufficient proof by itself. At minimum cover:

- not required;
- payment required / awaiting payment;
- paid;
- failed/cancelled/expired;
- refunded;
- forfeited.

Use an idempotency key tied to the guest attempt. Verify provider webhooks/signatures server-side. Reconcile return URLs against server state. Add audit events. Ensure a reservation is not double-created by retry, refresh or webhook replay.

## 10. Back-office work

Keep the top-level section exactly as the product has it: two tabs only — **QR menu & ordering** and **Reservations**. Do not add prototype tabs.

Within Reservations:

1. Preserve existing hours, schedule, booking window, cancellation, confirmation, rules and page-look settings.
2. Make preview match the real guest page and allow stepping through the real conditional screens with safe preview data.
3. Add reservation prepayment settings only when backed by the real payment implementation:
   - enable mandatory per-guest prepayment;
   - amount per guest;
   - refund/cancellation cutoff;
   - concise guest-facing summary;
   - provider configured/healthy state.
4. Prevent enabling prepayment if the provider is missing or unhealthy. Explain exactly what is missing.
5. Warn that changing policy affects new attempts, and state how existing bookings are treated.
6. Keep address source clear: Locations → Business address, with an optional booking-page override only if current product rules allow it.
7. Reuse existing hero/logo/social settings rather than creating duplicate sources of truth.

Do not redesign the QR menu tab, catalogue, POS checkout, WhatsApp or Telegram in this task.

## 11. Internationalization and accessibility

- Do not hard-code Hebrew into components. Add keys to the existing i18n system for Hebrew, English and Russian with safe fallbacks.
- RTL is first-class: icon direction, progress, slide direction, text alignment and mixed phone/email content must work.
- Use semantic labels, fieldsets/legends where appropriate, real buttons and form submission.
- Every icon-only control has an accessible name.
- Focus order follows the visual order.
- Errors use `aria-describedby`/live announcements where appropriate.
- Dialog/bottom-sheet semantics, focus trap and Escape behavior are correct.
- Color contrast meets WCAG AA.
- Availability does not rely only on red/green.
- Loading state is announced without stealing focus.

## 12. Analytics

Preserve the current funnel and add only meaningful server/client events needed for the new dynamic flow:

- entry viewed;
- date/party completed;
- zone selected;
- availability viewed/time selected;
- rules viewed/accepted when present;
- details valid/submitted;
- payment disclosure viewed;
- payment started;
- payment succeeded/failed/cancelled/expired;
- booking confirmed/requested;
- waitlist submitted.

Do not double-count on rerender, browser Back or transition replay. Do not put names, phones, emails or payment secrets in analytics. If funnel calculation/version must change, coordinate it with existing analytics tests and schema release rules.

## 13. Implementation phases

### Phase 0 — audit and baseline

- Inspect both repositories, dirty state, current routes, schema, settings and provider integrations.
- Open every state in the approved HTML reference.
- Record baseline commands/results and current production behavior.
- Write a short implementation map before editing.

Exit: no unanswered assumption about which repo owns each piece.

### Phase 1 — production visual shell and first screen

- Refactor reusable public-reserve shell/components without changing server behavior.
- Implement short hero, rounded white sheet, overlapping logo, venue name/address, date then party rows, venue info strip, custom route icon, hours/social bottom sheet and CTA.
- Preserve preview, disabled/closed/error states and language handling.
- Add focused component tests.

Exit: first screen visually matches the reference on real mobile widths and has no overflow.

### Phase 2 — zone-first availability and full state

- Enforce zone-before-time hierarchy.
- Preserve zone-specific server availability, stale-request protection and conflict handling.
- Implement alternatives/waitlist state.
- Stabilize loading and transitions.

Exit: changing zones cannot display stale times, and a full slot never silently moves the guest.

### Phase 3 — rules and structured guest details

- Rebuild rules screen to match reference with dynamic server content.
- Add first name, last name, phone and required email UI.
- Add forward-only schema/API migration with compatibility fields.
- Preserve returning-guest hints, repeat booking and self-service.

Exit: all four required fields reach the server safely, old consumers still work, and rules remain server-authoritative.

### Phase 4 — conditional prepayment foundation and integration

- Audit available payment provider infrastructure before coding.
- Implement settings, server-side price/policy calculation, payment intent/hold, idempotency, verified callback/webhook and status reconciliation.
- Implement the approved disclosure screen after details.
- Keep the feature impossible to enable without healthy provider configuration.
- Add payment, replay, expiry, conflict and retry tests.

Exit: no path can show “paid” or “confirmed” without verified server state.

### Phase 5 — confirmation, preview and regression hardening

- Bring confirmation/self-service screen to the approved visual level.
- Update back-office preview to the same real components/data shape where practical.
- Complete i18n, accessibility, reduced motion and safe-area behavior.
- Run full regression for menu/POS/reservations.

Exit: definition of done below is met on actual phones and desktop.

## 14. Required tests

### Unit/component tests

- Dynamic step resolver for every rules/prepayment combination.
- Zone selection controls availability query and invalidates stale responses.
- Single-zone/no-zone behavior.
- Required rules acknowledgement.
- Structured name/phone/email validation.
- Back navigation preserves draft.
- CTA labels and enabled states for prepay/non-prepay.
- Server-authoritative amount display and minor-unit formatting.
- Payment consent, retry, expiry and idempotent result handling.
- Bottom sheet focus/close behavior.
- i18n and RTL direction.

### API/SQL/Edge tests

- Submit with structured names/email; old `customer_name` compatibility.
- Invalid email/phone rejected server-side.
- Availability/conflict remains atomic.
- Rules cannot be bypassed.
- Prepayment amount cannot be altered by the client.
- Provider callback signature verification.
- Callback replay does not duplicate charge/reservation.
- Payment return without verified webhook/status does not confirm.
- Hold expiry releases capacity.
- Late cancellation/refund/forfeit policy boundaries.
- No PII in public info or analytics.

### Existing full checks

Inspect `package.json` first, then at minimum run the existing equivalents of:

For `/Users/enotov/Desktop/kassa`:

```text
npm run lint
npm run test:run
npm run build
npm run build:menu
npm run check:bundle
npm run check:schema
```

For `/Users/enotov/Desktop/anglesite`:

```text
npm run build
```

Run the relevant back-office tests explicitly if the default build does not include them.

### Manual real-device acceptance

Test the production-like URL on an actual iPhone Safari and iPhone Chrome, plus a small Android browser:

- Page does not move horizontally.
- Hero and sheet fill the visible viewport without a cream/white browser-bar flash.
- Date is above party size.
- Both controls use the full useful width.
- Address is close to venue name.
- Logo overlaps the seam correctly.
- Hours sheet opens/closes and scroll does not leak.
- Social circles open correct destinations.
- Zone is chosen before time and availability changes honestly.
- Back/forward transitions are smooth and equal in speed.
- Keyboard does not hide the active field/CTA.
- First/last name, phone and email remain after Back.
- Rules cannot be bypassed.
- Prepayment appears after details only when enabled.
- No shekel heading icon is present.
- Failed/cancelled payment does not create a confirmed booking.
- Successful verified payment creates exactly one booking.
- Confirmation calendar, directions, manage booking, menu and book-again actions work.

## 15. Acceptance checklist — visual 1:1

Stop and fix before moving on if any item fails:

- [ ] No prototype screen-switcher/device chrome was copied into the product.
- [ ] First screen uses a shorter hero and a larger white booking sheet.
- [ ] White/cool-neutral background matches QR menu; no beige canvas.
- [ ] Rounded sheet corners visibly connect to the hero.
- [ ] Circular logo overlaps the seam.
- [ ] Venue name and address are grouped tightly.
- [ ] Date is a full-width row above the full-width party row.
- [ ] Hours/navigation strip matches the reference and uses a custom route icon.
- [ ] Social networks are circles in the information sheet, not a black form block.
- [ ] Zone appears before time.
- [ ] Zone cards contain no random square thumbnails.
- [ ] Rules appear after zone/time only when configured.
- [ ] First and last names are separate.
- [ ] Phone and required email are present.
- [ ] Prepayment appears after details only when truly required/configured.
- [ ] Prepayment title has no currency icon.
- [ ] Important financial consequence is clear without making the whole page red.
- [ ] Primary actions are consistent dark pills.
- [ ] Every real-device target has readable typography and ≥44px touch targets.
- [ ] No horizontal overflow, clipped CTA, jumping browser background or full-page flash.

## 16. Definition of done

The task is complete only when:

1. The real public reservation flow matches the approved reference screen-for-screen and hierarchy-for-hierarchy.
2. Existing availability, server conflict checks, waitlist, preview, analytics, repeat booking and self-service remain working.
3. Structured names and email are stored and transported safely with backward compatibility.
4. Conditional prepayment is either fully real and verified end-to-end or remains impossible to enable; there is no simulated payment success.
5. Back-office preview/settings reflect the real behavior without adding extra top-level tabs.
6. RTL, i18n, accessibility, reduced motion and real-phone safe-area behavior pass.
7. All relevant tests/build/schema checks pass.
8. A phase-by-phase summary lists changed files, migrations, tests, known external dependencies and manual checks.
9. No unrelated user files were changed or staged.

## 17. Git, migration and deployment discipline

- Keep phases reviewable and do not mix unrelated refactors.
- Show `git diff --stat` and focused diffs after each phase.
- Do not rewrite user history or clean the working tree.
- Do not apply a production migration, deploy Edge Functions/web apps, commit, push or merge without explicit user approval in the active session.
- When approval is given, deploy in the dependency-safe order required by the schema guard and payment callback configuration.
- After deployment, perform real-phone acceptance before declaring success.

## 18. Final report expected from Claude

Return:

1. What was implemented in each phase.
2. Exact changed files in each repository.
3. Migration/API/payment architecture summary.
4. Automated command results.
5. Real-device checks completed and still pending.
6. Any provider credentials/webhook/domain configuration still requiring the owner.
7. Screenshots of every final state at a modern iPhone width and one desktop width.
8. Confirmation that no unrelated dirty files were touched.
