# Findings — Detailed tour planning work (itinerary grind, booking details, constraints)

Audited hands-on at 1280 and 393 widths against the seeded "Wesley Pilgrimage 2026" trip (Playwright scripts
`dp-lib.js`, `t1.js`…`t9e.js` in the scratchpad; screenshots under `shots/detailed-planning/`). Every edit made
during the audit was reverted; the seeded data is as found.

## Executive summary

- The time-editing engine is solid and behaves exactly as `docs/itinerary-time-editing.md` says: the edit ripple
  shifts later items by the trailing-edge delta, a fixed-time anchor stops it, cross-day moves land by time, day
  reorders preview lodging before writing. The booking side is the strongest part of the app: one expand-to-edit
  panel per venue with price lines, live total, payment log, schedule, documents and contact — no modals — and a
  two-click workflow popover plus a one-click Progress view with honest bulk feedback.
- The biggest risks are safety and data loss: an item **Delete is one click with no confirm and no undo, and it
  cascades the item's booking and its payments** (the Day 1 coach item carries the £4,200 Wessex booking); and
  **editing a travel leg wipes its title** (the travel form has no title field, the action writes `null`).
- The full itinerary editor **does not work at phone width** (six per-row controls squeeze the content to ~100px;
  Day 3 alone is ~1,600px tall), while the phone-friendly Day page has no add / move / reorder and **no link to or
  from the editor or the Overview** — the two surfaces don't know about each other.
- For constraints: the data model has five places to write "coach can't enter the Close" and the split is only
  explained by form labels; worse, **`Location.bookingNotes` is never rendered anywhere**, and none of
  `scheduleLimitations` / `notes` / host-site notes resurface in the item editor, Day page, or booking row, so a
  "No groups during Sunday 11:00 service" limitation is invisible while scheduling a Sunday 10:00 tour at that site.
- Smaller friction: the ripple is silent (toast says "Item saved." whether 0 or 4 items moved; the overlap warning is
  styled as success and leaves no trace), Day-page quick-edit keeps a stale draft after Cancel, no Escape anywhere,
  "Use list price" copies stale 2024 prices without a flag, and "Your move: Menu chosen" uses the same vocabulary as
  the done-stage pill beside it.

---

## Major

### Item "Delete" is one click, no confirm, no undo — and cascades the item's booking + payments
- **Severity**: Major
- **Where**: `/trips/<id>/itinerary` — `src/app/(app)/trips/itinerary-editor.tsx:1256-1263` (Delete button, `run(() => deleteScheduleItem(item.id))`); `src/app/(app)/trips/actions.ts:873-898` (hard `scheduleItem.delete`); `prisma/schema.prisma:484` (`Booking.scheduleItem … onDelete: Cascade`) and `:586` (`Payment.booking … onDelete: Cascade`).
- **Evidence**: Added a throwaway item to Day 3, clicked its red "Delete" (sits 44px from "Edit" in the same cluster): no dialog fired (my Playwright dialog hook logged nothing), toast "Item removed.", item gone (`t6.js`). By contrast "Delete day" (`itinerary-editor.tsx:621`) and "Delete stay" (`lodging-manager.tsx:323`) both `window.confirm`. Code-only, not exercised: deleting the Day 1 "Coach to Salisbury" item would cascade the Wessex Coaches booking (£4,200 agreed) and any payments on it.
- **Why it matters for this use case**: Weeks of grinding through a day means hundreds of Edit clicks right next to Delete; one mis-click destroys an item plus its booking record with no way back.
- **Recommendation**: Keep deletes fast but safe: (a) `window.confirm` only when the item has bookings/payments, one line stating the consequence ("Deletes its booking and 1 payment."), matching the day/stay pattern; and (b) for the plain case use a sonner toast with an `action: { label: "Undo" }` that re-creates the item (`addScheduleItem` with the serialized item, then `moveScheduleItem` to its old index) within ~8s. Also apply to `deletePayment` ("Remove", `booking-row.tsx:748-756`).

