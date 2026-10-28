# Mobile-friendliness audit — Tour-Planner (commit 2ebc2ac)

Method: Playwright (chromium, `isMobile` + `hasTouch`, DPR 2) at 393×852 for every route below and 360×740 for the busiest nine; per page measured `scrollWidth > innerWidth` (plus the widest element past the right edge), tap targets < 40×40 CSS px among `a, button, [role=button], checkbox/radio, select, summary, [draggable]`, adjacent targets < 8 px apart, visible text < 12 px, tables, fixed/sticky elements, inputs < 16 px. Exercised: nav menu, item/day/travel editors, add-item form, booking card expand + price-lines editor, status popover, move-day dialog, location Details edit, merge preview, contact edit, share-link mint, toast. Screenshots: `shots/mobile/` (`393-<route>.png` viewport, `-full.png` full page, `360-*` small Android). Raw numbers: `mobile-results.json`.

## Executive summary

- The app is fundamentally mobile-capable: 35 of 36 routes have **no horizontal overflow**, forms stack to one column with native date/time pickers and 16 px inputs (no iOS zoom), the booking dashboard swaps its table for cards below `sm`, trip tabs are a scroll row, and the public share page / print page / day page render cleanly at 360 px. Dialogs fit the viewport and stack their buttons.
- The **itinerary editor** (`/trips/<id>/itinerary`) is the one page that is effectively unusable on a phone: a 267 px row of ghost buttons + drag grip leaves ~100 px for the item content, so every day title and item wraps 4–6 lines, the drag grip paints over the time text, and 253 of 255 targets are under 40 px. (Major)
- The **merge-location confirmation** pushes its *Cancel* button completely off-screen (x = 422 on a 393 px viewport, no horizontal scroll), leaving only a clipped destructive "Merge and delete …" button. (Major)
- **Tap targets are systemically small** because the button scale tops out at 32 px (`h-8`; `sm` = 28, `xs` = 24), checkboxes are 16 px and contact phone/SMS/email icons are 28 px with 4 px gaps. The on-trip flows that matter most (ticking workflow steps, calling a venue, quick-editing an item) all sit on these. (Major)
- `/schedule-categories` has a real 4–5 px horizontal overflow at both widths. (Minor, easy)
- Smaller issues: Money-panel overdue lines are truncated so the due date is lost; the hamburger menu does not visibly mark the current section; several informational badges are 10–11 px; the share-URL field is 12 px (will zoom on iOS); drag-and-drop is mouse-only (fallbacks exist); the PWA manifest ships only an SVG icon.
- `/calendar-feeds` is listed in the brief but is a 404 (it is a component folder, not a route; the UI lives on `/settings`, the trip page and the trip-type page).

## Per-route table (393 px unless noted)

