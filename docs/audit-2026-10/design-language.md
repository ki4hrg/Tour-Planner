# Design-language coherence audit — buttons, links, touch targets, rules

Scope: CLAUDE.md "UI copy" + "Links look like links" rules, `src/app/globals.css`, `src/components/ui/*`,
and every `<Button`/`<Link`/`<a`/`<button` in `src/` (178 `<Button>`, 113 `<Link>`/`<a>`, 38 raw `<button>`).
Verified in the running app at 1280 and 393 (screenshots in ). Inventory scripts:
 (multi-line `<Button>` parser → `btn-rows.json`), 
(bounding-rect census of every interactive element on a route), .

## Executive summary

1. The two recorded rules are good but cover ~15% of the decisions a contributor makes. Nothing says when to use a
   button vs a link vs a tab, which variant is "primary" on a page, which size goes where, how to confirm a destructive
   action, what a status colour means, or what an icon-only control needs. The code shows the cost: the same decision is
   taken 3–4 different ways in different files.
2. The "Links look like links" rule is followed in 15 places and broken in 89 (49 `hover:underline`, 40 no underline at
   all) — including the exact case the rule was written for (small metadata-row links: "Compare years", website URLs,
   Edit/Delete text buttons).
3. Touch targets are the weakest area. On the itinerary editor at 393px there are 262 interactive elements and only 2
   are ≥44px tall; 209 are 24–31px. The drag handle and ↑ button physically overlap the time text on every item row.
   Row toolbars (6 controls × 25 rows) are always visible on phone.
4. Amber carries at least seven meanings (PLANNED status, "Your move", row needs-info tint, stale price, no price,
   "Open now", follow-up); one booking row shows three of them at once. Brass `--accent`, the palette's designated
   emphasis colour, is used once. Two reds coexist (red-600 overdue vs claret destructive).
5. Entity deletes (trip/location/contact/presentation/trip-type) submit with no confirmation; row-level deletes use
   three different confirmation idioms (`window.confirm` ×8, `Dialog` ×1, inline confirm panel ×1).
6. `components/ui/tabs.tsx` is never imported; three hand-rolled tab/segment/chip idioms exist instead, with the
   filter-chip classes copy-pasted verbatim into five pages.
7. What is consistent: page `<h1>` (26× identical), Fraunces on headings/card titles, toast copy ("Saved."), terse
   empty states, sentence case, Cancel = ghost/sm everywhere, back links use `ChevronLeft`, no hover-only reveals.

## Proposed rule additions (ready to paste into CLAUDE.md "Architecture & conventions")

- **Button vs link vs tab**: a control that *navigates* is a `<Link>` (styled `link-quiet`, or `<Button asChild>` when it
  sits in a toolbar); one that *mutates or toggles state* is a `<Button>`; one that *switches a view of the same data*
  is a tab (`components/ui/tabs.tsx` for client state, the `trip-header` nav pattern for URL segments). Never a raw
  `<button className="hover:underline">` — use `<Button variant="link" size="sm">` for text-only actions.
- **One primary per view**: `variant="default"` is reserved for the single page-level creation/submit action ("New
  trip", form Save). Everything inside a Card or row is `outline` (opens/edits/navigates), `ghost` (secondary, Cancel,
  row-level Edit), or `ghost` + `text-destructive` (row-level Delete/Remove). `destructive` only in a Danger zone card.
- **Create verbs**: "New <noun>" = page-level primary that navigates to `/new`; "+ Add <noun>" = in-panel outline/sm
  that opens an inline form; "Create" = the submit of a create form. Never "Add workflow" next to "+ Add stay".
- **Sizes**: `default` (32px) for standalone forms and page headers; `sm` (28px) inside Cards, rows and toolbars; `xs`
  never. Icon-only buttons are `size="icon"` (32px) with `aria-label`, never a text glyph (`↑`, `×`, `✕`) — use lucide
  `ArrowUp`/`X`. Anything tappable must be ≥40px tall on `pointer: coarse` (add `min-h-10` under `@media (pointer:
  coarse)` to the Button base and row toolbars).
- **Destructive flow**: entity deletes (trip, location, contact, presentation, trip type) live in a Danger zone card,
  `variant="destructive"`, and MUST confirm via `AlertDialog`/`Dialog` (one line stating the consequence). Row-level
  deletes (item, stay, cost, note, document) confirm with the same Dialog when they cascade (stay, booking, day), and
  not at all when they are single-row and undoable. `window.confirm` is not used.