### Editing a travel leg silently blanks its title (and attaches a category)
- **Severity**: Major
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:1927-1960` (`TravelFields.submit` — no `title` in the payload, no Title input); `src/app/(app)/trips/actions.ts:667` (`toItemScalars`: `title: d.title || null`); `:1898-1901` (`categoryId: initial?.categoryId ?? categories.find(Travel)`).
- **Evidence**: Opened Edit on Day 3's "Coach to Oxford", ticked "Fixed time", "Save travel". The row re-rendered as "Coach to Lincoln College, Oxford" with a new TRAVEL chip; DB confirmed `title = ''`, `categoryId` now set (`t2.js`; restored by hand). The MCP `add-schedule-item`/seed can set a title on a travel item, so planner-written labels ("Coach to Oxford", "Transfer via M4") are lost on the first web edit.
- **Why it matters for this use case**: Any time tweak or fixed-time toggle on a travel item destroys its label; the planner won't notice until the printed itinerary says "Coach to Lincoln College, Oxford".
- **Recommendation**: Pass `title: initial?.title ?? undefined` through `TravelFields.submit` the way `QuickEdit` passes structural fields unchanged (`day-timeline.tsx:214-230`), or add a "Label (optional)" Input to `TravelFields`. Only default `categoryId` to the Travel category when creating, never on edit.

### Full itinerary editor is unusable at phone width; the Day page can't do structural edits
- **Severity**: Major
- **Where**: `/trips/<id>/itinerary` at 393px — `src/app/(app)/trips/itinerary-editor.tsx:1204-1266` (ItemRow control cluster: grip, ↑, ↓, Move, Edit, Delete in one `flex shrink-0` row); `src/app/(app)/trips/[id]/days/[dayId]/page.tsx` (no add/reorder/move/delete).
- **Evidence**: `shots/detailed-planning/t5-editor-mobile-day3.png`, `t5-editor-mobile-full.png`: the six controls (each 28px tall, 33–59px wide) take the row's width, the content column collapses to ~100px, "Lunch at the New Room café" wraps one word per line, the time overlaps the grip icon, and the amber "Your move" pill justifies into two columns. Page height 9,468px; no horizontal overflow. Day page at 393 (`t5-day3-mobile.png`) is clean but offers only time/title/notes quick-edit and "Slide times".
- **Why it matters for this use case**: Reordering, moving between days, adding travel, and deleting are editor-only, so on a phone (the on-the-coach replanning case the docs call out) the planner has to fight this layout.
- **Recommendation**: Below `sm`, collapse ↑ ↓ Move Edit Delete into one `DropdownMenu` (an ellipsis `Button size="icon"`) keeping only the grip inline — the Move-to-day `DropdownMenu` already exists at `:1233-1251`, so extend it with "Move up / Move down / Edit / Delete" items. Alternatively stack the cluster under the content (`flex-col sm:flex-row`). And give the Day page at least "+ Add item" (mount `ItemFields` with `defaultLocationId`) so the mobile surface isn't read-mostly.

### Day page, itinerary editor and Overview are not linked to each other
- **Severity**: Major
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:540-630` (DayCard header has no link; `t9d.js` reported `day card links: []`); `src/app/(app)/trips/itinerary-overview.tsx:135-200` (DayRow is a `Collapsible`, no link to the day); only `src/app/(app)/trips/[id]/today/page.tsx:47`, the dashboard (`src/app/(app)/page.tsx:235`) and booking-row session links (`booking-row.tsx:275`) reach `/days/<dayId>`.
- **Evidence**: From the editor or the Overview there is no way to open Day 3's page except via "Today" (which only works while the trip is in progress) or a booking's covered-session link. From the Day page, "Full itinerary" and "All options" link back; the reverse is missing. The Day page also has no "Edit day" (title/notes/city live only in the editor's "Edit day" form, `itinerary-editor.tsx:609-616`).
- **Why it matters for this use case**: The Day page is the fast, mobile-safe quick-edit surface; a planner working the editor on a desktop and the day page on a phone has to know the URL pattern to switch.
- **Recommendation**: Make "Day N — title" in the DayCard header a `Link` to `/trips/<id>/days/<dayId>` (ChevronRight icon, `link-quiet`), add the same link to each Overview DayRow header, and add an "Edit day" ghost button on the Day page header that deep-links to `/itinerary#day-<id>` (the `scroll-mt-20` anchors already exist).

### Location constraints never resurface where scheduling happens
- **Severity**: Major
- **Where**: `src/app/(app)/locations/[id]/page.tsx:795` (Schedule limitations), `:819-821` (Internal notes), `src/app/(app)/locations/host-site-panel.tsx:110-124` (Staff/Logistics notes) are the only renders; `src/app/(app)/trips/itinerary-editor.tsx:115-120` (editor `Location` type is `{id, name, region, tagged}`); `src/app/(app)/trips/[id]/days/[dayId]/page.tsx:50-62` (day query selects only name/map/contact fields); `src/lib/booking-dashboard.ts` rows carry no limitation text.
- **Evidence**: Wesley's Chapel has `scheduleLimitations` "No groups during Sunday 11:00 service. Museum last entry 15:30." and `notes` "Museum closes Mondays. Group entry via the courtyard gate…". Day 7 (Sun 1 Nov) schedules "Wesley's Chapel tour 10:00–11:30" there. Opening that item's editor, the Day 7 page, and the booking row shows none of this text (`t1-edit-open.png` shows the Locations block with only the chip). Nothing checks weekday vs. "closed Mondays" either (no such logic in `src/lib`).
- **Why it matters for this use case**: The whole point of recording "closed Mondays / max 30 / coach can't enter" on the venue is to be reminded when you put it on a day; today the reminder requires remembering to open the Location page.
- **Recommendation**: Add `scheduleLimitations` (and `hostSite.logisticsNotes`) to the editor's location payload and render it as a muted `text-xs` line under each selected location chip in `ItemFields` (`:1588-1606`) and under the venue chip in the read row (`:1130-1143`); on the Day page pass it through `renderVenueExtra` next to `VenueEngagementStatus`; in the booking row's expanded panel put it in the left "Covered sessions" column, which is mostly empty (`t3-after-list-price.png`). Showing the text is enough — a day-of-week parser is not needed.

### `Location.bookingNotes` is write-only — never displayed anywhere
- **Severity**: Major
- **Where**: `src/app/(app)/locations/location-form.tsx:226-232` (input); `src/app/(app)/locations/[id]/page.tsx:846` (only used to pre-fill the form). `grep -rn bookingNotes src --include=*.tsx` finds no render.
- **Evidence**: The Location page Details list shows Region/Address/Trip types/Website/Description/Schedule/Bookable/Booking opens/Host site/Notes (`t8.js` label dump) — no "Booking notes". Text typed into the field survives (it's in the DB and the MCP `get-location`) but the web UI never shows it again.
- **Why it matters for this use case**: This is the field whose label most invites "ask for Sarah, deposit via invoice only, max 30 in the house" — exactly the detail needed when working the booking row — and the planner will believe it was lost.
- **Recommendation**: Render it in the Details `<dl>` beside "Schedule" (`page.tsx:793-797` pattern) and in the booking row's expanded panel / `WorkflowControl` popover for that venue. While there, consider merging `bookingNotes` into the venue-engagement "Notes" seed (`upsertVenueBooking` create branch) so it travels with the booking.

## Minor

### The ripple is silent, and the overlap warning is styled as success with no lasting trace
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/actions.ts:866-870` and `:983` (message strings); `itinerary-editor.tsx` row render (no overlap marker).
- **Evidence**: Changing "New Room tour" end 11:45→12:15 with "Shift later items" on moved four later items by +30 (12:30, 13:45, 15:30, 16:30) and the toast said only "Item saved." (`t2.js`). With "Coach to Oxford" locked, the same edit produced "Item saved. It now overlaps a fixed-time item." as a green success toast (`t2-anchor-ripple.png`); once it faded, "Hanham Mount 15:30–16:15" sits above the locked "16:00–17:45" coach with no visual conflict cue.
- **Why it matters for this use case**: "Edit a time and see the ripple" is the #1 priority; a planner can't tell whether four items moved or none, and an overlap against a hard anchor is the one thing that must stay visible.
- **Recommendation**: Return the shifted count from `updateScheduleItem` and toast "Saved. 4 later items moved +30 min"; use `toast.warning` for the overlap case; add a persistent per-row overlap marker (red `time` text or `AlertTriangle` icon with `aria-label`) computed from the inverse of `computeScheduleGaps` — the "overflow indicator" item 3 in `docs/itinerary-time-editing.md`.

### Nudging a start time silently changes the duration
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:1428-1441` (`onStartChange` drags the end only on crossover); same in `day-timeline.tsx:197-209`.
- **Evidence**: Start 10:30→10:45 kept end 11:45: the tour quietly became 60 min instead of 75, nothing rippled (`t1.js`). Duration is never displayed in either form.
- **Why it matters for this use case**: When a coach is late the planner usually means "start 15 min later, same length"; the current rule makes that a two-field edit and hides the side effect.
- **Recommendation**: Show the computed duration beside the time inputs ("1h 15m") and add a "Keep duration" checkbox (default on for edits) so a start change moves the end with it and the ripple then follows.

### No Escape to cancel; Day-page quick-edit keeps a stale draft after Cancel
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/[id]/days/[dayId]/day-timeline.tsx:174-186` (QuickEdit state initialised once from `item`, never reset on Cancel at `:360`); no `onKeyDown`/`Escape` handling in `itinerary-editor.tsx`, `day-timeline.tsx`, `booking-row.tsx` (grep).
- **Evidence**: On Day 3, Edit → typed title "STALE DRAFT" → Cancel → Edit again: the input still showed "STALE DRAFT" (`t9.js` A). Pressing Escape with a quick-edit open left it open (`t5.js`).
- **Why it matters for this use case**: Cancel must mean "discard"; otherwise a later Save on that row commits an edit the planner thought they threw away.
- **Recommendation**: Mount the QuickEdit form only while `open` (split into `QuickEditForm` rendered conditionally so `useState` re-initialises), and add `onKeyDown={(e) => e.key === "Escape" && onCancel()}` on the editor containers (`ItemFields`, `TravelFields`, `QuickEdit`, `VenueDetails`).

### Item editor is one-size: 730px inline form for a time tweak, Save below the fold
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:1486-1848` (`ItemFields`: Category/Title/times, Locations block, Notes, Talk & presenters, then Save/Cancel); Notes is a single-line `Input` (`:1670-1671`) vs a `Textarea` in QuickEdit (`day-timeline.tsx:328-335`).
- **Evidence**: Opening Edit on "New Room tour" expanded the row to 730px (`t1-edit-open.png`); at 1280×900 the Save button is off-screen. The add-item form is 634px. With six items on Day 3, each edit pushes everything below it a screen down.
- **Why it matters for this use case**: Most edits during the grind are time/notes tweaks; paying the full form cost each time slows the loop and makes the day hard to read while editing.
- **Recommendation**: Keep `ItemFields` but wrap "Locations" and "Talk & presenters" in `Collapsible`s that default closed when empty on edit, and put Save/Cancel in a `sticky bottom-0 bg-background` footer inside the editor. Use `Textarea rows={2}` for notes in both surfaces.

### Day page "Edit" is a 21×16px text link, sometimes jammed against the title
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/[id]/days/[dayId]/day-timeline.tsx:253-262`.
- **Evidence**: At 393px all six "Edit" links measure 21×16px (`t5.js`); untitled-notes rows render "Charles Wesley's HouseEdit" with no gap (`t5-day3-quickedit.png`).
- **Why it matters for this use case**: The Day page is the phone surface; its only edit affordance is below any touch-target guideline and visually fused with the title.
- **Recommendation**: Use `Button variant="ghost" size="sm"` (or `size="icon"` with a `Pencil` icon and `aria-label="Edit"`), and render it in the row's own line/column via `TimelineGroups`' `renderItemExtra` slot with `mt-1 block`.

### "Use list price" copies stale list prices without flagging them
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/price-lines-editor.tsx:118-134` (`useListPrice` maps `listCosts` straight into drafts); `src/lib/costs.ts:179-194` (`listPriceLines` drops `stale`/`confirmedAt`).
- **Evidence**: On Wesley's Chapel the table flags "Afternoon tea £12.50 stale" and "Room hire £150 stale" (2024 price, unconfirmed). Clicking "Use list price" filled all three lines with no stale marker (`t3-after-list-price.png`); after "Save booking" the row showed "agreed" — the stale warning disappears exactly when the number becomes binding.
- **Why it matters for this use case**: The fast path for entering a price is the one most likely to bake a two-year-old number into the agreed total and the payment schedule.
- **Recommendation**: Carry `stale` through `listPriceLines` and show the existing amber "stale" chip beside copied lines until the amount is edited, or `window.confirm("2 of these list prices are stale — copy anyway?")` (the function already confirms before replacing non-empty drafts).

### Next-step copy reuses the done-stage vocabulary ("Your move: Menu chosen" beside "Visit requested")
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/waiting-note.tsx:11-14` (`ACTOR_PREFIX` + bare step label); rendered per item in `itinerary-editor.tsx:1130-1143` via `VenueEngagementStatus`.
- **Evidence**: Day 3 shows, on each of three rows, amber "Your move: Menu chosen · 269d" next to blue "Visit requested" — one label means "done", the other "to do", distinguished only by colour and prefix (`t1-edit-open.png`). The Progress view uses a yellow-outlined chip for the same "next" idea, a third encoding.
- **Why it matters for this use case**: When moving bookings through workflows all day, misreading "Menu chosen" as done is an easy, costly slip; repeating both pills on every item of a venue run also adds noise to the editor.
- **Recommendation**: Phrase the owner line as an action: "Next for you: Menu chosen" / "Next (venue): Tickets received" (keeps the no-arrow rule), and in the editor show `VenueEngagementStatus` once per venue run (the Day page already groups by venue) rather than on every item.

### Logging a payment requires typing today's date; form labels aren't associated with inputs
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/booking-row.tsx:790-818` (`disabled={pending || !amount || !paidOn}`, `Label` without `htmlFor` throughout `VenueDetails`/`PaymentLog`/`PaymentSchedule`); `price-lines-editor.tsx` uses `aria-label`, which is fine.
- **Evidence**: With Amount filled, "Log payment" stayed disabled until a date was entered (`t4b.js`); Playwright's `getByLabel('Paid on')` could not resolve the input (no `htmlFor`/`id`), which is the same thing a screen reader sees.
- **Why it matters for this use case**: Logging a payment is the most frequent money entry; a default of today removes a field in 90% of cases.
- **Recommendation**: Initialise `paidOn` with `toDateInput(todayUtc())` as `workflow-control.tsx` does for step dates; give these fields `id`s via `useId()` and `htmlFor`.

### Lodging-reorder dialog asks a question that has no "yes" when nothing can move
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:402-448`.
- **Evidence**: Moving Day 4 down opened "Move lodging with these days?" listing "Lincoln College … stays put (nights split apart)" with buttons Cancel / "Keep lodging dates" (outline) — no primary action (`t6-lodging-dialog.png`).
- **Why it matters for this use case**: In that case the dialog is a warning, not a choice; the outline-only footer makes the planner hesitate over which button actually reorders.
- **Recommendation**: When `stays.every(s => !s.to)`, title it "Lodging stays put" and render a single primary "Reorder days" button (plus Cancel); keep the three-button form for the movable case.

## Polish

### Booking row expanded panel: editor crammed into the right half, left half empty
- **Severity**: Polish
- **Where**: `src/app/(app)/trips/booking-row.tsx:252-402` (`grid md:grid-cols-2`: "Covered sessions" left, everything else right).
- **Evidence**: `t3-after-list-price.png` — four short session lines on the left, 680px of form on the right.
- **Recommendation**: `md:grid-cols-[1fr_2fr]`, or move the constraint text (finding above) and the payment schedule into the left column.

### Payment "Remove" is one click, no confirm
- **Severity**: Polish
- **Where**: `src/app/(app)/trips/booking-row.tsx:748-756`.
- **Evidence**: Clicked "Remove" on a £50 test payment: gone, toast "Payment removed." (`t4c.js`).
- **Recommendation**: Same undo-toast treatment as item delete.

---

## What works well (don't break)

- **Edit ripple + fixed-time anchors** behave exactly as documented: end-edit +30 moved four later items, a locked
  item stopped the shift, the reorder cascade kept the anchor, and the lock icon shows in the row (`t2.js`).
- **Cross-day moves land by time** and are optimistic — "Move → Day 4" put an 18:00 item between 13:00 and 19:00
  with no toast noise (`t6.js`); within-day ↑/↓ keep the day's spacing.
- **Day reorder previews lodging** before writing (`previewDayReorderAction` + dialog) — the right safeguard in the
  right place.
- **WorkflowControl popover**: 2 clicks to tick a step, sequential gating shown as disabled checkboxes, workflow
  switch and "Not needed" inline (`t4-workflow-popover.png`). **Progress view**: one-click chips, bulk "Mark done"
  with an honest result ("Updated 1 booking. 1 has no 'Enquiry sent' step.").
- **Booking row expand-to-edit**: price lines with live "£20.50 /person × 27 + £150 = £703.50", "Use list price",
  payment log with balance, schedule editor pre-seeded with a sensible "Deposit · 180 days before trip start",
  documents and point of contact — all inline, no modal fatigue, and the mobile table collapses to cards without
  overflow (`t7-booking-mobile.png`).
- **At-a-glance cues** in the table: "Open now" window, `list` / `stale` / `agreed` chips, red overdue amounts,
  "Your move" (amber) vs "Waiting on venue" (muted) with days waiting, and the attention filters.
- **Location page as the hub**: dated contact log with method + contact + follow-up, costs with "Confirmed <date> ·
  ⚠ stale", visit and engagement history, booking progress strip with the same step chips.