| Route | Overflow? | Targets < 40 px / total | Notable issue |
|---|---|---|---|
| `/` | no | 26 / 27 | "Everyone / Only mine" pills 22 px tall, 4 px apart; 10 px category chips |
| `/trips` | no | 13 / 13 | fine |
| `/trips/<id>` (overview) | no (text clipped inside Money card) | 59 / 72 | overdue payment lines truncated; 12 px share-URL input; lodging grid 10–11 px text |
| `/trips/<id>/itinerary` | no | **253 / 255**, 162 adjacent pairs < 8 px | action cluster 267 px wide, content ~100 px, grip overlaps time; same at 360 |
| `/trips/<id>/booking` (table view → cards) | no | 40 / 44 | 16 px checkboxes, 28 px contact icons; table correctly replaced by cards |
| `/trips/<id>/booking?view=progress` | no | 51 / 51 | 16 px select checkboxes, step chips 20 px tall |
| `/trips/<id>/booking?view=board` | no (inner `overflow-x-auto`) | n/a | 80 %-wide snap columns; card titles only tappable via `hover:underline` button |
| `/trips/<id>/print` | no | 4 / 4 | fine |
| `/trips/<id>/days/<day1>` | no | 21 / 21 | quick "Edit" is 21×16 px glued to the item title |
| `/trips/<id>/days/<day5>` (rough plan) | no | 6 / 6 | fine |
| `/trips/<id>/today` | no | 25 / 25 | same as day page |
| `/trips/<template>` | no | 16 / 18 | 11 px "Night n" labels |
| `/trips/new` | no | 20 / 20 | stacks well; 16 px currency checkboxes |
| `/trips/compare` | no | 2 / 2 | fine |
| `/locations` | no | 24 / 24 | fine |
| `/locations/<wesley>` | no, but merge Cancel at x = 422 is unreachable | 53 / 54 | "All locations" back link wraps beside the title; Edit/Delete 21×16 cost links |
| `/locations/<lincoln>` | no | 47 / 48 | as above |
| `/locations/<new-room>` | no | 42 / 42 | as above |
| `/locations/new` | no | 10 / 10 | fine |
| `/contacts` | no | 49 / 49 | 28 px call/text/email icons, 4 px gaps |
| `/contacts/<id>` | no | 8 / 9 | fine |
| `/bookings` | no | 52 / 53 | same contact icons; 10 px price badges |
| `/documents` | no | 13 / 13 | Search button wraps under the input |
| `/presentations` | no | 3 / 3 | fine |
| `/settings` | no | 5 / 5 | fine |
| `/admin` | no | 2 / 9 | fine |
| `/admin/workflows` | no | 97 / 97, 39 pairs < 8 px | Us/Venue toggle 30×24; ↑ ↓ 🗑 with 0 px gap |
| `/admin/regions` | no | 22 / 22 | Edit/Delete 4 px apart |
| `/admin/users` | no | 10 / 10 | fine |
| `/admin/api-keys` | no | 4 / 4 | 13 px checkbox |
| `/admin/places` | no | 2 / 2 | fine |
| `/schedule-categories` | **yes — 397 px at 393, 398 px at 360** | 53 / 53, 41 pairs < 8 px | row action cluster (↑ ↓ Edit Delete) overflows the card |
| `/trip-types` | no | 19 / 19 | 28 px colour swatches, 6 px apart |
| `/calendar-feeds` | — | — | **404** (not a route) |
| `/share/<token>` (public) | no (393 and 360) | 0 / 0 | clean |
| `/login` | no | 1 / 1 | fine |

"Targets < 40 px" counts every interactive element under 40 px in either dimension, so the default 32 px `Button` dominates these numbers; the *Notable issue* column calls out the ones that actually hurt.

## Findings