- **Status colours**: PLANNED = `secondary` (neutral), IN_PROGRESS = `primary/10` (verdigris), CONFIRMED = `emerald`,
  NOT_NEEDED = muted. **Amber = attention needed from us** ("Your move", needs-info, stale, no price) and nothing
  else; **red-600 = money overdue / missing lodging**; **`destructive` (claret) = delete and validation errors only**;
  **`accent` (brass) = emphasis, never a warning**. Positive facts ("Open now", "Booked", "agreed", "paid") are
  `emerald` or plain `foreground`, never amber.
- **Pills/badges**: every status/kind/audience pill is a `<Badge>`; add semantic variants (`planned`, `progress`,
  `confirmed`, `attention`, `overdue`) to `badge.tsx` instead of hand-rolling `rounded-full px-2 py-0.5 text-xs`.
  Chips smaller than `text-xs` (`text-[10px]`, `text-[11px]`) are not allowed.
- **Filter chips & view switchers**: one `FilterChip` component (`rounded-full border px-3 py-1 text-sm`, active =
  `bg-muted font-medium`) for URL-param filters; `Tabs` (`variant="line"`) for in-page view switches. No per-page copies.
- **Back link**: `<ChevronLeft>` + "All <plural>", `text-sm text-muted-foreground link-quiet`, always top-left above
  the `<h1>`, never beside it.
- **Row click target**: in a list of entity cards the whole card is the link (`<Link className="block">` wrapping
  `<Card>`, as `/admin` does); secondary actions sit outside the link. Title-only links on an otherwise inert card are
  not allowed.
- **Pending state**: every mutation button is `disabled={pending}` and, for actions >300ms, swaps its label to
  "<Verb>ing…" — one shared `useAction()` in `src/lib/use-action.ts`, not a copy per file (currently 11 copies).
- **Headings**: `<h1>` = `text-2xl font-semibold` (page), `CardTitle` (card, already `text-base font-heading` — do not
  re-add `text-base`), `DialogTitle` (dialog). Sub-sections inside a card are `<h4 className="text-sm font-medium">`
  (serif via base CSS), not `<p className="text-xs font-medium text-muted-foreground">`.
- **Focus**: custom clickables (raw `<button>`, `draggable` spans, chips) carry `focus-visible:ring-3
  focus-visible:ring-ring/50 rounded` like the Button primitive. Drag handles are a progressive enhancement: the
  keyboard/touch path is the ↑/↓ buttons, so handles stay `aria-hidden` but never overlap other controls.
- **Confirmation copy**: the one line in a destructive dialog states the consequence as a fact ("Deletes its files
  and notes."), matching the Danger zone helper line.

## Consistency scorecard

| Area | Consistent? | Worst example (file:line) |
|---|---|---|
| Page `<h1>` | Yes (26× `text-2xl font-semibold`) | `trips/[id]/print/page.tsx:92` (`text-3xl`, print-only, fine) |
| Card titles | Yes, but 68/70 redundantly pass `className="text-base"` | `trips/[id]/page.tsx:579` |
| Cancel button | Yes (ghost/sm ×7) | — |
| Save button | No — default/default on `/new` forms, default/sm in panels, outline/sm once | `admin/users/users-manager.tsx:160` (`variant="outline"` Save) |
| Create verb/variant | No — "New"/"+ Add"/"Add"/"Create" across default/outline/ghost | `admin/workflows/workflows-manager.tsx:93` ("Add workflow" outline/default) vs `trips/page.tsx:98` ("New template" default) vs `trip-types/[id]/page.tsx:111` ("New template" outline/sm) |
| Archive | No — primary, outline and destructive for the same verb | `trips/[id]/page.tsx:708` (`Archive trip` is the **primary** button) vs `locations/[id]/page.tsx:979` (`destructive`) |
| Delete | Two-tier (ghost red row-level / destructive danger zone) — coherent but unwritten | `admin/users/users-manager.tsx:196` (destructive/sm in a row) |
| Delete confirmation | No — none / `window.confirm` / Dialog / inline | `trips/[id]/page.tsx:1022` (`<form action={deleteTrip}>` no confirm) |
| Link underline | No — 15 `link-quiet`, 49 `hover:underline`, 9 `underline`, 40 none | `trips/[id]/trip-header.tsx:70` ("Compare years") |
| Text-only actions | No — raw `<button className="hover:underline">` ×12 | `notes/notes-thread.tsx:131`, `trips/booking-row.tsx:501` |
| Back link | Pattern yes, placement + underline no | `locations/[id]/page.tsx:510` (top-right, beside h1) |
| Tabs / view switch | No — 3 idioms, `ui/tabs.tsx` unused | `trips/booking-dashboard.tsx:153` (raw `aria-pressed` buttons, 24px) |
| Filter chips | Copy-pasted ×5, sizes differ | `page.tsx:265` (`px-2.5 py-0.5 text-xs`) vs `bookings/page.tsx:43` (`px-3 py-1 text-sm`) |
| Icon-only buttons | Mostly labelled; 3 glyph idioms for the same thing | `trips/itinerary-editor.tsx:927` (`×`), `:1598` (`✕`), `price-lines-editor.tsx:212` (lucide `X`) |
| Reorder controls | No — text `↑`/`↓` ghost/sm vs lucide `ArrowUp` ghost/icon | `trips/itinerary-editor.tsx:1224` vs `admin/workflows/workflows-manager.tsx:269` |
| Touch targets ≥40px | No — 2 of 262 on the itinerary at 393 | `trips/itinerary-editor.tsx:1207–1270` (row toolbar) |
| Pending/disabled | Mostly; no spinner anywhere; 11 copies of `useAction()` | `notes/notes-thread.tsx:350` (submit not disabled while pending) |
| Status colours | Stored in one map (good) but PLANNED shares amber with attention states | `src/lib/trips.ts:127` |
| Amber meaning | No — ≥7 meanings | `trips/booking-row.tsx:77` ("Open now" = good news, in amber) |
| Red meaning | Two reds | `trips/booking-row.tsx:403` (`red-600`) vs `button.tsx` `destructive` |
| Brass `accent` | Unused for emphasis (1 badge, 1 hover) | `badge.tsx` `accent` variant |
| Off-palette hues | `blue-100` (IN_PROGRESS), `sky-100` (doc audience) | `src/lib/trips.ts:128`, `documents/documents-panel.tsx:246` |
| Hand-rolled pills vs `<Badge>` | No — ~12 hand-rolled `rounded-full px-2 py-0.5` spans | `trips/workflow-control.tsx:62` (`StatusPill`) |
| Type ladder | `text-xs` (285) > `text-sm` (237); sub-`xs` chips | `trips/booking-row.tsx:142` (`text-[10px]`), `multi-year-grid.tsx:31` (`text-[11px]`) |
| Heading font | Yes on h1/CardTitle/DialogTitle; sub-headings mixed p/h4 | `trips/booking-row.tsx:495` (`<p text-xs font-medium muted>` "Payment schedule") |
| Sentence case | Yes | — ("Create API key", "Copy URL" are acronyms) |
| Toasts end with "." | Yes (69/69 literal strings) | — |
| Empty states | Yes ("No files.", "No trips.") | — |
| Arrows as link markers | Yes — `→` only in ranges/routes, back links use `ChevronLeft` | — |
| Hover-only reveals | Yes — none exist | — |
| Focus rings on custom clickables | No — only `booking-board.tsx` adds one | `trips/booking-row.tsx:862` (raw expander button) |

---

## Findings — Major

### Entity deletes have no confirmation; row deletes confirm three different ways
- **Severity**: Major
- **Where**: `src/app/(app)/trips/[id]/page.tsx:1022-1030` (`<form action={deleteTrip}>` → `Button variant="destructive"`), `locations/[id]/page.tsx:979`, `contacts/[id]/page.tsx:123`, `presentations/[id]/page.tsx:183`, `trip-types/[id]/page.tsx`; confirmation idioms at `trips/lodging-manager.tsx:323` + 7 other `window.confirm`, `trips/itinerary-editor.tsx:405` (`Dialog`), `locations/location-booked-via.tsx` (inline confirm panel).
- **Evidence**: Code-only, not exercised (I did not delete the seeded trip). `deleteTrip` (`trips/actions.ts:365`) runs `prisma.trip.delete` straight from the form submit; the Danger-zone card's helper line "Deletes all days and items." is the only warning. Day/stay/booking/document deletes wrap the call in `window.confirm(...)`; the lodging-reorder prompt uses the `Dialog` primitive; booked-via uses an inline confirm card. Schedule-item delete (`itinerary-editor.tsx:1256`) confirms nothing.
- **Why it matters for this use case**: the highest-blast-radius actions in the app (whole trip, whole venue + its notes/documents) are the only ones without a second step, and the three idioms mean a contributor has no pattern to copy. `window.confirm` also renders unthemed and is suppressed by some mobile browsers.
- **Recommendation**: one `ConfirmDialog` (built on `components/ui/dialog.tsx`, `DialogFooter` with `destructive` + `outline` Cancel) used by every cascading delete; Danger-zone forms submit through it (client wrapper around the form). Record the rule (see "Destructive flow" above).

### Touch targets: 2 of 262 controls on the itinerary editor reach 44px; drag handle overlaps the time on every row
- **Severity**: Major
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:1203-1270` (row toolbar: handle, ↑, ↓, Move, Edit, Delete), `:556-570` (day handle 20×20), `:905-930` ("Schedule" 16×57 and "×" 20×16 on planned-location chips), `:1590-1600`/`:1745` (chip `✕` removers), `trips/booking-row.tsx:862`/`:1066` (expander buttons), `notes/notes-thread.tsx:128-140` + `documents/documents-panel.tsx:267-287` (Edit/Delete 16px raw buttons), `components/ui/checkbox.tsx` (`size-4` = 16px, used for booking filters and workflow steps), `components/contact-channels.tsx` (`size-7` = 28px Call/Text/Email).
- **Evidence**: `measure.js` at 393px: `/trips/<id>/itinerary` → 262 interactive elements, height bands `<24: 22, 24–31: 209, 32–39: 29, ≥44: 2`; `/trips/<id>` → 57 of 79 under 32px; `/booking` → 35 of 44; `/locations/<id>` → 50 of 55. `overlap.js`: on the first item row the time span is at x 63–147 and the drag handle at x 93–117 / ↑ button at x 121–154 on the same y — both overlap the text (`shots/design/itin-393-item-row.png`: "09:00–11:00" has the grip and arrow drawn over it). `shots/design/itin-393-vp.png` shows the day header title wrapping one word per line beside the four header controls. No `pointer: coarse` media query exists anywhere in `src/`.
- **Why it matters for this use case**: the itinerary is edited on the coach, on a phone; a 28px "Delete" sits 4px from "Edit" on every one of 25 rows. HTML5 drag (`draggable`) does not fire on touch, so the 24px handle is dead weight on phone while still stealing space from the time.
- **Recommendation**: (1) collapse the per-row toolbar into one `ghost/icon` "…" `DropdownMenu` below `sm:` (Move/Edit/Delete/↑/↓) and hide the handle below `sm:`; (2) add `@media (pointer: coarse) { min-height: 2.5rem }` (Tailwind `pointer-coarse:min-h-10`) to the Button base so `sm` stays 28px on desktop and grows on touch; (3) promote the raw Edit/Delete/Schedule/× buttons to `<Button variant="ghost" size="sm">` and chip removers to `size="icon"` + lucide `X`; (4) `Checkbox` → `size-5` with a `min-h-10` label hit area.

### "Links look like links" is honoured in 15 places and broken in 89
- **Severity**: Major
- **Where**: `hover:underline` (49): `trips/[id]/trip-header.tsx:70` ("Compare years"), `locations/[id]/page.tsx:588` (website URL), `:629`, `trips/page.tsx:167` (trip card title), `locations/page.tsx:129`, `presentations/page.tsx:54`, `page.tsx:204/298/357` (dashboard rows), `documents/documents-panel.tsx:227`, all 10 back links; raw text buttons with hover-only underline: `notes/notes-thread.tsx:131,138`, `documents/documents-panel.tsx:273,283`, `trips/booking-row.tsx:501,626,751`, `locations/location-payment-terms.tsx:135,254`, `trips/itinerary-editor.tsx:2144`. No underline class at all (40): `trips/[id]/days/[dayId]/page.tsx:179/191` (prev/next day), `bookings/cross-trip-bookings.tsx:202`.
- **Evidence**: `shots/design/trip-1280-vp.png` — "Compare years" (top right) is set in the same muted grey as "Wesley Pilgrimage · 26 Oct – 1 Nov 2026" with nothing marking it as a link. `shots/design/location-1280-vp.png` — "Edit  Delete" under each note look like metadata; the website URL is plain body text (it is an `<a>`). The dashboard's "All bookings" (link-quiet) and the trip page's "Bookings" (link-quiet) show the intended treatment working next to the broken ones.
- **Why it matters for this use case**: the rule was written precisely because hover-only underlines made "Booking"/"Files" look like plain text; the same bug now exists in 89 places, and on touch there is no hover at all.
- **Recommendation**: mechanical sweep: `hover:underline` → `link-quiet` on every `<Link>`/`<a>`; raw `<button className="hover:underline">` → `<Button variant="link" size="sm" className="h-auto p-0 link-quiet">` or `ghost/sm`. Add an ESLint `no-restricted-syntax` rule (or a grep in CI) for `hover:underline` outside `components/ui`.

### Amber means seven things; brass `accent` means nothing; two reds
- **Severity**: Major
- **Where**: `src/lib/trips.ts:127` (PLANNED = `bg-amber-100`), `trips/waiting-note.tsx:18,38` ("Your move"), `trips/booking-row.tsx:77` ("Open now"), `:113` ("No price"), `:142` ("stale"), `:405` (unscheduled installment), `:854/:963` (needs-info row tint `bg-amber-50`), `notes/notes-thread.tsx:116` (follow-up), `trips/[id]/page.tsx:621,856,905,938`, `admin/api-keys/api-keys-manager.tsx:84`, `components/offline-banner.tsx:28`, `locations/merge-location-panel.tsx:97`; reds: `trips/booking-row.tsx:403` + 10 more `red-600/700` vs `--destructive` on buttons/errors; off-palette `blue-100` (`trips.ts:128`), `sky-100` (`documents/documents-panel.tsx:246`, `documents/page.tsx:181`); `accent` (brass) used at `badge.tsx` (1 call site) and a hover in `google-place-field.tsx:144`.
- **Evidence**: `shots/design/booking-1280-vp.png` — Epworth row: amber row tint (needs info) + amber "Planned" pill (neutral status) + amber "Open now" (good news) + amber "Your move: Enquiry sent" (attention). Four amber tokens, three meanings, and the Planned pill nearly vanishes against the tinted row. Same screenshot: "£3,780.00 overdue" in `red-600` next to "Delete" buttons in claret elsewhere; "In progress" and "Tickets requested" in the only blue on the page; "Deposit paid" / "agreed" in emerald. `shots/design/trip-1280-vp.png` — "Includes stale or unconfirmed prices." in amber-700 directly under a brass-coloured warning icon, so the one place brass appears it reads as a warning.
- **Why it matters for this use case**: colour is the app's main way of saying "act on this" (the CLAUDE.md rule says to convey state with design cues, not prose). When the neutral baseline status is the same hue as the alarm, the alarm stops working; a planner scanning for "my move" sees every Planned row glow.
- **Recommendation**: make PLANNED neutral (`secondary`) and IN_PROGRESS `primary/10 text-primary` (verdigris, in palette) in `BOOKING_STATUS_CLASSES`; reserve amber for the four "we must act" states and move "Open now"/"Booked" to `emerald`/foreground; pick one red — map `overdue` to `text-destructive`; retire `sky` for document audience in favour of `outline`/`secondary` badges; add semantic `Badge` variants so the mapping lives in `badge.tsx` once. Record the rule (see "Status colours").

### Three tab/segmented idioms and five copies of the filter chip; `ui/tabs.tsx` is never imported
- **Severity**: Major
- **Where**: `trips/[id]/trip-header.tsx:80-100` (URL tabs as `<Link>` with `border-b-2 border-primary`), `trips/booking-dashboard.tsx:146-165` (Table/Board/Progress: raw `<button aria-pressed>` 24px tall inside a bordered group), filter chips copy-pasted at `trips/page.tsx:107-133`, `bookings/page.tsx:43-47` (`chip()` helper), `documents/page.tsx:113-131`, `contacts/page.tsx:65-84`, `page.tsx:263-282` (a smaller `px-2.5 py-0.5 text-xs` variant); `components/ui/tabs.tsx` has 0 importers.
- **Evidence**: `shots/design/booking-1280-vp.png` vs `shots/design/trips-1280-vp.png` vs `shots/design/trip-1280-vp.png`: three different "pick one of N" controls (underline tabs, icon segments, pill chips) with three active-state treatments (`border-primary`, `bg-muted`, `bg-muted font-medium`). Measured at 393: segment buttons 24px, chips 22–30px.
- **Why it matters for this use case**: users learn one "this switches the view" shape; three shapes means three lessons, and the copy-pasted chips already drift (home uses `text-xs`, others `text-sm`).
- **Recommendation**: `FilterChip` component (`src/components/filter-chip.tsx`, `rounded-full border px-3 py-1 text-sm min-h-9`) for URL filters; `Tabs variant="line"` from `ui/tabs.tsx` for the booking view switcher; keep `trip-header` as the one URL-segment nav but style its active state with the same `after:` underline tokens `tabs.tsx` uses.

### Primary button, size and create-verb are decided per file
- **Severity**: Major
- **Where**: "Archive trip" `trips/[id]/page.tsx:708` (`default` = primary) vs "Archive location" `locations/[id]/page.tsx:979` (`destructive`) vs "Unarchive" `presentations/[id]/page.tsx:162` (`outline`); "New template" `trips/page.tsx:98` (default/default) vs `trip-types/[id]/page.tsx:111` (outline/sm); "Add workflow" `admin/workflows/workflows-manager.tsx:93` (outline/default) vs "+ Add stay"/"+ Add note"/"+ Add cost" (outline/sm) vs "Add line" `price-lines-editor.tsx:218` vs "Create link/feed/user/API key" (default); role "Save" `admin/users/users-manager.tsx:160` (outline/sm) vs every other Save (default); `/new` forms use size `default` (`trip-form.tsx:282`, `location-form.tsx:260`, `contact-form.tsx:181`) while identical inline forms use `sm` (`costs-manager.tsx:122`, `category-form.tsx:60`, `region-form.tsx:154`); two primaries in one panel at `documents/documents-panel.tsx` (Upload + Save), `trips/booking-row.tsx` ("Save booking" + "Log payment"), `trips/[id]/days/[dayId]/day-timeline.tsx`.
- **Evidence**: tally from `btn-inventory.py`: 178 buttons → ghost/sm 55, outline/sm 47, default/sm 30, default/default 13, outline/default 8, ghost/default 6, destructive/default 6, ghost/icon 4, secondary/sm 3, destructive/sm 2, ghost/icon-sm 1. `shots/design/trip-1280-vp.png`: the Details card's "Save as template" (outline, top-right) and "Edit" (outline with pencil, bottom-left) are the same weight but placed at opposite corners; the Itinerary card header mixes a ghost ("Expand all") with three outlines so "Expand all" reads as a label.
- **Why it matters for this use case**: `default` is the verdigris fill — the one thing on a page that says "do this". When "Archive trip" wears it but "Delete trip" is claret and "Archive location" is also claret, the colour no longer predicts severity.
- **Recommendation**: adopt the "One primary per view", "Create verbs" and "Sizes" rules above; fix the five named outliers (Archive trip → `outline`; users "Save" → `default/sm`; "New template" → `default` on both pages; "Add workflow" → "+ Add workflow" outline/sm; "Add line" → "+ Add line").

## Findings — Minor

### Reorder and remove controls use three glyph idioms
- **Severity**: Minor
- **Where**: `trips/itinerary-editor.tsx:1218-1235` (`↑`/`↓` text in ghost/sm Buttons), `admin/regions/regions-manager.tsx` (`↑`/`↓`), `admin/workflows/workflows-manager.tsx:267-284` (lucide `ArrowUp`/`ArrowDown` in ghost/icon); removers: `itinerary-editor.tsx:927` (`×`), `:1598`/`:1745` (`✕`), `price-lines-editor.tsx:212` + `google-place-field.tsx:113` (lucide `X`).
- **Evidence**: `shots/design/itin-1280-vp.png` shows the thin text arrows next to the lucide grip icon at a different stroke weight. All have `aria-label`s (good).
- **Why it matters for this use case**: typographic arrows render at text weight and vary by font; lucide icons match the rest of the iconography and size with `[&_svg]:size-4`.
- **Recommendation**: lucide `ArrowUp`/`ArrowDown`/`X` in `size="icon"` buttons everywhere; record "never a text glyph" (see "Sizes" rule).

### Back link: same pattern, hover-only underline, placed top-left on nine pages and top-right on one
- **Severity**: Minor
- **Where**: `locations/[id]/page.tsx:501-517` (inside `flex justify-between` beside the `<h1>`); the other nine (`trips/[id]/trip-header.tsx:45`, `contacts/[id]/page.tsx:49`, `presentations/[id]/page.tsx:60`, `trip-types/[id]/page.tsx:53`, `admin/regions/page.tsx:59`, `trips/new`, `locations/new`, `presentations/new`, `trips/compare`) sit above the title.
- **Evidence**: `shots/design/location-1280-vp.png` ("‹ All locations" top-right) vs `shots/design/trip-1280-vp.png` ("‹ All trips" top-left).
- **Why it matters for this use case**: the `ChevronLeft` rule is followed, but a back control that moves changes the muscle memory between the two most-used detail pages.
- **Recommendation**: extract `<BackLink href label>` (`ChevronLeft` + `text-sm text-muted-foreground link-quiet`) and render it above the `<h1>` on all ten pages.

### Pending state: 11 copies of `useAction()`, no spinner, two buttons never disable
- **Severity**: Minor
- **Where**: `function useAction()` duplicated in `admin/workflows/workflows-manager.tsx:51`, `trips/itinerary-editor.tsx:138`, `trips/[id]/days/[dayId]/day-timeline.tsx:22`, `trips/trip-todoist-panel.tsx:19`, `trips/share-manager.tsx:43`, `trips/lodging-manager.tsx:44`, `trips/booking-row.tsx:53`, `locations/host-site-panel.tsx:23`, `calendar-feeds/calendar-feed-manager.tsx:25`, `notes/notes-thread.tsx:36`, `settings/todoist-settings.tsx:25`; `notes/notes-thread.tsx:350` (submit `<Button>` has no `disabled={pending}`), `locations/google-place-field.tsx:112` (Clear).
- **Evidence**: grep: 93 `disabled={…pending…}` across 34 files; `animate-spin` appears twice in `src/`; form-driven actions show "Saving…"/"Creating…" (9/3 labels) while direct-call actions only dim the button.
- **Why it matters for this use case**: on a slow coach connection a direct-call "Delete" that just goes 50% opaque invites a second tap; the duplicated helper is where the fix would have to be made eleven times.
- **Recommendation**: move `useAction()` to `src/lib/use-action.ts`, have it return `{ pending, run, buttonProps }` where `buttonProps = { disabled: pending, "aria-busy": pending }`, and let `Button` render a `Loader2 animate-spin` when `aria-busy`.

### Heading hierarchy: card titles are `<div>`s, card sub-sections are `<p>`s, and every `CardTitle` re-declares `text-base`
- **Severity**: Minor
- **Where**: `components/ui/card.tsx:33` (`CardTitle` is a `div`, already `text-base font-heading`); 68 of 70 call sites pass `className="text-base"` (e.g. `trips/[id]/page.tsx:579,610,726,810`); sub-headings as `<p className="text-xs font-medium text-muted-foreground">` at `trips/booking-row.tsx:495`, `locations/location-payment-terms.tsx:129` vs `<h4 className="text-sm font-medium">` at `locations/[id]/page.tsx:585`, `documents/trip-documents-hub-view.tsx:213`; only 2 `DialogTitle`s and 10 `h2–h4` in the whole app.
- **Evidence**: `shots/design/location-1280-vp.png` — "Current trips here", "Details", "Notes & contact log" are serif card titles (good) but the card sub-labels are sans `text-xs`, so the serif/sans boundary moves between cards; screen readers get one `<h1>` and no `<h2>` on any app page.
- **Why it matters for this use case**: Fraunces on headings is the page's personality per `globals.css`; it is applied by element (`h1–h4`) in base CSS and by class on `CardTitle`, so any sub-heading that is a `<p>` silently drops it.
- **Recommendation**: render `CardTitle` as `<h2>` (polymorphic `as`/`asChild`), drop the 68 redundant `text-base` overrides, and use `<h3>`/`<h4>` for in-card sections.

### Type ladder is bottom-heavy and dips below `text-xs`
- **Severity**: Minor
- **Where**: counts in `src/`: `text-xs` 285, `text-sm` 237, `text-base` 73, `text-lg` 1, `text-xl` 3, `text-2xl` 27; sub-xs chips at `trips/booking-row.tsx:142` and `trips/price-lines-editor.tsx:30` (`text-[10px]`), `trips/multi-year-grid.tsx:31,44` (`text-[11px]`), `template-chip.tsx` (`text-[10px] uppercase`).
- **Evidence**: `shots/design/booking-1280-vp.png` — "list", "stale", "agreed" chips are 10px type inside 20px pills next to 14px prices.
- **Why it matters for this use case**: more than half the UI text is 12px; on a phone at arm's length the chips that carry the most consequential state ("stale", "No price") are the smallest things on screen.
- **Recommendation**: outlaw `text-[10px]`/`text-[11px]`; make those chips `<Badge variant="outline">` (`text-xs`, `h-5`); audit `text-xs` on anything a user must read to act (money, status, dates) and lift to `text-sm`.

### List cards: whole-card link on `/admin`, title-only link on `/trips`, `/locations`, `/presentations`
- **Severity**: Minor
- **Where**: `admin/page.tsx:47` (`<Link className="block"><Card…>`), vs `trips/page.tsx:167`, `locations/page.tsx:129`, `presentations/page.tsx:54`, `trip-types/page.tsx:53`, `contacts/contacts-list.tsx:50` (title-only `hover:underline`); `trips/lodging-nights.tsx:105` (whole block link).
- **Evidence**: `shots/design/trips-1280-vp.png` — trip cards are 220px wide, 18px of which (the title text) is the link; `measure.js` at 393 reports `a 18x149 "Wesley Pilgrimage 2026"`.
- **Why it matters for this use case**: a card that looks tappable but only responds on its title is the classic touch miss.
- **Recommendation**: adopt the `/admin` pattern (whole card is the link, badge outside the link text) via a `LinkCard` wrapper; keep `hover:border-foreground/25` as the affordance.

## Findings — Polish

### Custom clickables get the browser focus outline, Buttons get the 3px ring
- **Severity**: Polish
- **Where**: 38 raw `<button>`s (`trips/booking-row.tsx:862,1066`, `trips/booking-dashboard.tsx:153`, `notes/notes-thread.tsx:128`, …), `draggable` spans, filter-chip `<Link>`s; only `trips/booking-board.tsx` adds `focus-visible:` classes.
- **Evidence**: `overlap.js` focused the notes "Edit" button: computed `outline: auto 1px` in `ring/50` vs the Button primitive's `ring-3 ring-ring/50` box-shadow.
- **Recommendation**: a `focus-ring` utility in `globals.css` applied to every custom clickable; long-term, replace the raw buttons with `Button`.

### "Wrap up this trip" is a verb-phrase card title
- **Severity**: Polish
- **Where**: `trips/[id]/page.tsx:623`.
- **Evidence**: the only `CardTitle` that is not a noun phrase ("Details", "Lodging", "Documents", "Cost estimate", "Danger zone"); the "UI copy" rule says headings are nouns.
- **Recommendation**: "Wrap-up" or "After the trip".

## What works well (do not break)

- Page titles: 26 identical `<h1 className="text-2xl font-semibold">`, Fraunces via base CSS — the one typographic rule that is fully consistent.
- Toast copy: every literal success/error string is a short fact ending in a period ("Saved.", "Stay removed.", "Payment logged."); empty states are two words ("No files.", "No trips.").
- Cancel is `ghost/sm` in all seven inline forms; row-level Delete is uniformly `ghost/sm text-destructive`; Danger-zone deletes are uniformly `destructive` — the two-tier idea is sound, it just isn't written down.
- No hover-only reveals anywhere (`group-hover:`/`opacity-0` → 0 hits), so nothing is hidden from touch users.
- `BOOKING_STATUS_CLASSES` keeps the status colour map in one place (`src/lib/trips.ts:126`) — the fix for the amber finding is a four-line edit.
- Arrows: `→` appears only in ranges and travel routes; every back link uses `ChevronLeft` — the recorded rule is followed.
- Sentence case throughout; the only Title-case labels are acronyms/proper nouns ("Create API key", "Connect Todoist").
- `ContactChannels` icon links carry both `aria-label` and `title`, and every `size="icon"` Button has an `aria-label`.