### Itinerary editor rows collapse to a ~100 px content column on phones
- **Severity**: Major
- **Where**: `/trips/<id>/itinerary` — `src/app/(app)/trips/itinerary-editor.tsx:556-640` (day header: grip + title column + `flex shrink-0 items-center gap-1` with ↑ ↓ "Edit day" "Delete") and `:1073-1262` (item row: `flex items-start justify-between gap-3` with a `shrink-0` cluster of grip + ↑ + ↓ + "Move" + "Edit" + "Delete"). The whole 2 502-line file has 6 responsive variants.
- **Evidence**: `393-trips_…_itinerary.png`, `393-itin-clip.png`, `360-trips_…_itinerary.png`. Measured action cluster = 267 px of a 361 px card. "Day 1 — Arrive & Salisbury · Salisbury · Mon, 26 Oct 2026" wraps to 6 lines in a 97 px column; "Coach to Salisbury / Heathrow T5 → Sarum College" wraps to 6 lines; the booking pill, label and contact are squeezed into three 60 px columns. The drag grip (`aria-hidden`, `title="Drag to move"`) is painted on top of "09:00–11:00". 253 of 255 targets are < 40 px and 162 pairs are < 8 px apart. Same at 360 px.
- **Why it matters for this use case**: this is the page a planner opens on the coach to fix a time or move an item; at this width nothing is readable and the four 28 px ghost buttons per row are hard to hit without tapping the wrong one (Delete is adjacent to Edit).
- **Recommendation**: below `sm`, replace the per-row cluster with one 40 px `DropdownMenu` trigger (the file already imports `DropdownMenu*` for "Move") holding Move up / Move down / Move to day… / Edit / Delete, keep the inline buttons `hidden sm:flex`; hide the grips on touch (`hidden sm:inline-flex` or Tailwind 4's `pointer-coarse:hidden`) since HTML5 DnD never fires on touch anyway; let the day header stack (`flex-col items-start sm:flex-row sm:items-center`) so the title has the full width.

### Merge-location confirmation pushes *Cancel* off-screen
- **Severity**: Major
- **Where**: `/locations/<id>` danger zone — `src/app/(app)/locations/merge-location-panel.tsx:107-118` (`<div className="flex gap-2">` with a `whitespace-nowrap` `Button` whose label embeds the full source name).
- **Evidence**: picked "Wesley's Chapel & Leysian Mission" as the keep target for "Wesley's Chapel & Museum of Methodism". "Merge and delete Wesley's Chapel & Museum of Methodism" measures 398×32 at x = 16 (clipped at the card edge), *Cancel* sits at x = 422–488 on a 393 px viewport; `document.documentElement.scrollWidth` stays 393, so it cannot be scrolled to. `393-merge-buttons.png`.
- **Why it matters for this use case**: the only reachable control in a destructive, irreversible flow is the destructive one; the user has to reload to back out.
- **Recommendation**: `flex flex-col gap-2 sm:flex-row`, and shorten the label to "Merge and delete" (the paragraph above already names both locations) or add `h-auto whitespace-normal text-left`. Same pattern check for `DialogFooter`-less confirm rows elsewhere (`categories-manager.tsx` edit row, `location-payment-terms.tsx`).

### Tap targets are systemically under 40 px, including the on-trip ones
- **Severity**: Major
- **Where**:
  - `src/components/ui/button.tsx:30-45` — `default` = `h-8` (32 px), `sm` = `h-7` (28), `xs` = `h-6` (24), `icon-sm` = 28; almost every list/row action uses `size="sm"`.
  - `src/components/contact-channels.tsx:80` — call / SMS / WhatsApp / email links are `size-7` (28 px) with `gap-1` (4 px): `/bookings`, `/contacts`, day page, booking cards.
  - `src/components/ui/checkbox.tsx` (16 px) used for the Progress-view row selects, trip currencies, `/admin/api-keys` (13 px native).
  - `src/app/(app)/trips/[id]/days/[dayId]/day-timeline.tsx:254-262` — quick "Edit" is a 21×16 px `text-xs` link butted against the item title ("Check in & restEdit").
  - `src/app/(app)/trips/workflow-control.tsx:227-290` — step rows in the status popover are 272×20 with 16 px checkboxes.
  - `src/app/(app)/admin/workflows/*` — Us/Venue segmented toggle 30×24, ↑ ↓ 🗑 icon buttons with 0 px gap.
  - `src/app/(app)/page.tsx` — "Everyone / Only mine" pills 72×22, 4 px apart.
- **Evidence**: measured per page (table above); screenshots `393-trips_…_days_…png` (Edit glued to title), `393-status-popover.png`, `393-admin_workflows.png`, `393-contacts.png`.
- **Why it matters for this use case**: calling the venue from the day page, ticking "Tickets received", or quick-editing a running-late item are exactly the phone-on-the-coach actions; 20–28 px targets 4 px apart invite mis-taps (Edit next to Delete, Call next to Text).
- **Recommendation**: add a coarse-pointer rule rather than touching every call site — in `globals.css` `@media (pointer: coarse) { [data-slot=button] { min-height: 2.5rem } }` (or Tailwind 4 `pointer-coarse:min-h-10` in `buttonVariants`), set `checkbox` to `size-5` on coarse pointers, make `contact-channels.tsx` icons `size-9 gap-2` below `sm`, and give the day-page quick-edit a real `Button variant="ghost" size="sm"` with `ml-2` instead of an inline 12 px link. Keep adjacent destructive actions ≥ 8 px from their neighbours (`gap-2`).

### `/schedule-categories` overflows the viewport
- **Severity**: Minor
- **Where**: `src/app/(app)/schedule-categories/categories-manager.tsx:57-110` — `flex items-center justify-between gap-3` row with a `shrink-0` cluster of four `size="sm"` ghost buttons (182 px).
- **Evidence**: layout viewport grows to 397 px at 393 and 398 px at 360 (`innerWidth` reported 397/398, offender = the `↑↓EditDelete` cluster, right edge 397). `393-schedule_categories.png` shows "Presentation · 0 items" wrapping and the row bleeding past the card edge; the page pans sideways on a real phone. `/trip-types` uses the same swatch row but does not overflow.
- **Why it matters for this use case**: admin-only page, but a horizontally scrolling page reads as broken.
- **Recommendation**: `flex-wrap` on the row (`flex flex-wrap items-center justify-between gap-x-3 gap-y-1`) so the actions drop to a second line, or collapse Edit/Delete into the edit form like the built-in rows already do.

### Money panel truncates overdue payment lines, losing the due date
- **Severity**: Minor
- **Where**: `/trips/<id>` — `src/app/(app)/trips/[id]/page.tsx:936-950` (`<li className="truncate">` + `whitespace-nowrap` amount/venue/"was due" span).
- **Evidence**: span right edge = 447 px (393 viewport) / 431 px, clipped by the `li`: "£945.00 — Lincoln College, Oxford · was due Wed,…", "£2,590.00 — Sarum College · was due Sat, 26 Sept…". `393-money.png`. Same at 360.
- **Why it matters for this use case**: the panel exists to answer "what is overdue and since when"; on a phone the "when" is always cut off.
- **Recommendation**: drop `truncate`, render amount on one line and "venue · was due <date>" on a second `text-xs` line (the Follow-ups card on the dashboard already uses that two-line pattern).

### Hamburger menu does not show which section you are in
- **Severity**: Minor
- **Where**: `src/components/app-nav.tsx:85-108` — mobile `DropdownMenuItem`s mark the active route with `font-medium` only (computed 500 vs 400); menu items are 200×28.
- **Evidence**: `393-navmenu.png` — on `/trips/<id>` "Trips" is indistinguishable from the other nine items at a glance. The menu reaches every section (Dashboard … Admin, Sign out) and shows name · role; the desktop nav's `bg-muted` active treatment is not reused.
- **Why it matters for this use case**: with the trip tabs, back links and the hamburger all in play, orientation on a 393 px screen depends on this.
- **Recommendation**: reuse the desktop active classes (`bg-muted font-medium text-foreground`) on the item, or add `aria-current="page"` + a trailing `Check` icon; bump item height to ~40 px on coarse pointers (see tap-target finding).

### Location page header: back link squeezed beside a two-line title
- **Severity**: Minor
- **Where**: `src/app/(app)/locations/[id]/page.tsx:501-516` — `flex items-center justify-between` row holding the `h1` and the "All locations" link.
- **Evidence**: `393-loc-header.png` — link box 75×40 at x = 302, wrapping to "All / locations" with the chevron on the first line; the `h1` gets 286 px. `trip-header.tsx` puts the back link *above* the title and reads fine.
- **Why it matters for this use case**: venue names are long (museums, colleges); this is every location page.
- **Recommendation**: match `trip-header.tsx:44-51` — back link on its own line above the `h1` (`space-y-3`), no side-by-side flex.

### Trip header metadata orphans "Compare years" on its own line
- **Severity**: Polish
- **Where**: `src/app/(app)/trips/[id]/trip-header.tsx:54-74` (`sm:ml-auto` link inside a `flex-wrap` row).
- **Evidence**: `360-trip-header.png` / `393-trips_…png` — "In progress · Wesley Pilgrimage · 26 Oct – 1 Nov 2026" then "Compare years" alone on the next line; at 360 the date range also wraps, giving three metadata lines before the tabs.
- **Recommendation**: move "Compare years" into the tab row's trailing slot on mobile or render it as a `size="sm"` outline button next to the status badge; or shorten the date to "26 Oct – 1 Nov".

### Informational text at 10–11 px
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/itinerary-timeline.tsx:415` (category chip "VISIT/MEAL", `text-[10px]`, used on dashboard, overview, day page, print, share); `src/app/(app)/trips/booking-row.tsx:102,134,142` and `price-lines-editor.tsx:30` ("list" / "agreed" / "stale" badges, 10 px); `src/app/(app)/trips/lodging-nights.tsx:67,77,87` (night label 11 px, status pill 10 px, "+n overlapping stay" 10 px); `src/app/(app)/schedule-categories/categories-manager.tsx:66` ("Built-in" 10 px); `multi-year-grid.tsx:31-77` (11 px).
- **Evidence**: 16–21 sub-12 px text nodes on the trip overview / itinerary / print pages, 8 on `/bookings`. The "stale" badge is the only cue that a price needs re-checking.
- **Why it matters for this use case**: "stale", "agreed" and the lodging status pills carry state the planner acts on; at 10 px on a 2× phone they read as decoration.
- **Recommendation**: floor at `text-xs` (12 px) — the chips are already uppercase/tracked so they stay compact; keep 11 px only for mono dates.

### Share-link URL field is 12 px and will zoom on iOS
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/share-manager.tsx:157` (`className="h-8 font-mono text-xs"` on a read-only `Input`); `src/app/(app)/calendar-feeds/calendar-feed-manager.tsx` uses the same pattern (code-only, not exercised on a device).
- **Evidence**: measured 12 px; every other input is 16 px on mobile thanks to `input.tsx` `text-base md:text-sm`. iOS Safari zooms the page when focusing any form control under 16 px — tapping the field to select/copy the link will zoom in and leave the page zoomed.
- **Recommendation**: let it inherit `text-base` below `md` (`font-mono md:text-xs`), or replace the field with the existing "Copy link" icon button plus a non-editable `code` span.

### Drag-and-drop is mouse-only; grips are dead weight on touch
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/itinerary-dnd.tsx:7` (comment acknowledges HTML5 drag is mouse-only), `itinerary-editor.tsx:556-575, 1201-1216` (34 `draggable` grips, 32 `aria-hidden`), `src/app/(app)/trips/booking-board.tsx:427` (9 draggable cards).
- **Evidence**: code + the overlapping grip in `393-itin-clip.png`. Fallbacks exist (↑ ↓, "Move" to-day menu, status popover on the board), so this is not blocking.
- **Recommendation**: hide the grips on coarse pointers (`pointer-coarse:hidden`) so they stop eating width and stop painting over content.

### Hover-only link affordances
- **Severity**: Polish
- **Where**: `trip-header.tsx:70` ("Compare years", `hover:underline`), `booking-board.tsx` card title button (`font-medium hover:underline` — the only way to open the card dialog on the board), `trips/[id]/page.tsx:945` (venue link in Money panel). The house rule (`CLAUDE.md` "Links look like links") asks for `link-quiet`.
- **Evidence**: `393-booking-board.png` — card titles look like plain headings; nothing on a touch screen indicates they open the detail dialog. `grep group-hover|opacity-0` found no hidden-until-hover controls, which is good.
- **Recommendation**: `link-quiet` on those three, or a chevron on the board card.

### PWA manifest ships only an SVG icon; no safe-area handling
- **Severity**: Polish (code-only, not exercised on a device)
- **Where**: `src/app/manifest.ts` (single `/icon.svg` `sizes: any`), `src/app/layout.tsx:28-41` (`appleWebApp.capable: true`, viewport `width=device-width, initialScale 1, maximumScale 5`, no `viewportFit`), no `env(safe-area-inset-*)` anywhere in `src/`.
- **Evidence**: grep. Viewport meta is correct (pinch-zoom allowed). iOS ignores SVG manifest icons and there is no `apple-touch-icon`, so "Add to Home Screen" gets a screenshot tile. Because `viewport-fit` is not `cover`, the sticky header and the top-centre toast stay out of the notch, so the missing safe-area padding is harmless today — but any future `viewport-fit=cover` needs `pt-[env(safe-area-inset-top)]` on `AppNav`.
- **Recommendation**: add 192/512 px PNGs (`purpose: "any maskable"`) and an `apple-touch-icon` via `metadata.icons`.

### `/documents` search button wraps under the input
- **Severity**: Polish
- **Where**: `src/app/(app)/documents/page.tsx` search form.
- **Evidence**: `393-documents.png` — input 640 px wide, "Search" button alone on the next line, unlike `/locations` where the pair sits on one row.
- **Recommendation**: same `flex gap-2` + `flex-1` input as `/locations`.

## What works well (keep)

- **Zero horizontal overflow** on 35/36 routes at 393 and all nine at 360; cards and text wrap rather than push.
- **Booking dashboard goes card-based below `sm`** (`booking-dashboard.tsx:234/270`) instead of squeezing a 5-column table; the expanded card's Label / Confirmation / Booked-on / price-lines / payment / upload sections all stack and stay tappable.
- **Forms are phone-ready**: trip, location, contact, day, item and travel editors stack to one column, inputs are 16 px on mobile (`input.tsx` `text-base md:text-sm`, same for textarea) so iOS doesn't zoom, and dates/times use native `type=date` / `type=time` pickers.
- **Trip section tabs** are a `-mx-4 overflow-x-auto` scroll row with `aria-current` and a clear underline; the sticky header is only 48 px.
- **Dialogs fit**: the move-lodging dialog is 229 px tall with full-width stacked buttons (`DialogFooter` `flex-col-reverse sm:flex-row`), the board detail dialog has `max-h-[85vh] overflow-y-auto`, close button top-right reachable.
- **Public share page and print page** are clean, readable single-column layouts at 360 px — exactly what participants and drivers need.
- **Dashboard "Happening now" / day page** read well on a phone: time gutter, chips, gap lines, overnight line, contact icons — just enlarge the targets.
