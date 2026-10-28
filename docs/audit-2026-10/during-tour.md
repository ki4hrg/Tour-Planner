# Findings — "During the tour" (leader on a phone, 393px, touch, one hand, poor signal)

Screenshots: `shots/during-tour/`
Scripts used: `dt/s1.js … s12.js` (Playwright, 393×852, hasTouch, isMobile, DPR 2). All times/orders I moved were restored (Day 3 and Day 1 verified back to seed values in the DB).

## Executive summary

The core "we're late" gesture is genuinely good: from the day page, **Slide times → minutes → From → "+ Later"** reflows everything after 10:30 in 4 taps plus typing, the toast says exactly what moved ("Shifted 5 items 40 min later." / "… Stopped at a fixed-time item."), the fixed-time anchor (Evening prayer, Day 1) holds correctly, and the participant share page + `.ics` feed pick up the new times on the next load with no extra step. `/trips/<id>/today` and the dashboard's **Today** link land the leader on the right day in one tap. The day page's bottom prev/next/Full-itinerary bar is the one thumb-friendly control on the screen.

Where it falls down: (1) a save on a dead/flaky connection is an **uncaught `Failed to fetch`** — no toast, no `error.tsx` anywhere in `src/app`, so in production the whole screen is replaced by Next's default error page and the typed edit is lost; (2) the **"drop a site and pull everything forward"** path doesn't exist on the day page — QuickEdit only drags the end time along when start is pushed *later*, so pulling an item earlier stretches it and the cascade delta is 0 (nothing moves), and the item Delete lives only in the full editor (no confirm); (3) **every inline control on the day page is a 16–28 px text link or icon** (Edit 21×16, Slide times 58×16, call/map 28×28, Cancel 37×16) and the primary contact is shown as an anonymous phone icon — no name, no email, nothing for venues without a primary contact; (4) the **itinerary editor is not a phone surface**: its six-control row squeezes the content column to ~130 px and the drag grip overlaps the time text, HTML5 drag doesn't fire on touch (verified), so ↑/↓ + "Move" are the only reorder path, and reorders silently re-time items with no toast; (5) the contact-log path is 2–3 screens of scrolling down the Location page, and the note form defaults to method "Call", not "In person".

## Findings

### Blocker/Major

### A failed save under poor signal crashes the page and loses the edit
- **Severity**: Major
- **Where**: `src/app/(app)/trips/[id]/days/[dayId]/day-timeline.tsx:22-34` (`useAction` has no try/catch), same pattern in `src/app/(app)/trips/itinerary-editor.tsx:280-285` (`commit`), `src/app/(app)/notes/notes-thread.tsx` form; no `error.tsx` / `global-error.tsx` exists anywhere under `src/app` (verified with `find`).
- **Evidence**: Day 3 → Edit on Hanham Mount → `context.setOffline(true)` → tap Save. Console: `PAGEERROR: Failed to fetch`; zero toasts; the whole page was replaced by the Next runtime-error overlay (`15-offline-save.png`). In production (no overlay) the same uncaught rejection inside `startTransition` reaches the root error boundary → Next's default "Application error" page; the QuickEdit values are gone. The `OfflineBanner` does show when fully offline (`17-offline-banner.png`, "Offline — changes won't save."), but `navigator.onLine` stays `true` on a 1-bar connection, which is the realistic coach/churchyard case — so there is no warning and the first tap on Save blows the page up.
- **Why it matters for this use case**: Reflowing the day is exactly the moment the leader has bad signal; losing the screen and the edit at that moment is the worst outcome.
- **Recommendation**: Wrap the `fn()` call in every local `useAction`/`commit` helper in `try/catch` and `toast.error("Couldn't reach the server. Try again.")`, keeping the form open (don't call `onOk`). Add `src/app/(app)/error.tsx` with a "Reload" button as a backstop.

### No "pull forward" gesture: dropping a site leaves the rest of the day where it was
- **Severity**: Major
- **Where**: `day-timeline.tsx:214-224` (`onStartChange` — only drags the end when `vMin > endMin`), `src/lib/schedule-shift.ts:108-118` (`cascadeFromEdit` uses the trailing-edge delta, so an unchanged end ⇒ delta 0), `src/app/(app)/trips/actions.ts:873-898` (`deleteScheduleItem` renumbers but never retimes), `itinerary-editor.tsx:1255-1264` (item Delete with no confirm, editor-only).
- **Evidence**: Scenario "Charles Wesley's House closed, pull Hanham Mount forward": Day 3 → Edit Hanham Mount → Start 15:00→13:15, "Shift later items" ticked → Save. Result: Hanham became **13:15–15:45** (stretched from 45 min to 2.5 h), Coach to Oxford stayed at 16:00, toast said only "Item saved." (`s10.js` output). The leader must then edit End by hand, then *also* fix every later item or go back to Slide times "− Earlier" from the next item. Deleting the closed item at all requires leaving the day page (QuickEdit → "All options" → editor → Delete, 3 taps + a 9,400 px page), and Delete fires with no confirmation.
- **Why it matters for this use case**: "Site is shut, let's move on" is the second most common on-the-ground change after "we're late", and right now it takes two surfaces and a manual time recomputation.
- **Recommendation**: In `onStartChange`, preserve duration in *both* directions (shift end by the same delta whenever the item had an end); `cascadeFromEdit` then moves later items naturally. Add a per-item "Remove" (confirm in place) to QuickEdit, and after a delete offer "Pull later items forward by N min" (reuse `shiftDaySchedule` with `fromItemId` = the next item and delta = −gap). Give the editor's item Delete the same `window.confirm` the day delete has (`itinerary-editor.tsx:621`).

### Day-page controls are text-link sized; nothing on the reflow path meets 40×40
- **Severity**: Major
- **Where**: `day-timeline.tsx:108-118` ("Slide times" 58×16), `:176-183` ("Cancel" 37×16), `:252-261` (QuickEdit "Edit" 21×16, inline right after the title with `mt-0.5` on an inline `<button>` — renders as "New Room tourEdit", `03-day3.png`), `:139-156` (− Earlier 71×28, + Later 62×28, number input 96×32), `:162-174` (`<select>` 301×34), `src/components/contact-channels.tsx:80` and `itinerary-timeline.tsx:210` (`size-7` = 28×28 call/text/map circles), day nav `page.tsx:166-192` (`size="sm"` 75×28), `src/components/app-nav.tsx:172` (Menu trigger 42×28).
- **Evidence**: `measure()` over the Day 3 page: 0 of 26 interactive elements ≥ 40 px tall; the four venue-header icon links are 28×28 with 4 px between them (`03-day3.png`). The Slide-times panel's "+ Later" (62×28) sits 40 px from "− Earlier" — a mis-tap moves the day the wrong way (`04-slide-open.png`). Nav menu items are 200×28 (`22-nav-menu.png`).
- **Why it matters for this use case**: One-handed, walking, cold hands, bus vibration. 16 px text links are the hardest kind of target, and the wrong-direction buttons are adjacent.
- **Recommendation**: On the day page (the declared "mobile-first" surface) use `Button size="default"`/`"lg"` (`src/components/ui/button.tsx`) with `min-h-11` rows; make "Edit" a full-width ghost row or a chevron on the whole item row rather than an inline link; bump `ChannelLink` and the Maps link to `size-10` (they already carry `aria-label`s); day nav at `size="lg"`; stack Earlier/Later as two full-width buttons.

### The itinerary editor is unusable at phone width, and it's the only place to swap, move-to-tomorrow or delete
- **Severity**: Major
- **Where**: `itinerary-editor.tsx:1203-1266` (six-control row: grip + ↑ + ↓ + Move + Edit + Delete, all `size="sm"` 28 px high); `src/app/(app)/trips/itinerary-dnd.tsx:5-9` (native HTML5 drag, mouse only); `itinerary-editor.tsx:273-285` (moves are optimistic, no success toast).
- **Evidence**: `08b-itinerary-editor-viewport.png`: the controls take ~250 px of 393, the content column is ~130 px: "Coach to Salisbury" wraps to 2 lines, "Heathrow T5 → Sarum College" to 4, and the drag grip is painted over the time "09:00–11:00". Page is 9,445 px tall (`s4.js`); 227 of 228 interactive elements are < 40 px. A synthetic touch drag of the grip onto another row changed nothing (`s9.js: touch drag changed order: false`) — expected for HTML5 DnD, but there is no hint; the grip is `aria-hidden` with `title="Drag to move"`. ↓ on "New Room tour" did swap it with Lunch and silently re-laid times to 10:30–11:30 / 11:45–13:00 with **no toast** (`21-after-swap.png`, DB check); "Move" → menu of 6 days, 183×28 items (`16-move-menu.png`), works and the item keeps its clock time.
- **Why it matters for this use case**: Swap two items / push one to tomorrow are listed priorities, and the leader is sent here from QuickEdit's "All options". They get a desktop layout with a touch-dead grip and re-timed items they weren't told about.
- **Recommendation**: Hide the grip below `sm:` and collapse ↑/↓/Move/Edit/Delete into one `DropdownMenu` ("⋯") on narrow screens; better, bring "Move up/down" and "Move to day…" into the day page's QuickEdit footer (`moveScheduleItem`/`reorderScheduleItems` are already importable). After a reorder that changed times, `toast.success` in the `shiftDaySchedule` shape ("Swapped. Lunch now 10:30–11:30.") — `cascadeReorderedTimes` already returns what changed.

### Venue contacts on the day page are an anonymous phone icon; no name, no email, nothing for venues without a primary
- **Severity**: Major
- **Where**: `itinerary-timeline.tsx:197-202` (RunHeader passes only `phone`), `days/[dayId]/page.tsx:62-67` (loads `primaryContact { name, phone }` — email not loaded, name loaded but unused), `itinerary-timeline.tsx:152-164` (`OvernightLine` is plain text, not a link).
- **Evidence**: Day 3 header "The New Room, Bristol" shows call/text/map circles with `aria-label="Call +44 117 926 4740"` — no name anywhere on the page (`03-day3.png`). Charles Wesley's House and Hanham Mount have no primary contact → nothing at all, no affordance to add one. Day 4: Lincoln College shows call/text only; the primary (Hannah Moore) has an email that is not offered (`s12.js` output). "Overnight · Lincoln College, Oxford" is not tappable, so tonight's porter is 3 taps away (venue appears on Day 4 → tap name → scroll to Contacts).
- **Why it matters for this use case**: "Standing at Lincoln College, meet the porter" — the leader needs to see *who* the primary is before calling, and reach tonight's lodging from today's page.
- **Recommendation**: Render `primaryContact.name` (and role) as a muted line under the venue heading with `ContactChannels phone email` (select `email` in the day-page query — staff-only behind `requireUser`). When there's no primary, link "Add contact" to `/locations/<id>#contacts`. Make `OvernightLine` accept `locationId` and link it like `linkVenues` does for run headers.

### Minor

### Edit / add / make-primary a contact is 3–5 taps and ~3 screens of scrolling, and the note form defaults to "Call"
- **Severity**: Minor
- **Where**: `src/app/(app)/locations/[id]/page.tsx:878-881` (Contacts card at y≈1,063 on a 3,435 px page), `:525-528` (Notes & contact log card at y≈2,365), `location-contacts-manager.tsx:60-62` (name → `/contacts/<id>`), `:81-91` ("Make primary"), `src/app/(app)/notes/notes-thread.tsx:203-205` (`method` default `"CALL"`), `src/app/(app)/contacts/[id]/page.tsx:69-72` (email/phone as plain `<dd>` text, no `tel:`/`mailto:`; long email clipped, `12-contact-page.png`).
- **Evidence**: From Day 4: tap "Lincoln College, Oxford" (1) → scroll ≈1.3 screens → tap "Hannah Moore" (2) → tap "Edit" (3) → change phone → Save (4). New porter: location page → "Create new" (2) → form → "Create & link" (3) → "Make primary" (4), with a page re-render between. Contact log: scroll ≈2.8 screens → "+ Add note" (2) → Method combobox (3) → "In person" (4) → Contact combobox (5) → Hannah (6) → type → "Add note" (7). `tel:`/`sms:`/`mailto:` are correct on `ContactChannels` everywhere they appear (`s5.js` hrefs). Method options: Call, Email, In person, Other (`11-method-select.png`).
- **Why it matters for this use case**: The whole point of the on-site visit is to capture "met Hannah, 28 rooms, her mobile is …" in under a minute.
- **Recommendation**: On the Location page hoist Contacts and "+ Add note" into the "Current trips here" card (already first on mobile) or add a sticky bottom bar "Call · Note · Contacts" on narrow screens. In `NotesThread`, default `method` to `IN_PERSON` on `pointer: coarse` (or when opened from a day page) and preselect the venue's primary contact. Make the contact page's Phone/Email values the links themselves (reuse `ContactChannels`).

### Slide-times panel: "From" comes after the action buttons, minutes needs clearing, and the whole-day default can skip the first item
- **Severity**: Minor
- **Where**: `day-timeline.tsx:120-184` (field order Minutes → buttons → From), `:128-136` (`type="number"` prefilled 15), `src/app/(app)/trips/actions.ts:951-953` (`fromOrder = fromItemId ? … ?? 1 : 1`).
- **Evidence**: `04-slide-open.png`: reading order invites tapping "+ Later" before choosing "From", which slides the whole day including the already-finished coach leg. With the seeded day (orders 0–5) "Whole day" +5 left "Coach to Bristol" at 09:00 and moved the other 5 (`s3.js`) — the app itself writes 1-based orders (`actions.ts:891`), so this is a seed artefact in practice, but the `?? 1` fallback also silently drops an unknown `fromItemId` to "whole day". The panel is at the *top* of the card, so after reading the day the thumb has to travel back up (`03-day3.png`).
- **Why it matters for this use case**: The common case is "from *this* stop onward", and a wrong-direction or whole-day slide needs a second slide to undo (there is no undo).
- **Recommendation**: Order the panel From → Minutes → Earlier/Later; pre-select "From" to the first item starting after the current time (client component, so local clock is fine). Offer `±15/±30/±45` chips so no keyboard is needed. Compute `fromOrder` as the day's minimum order when no item is chosen, and return an error when `fromItemId` isn't on the day. Consider putting "Slide times" in the bottom nav bar next to "Full itinerary".

### Time inputs in QuickEdit clip to "03:00 PN"
- **Severity**: Minor
- **Where**: `day-timeline.tsx:266-291` (`grid-cols-2`, `Input type="time"`).
- **Evidence**: `14-quickedit.png`: both pickers render the locale's 12-hour value with the clock glyph and clip the "M" at 117 px wide. Checkboxes are 16×16 (labels 107×20 / 122×20).
- **Why it matters**: Hard to read at a glance; the clipped glyph looks like a bug.
- **Recommendation**: Stack the two inputs (`grid-cols-1 sm:grid-cols-2`) or set `font-mono tabular-nums min-w-0`; render "Fixed time" / "Shift later items" as full-width toggle rows with `min-h-11`.

### Fixed-time anchor behaves correctly but isn't visible until it bites
- **Severity**: Polish
- **Where**: `itinerary-timeline.tsx:267-274` (lock icon only when `showBookings`), `day-timeline.tsx:162-174` (From list doesn't mark fixed items).
- **Evidence**: Day 1 +60 from Coach: 4 items moved, Evening prayer held at 17:30, toast "Shifted 4 items 60 min later. Stopped at a fixed-time item." (`07-day1-after-shift.png`). Good. But the From `<select>` lists "17:30 · Evening prayer" like any other item, and the lock is a 14 px glyph.
- **Recommendation**: Suffix fixed items in the From list with " (fixed)" and name the stop point in the toast ("Stopped at Evening prayer 17:30").

### Print view is a sound paper fallback but omits the numbers you'd want on paper
- **Severity**: Polish
- **Where**: `src/app/(app)/trips/[id]/print/page.tsx` (day logisticalNotes at `:123-125`; no contact/primaryContact in the query).
- **Evidence**: `18-print-screen.png` / `19-print-media.png`: clean, one column, staff notes included, nav hidden in print media, no horizontal overflow at 393. No venue phone numbers or lodging phone anywhere on the printout.
- **Recommendation**: Add a "Venue contacts" footer per day (primary contact name + phone for each venue + overnight) — the one thing paper is for when the phone dies.

### Offline mode is cache-last-seen with no "stale" marker and a NetworkFirst stall (code-only, not exercised — Serwist is off in dev)
- **Severity**: Minor
- **Where**: `src/app/sw.ts:20-22` (`runtimeCaching: defaultCache`), `src/components/offline-banner.tsx:226-230` (`navigator.onLine` only), `src/app/(app)/layout.tsx:32`.
- **Evidence**: `defaultCache` uses NetworkFirst for pages with a network timeout before falling back to cache; a degraded (not dead) connection shows neither banner nor spinner for that window, and the served copy carries no "as of" stamp, so a leader can act on a day that a colleague changed since.
- **Recommendation**: Stamp the day page header with "loaded HH:MM" (staff-only surface) and extend the banner to a "Slow connection…" state driven by `navigator.connection.effectiveType`/fetch timing, since `onLine` is the wrong signal on a coach.

## What works well (don't break)

- `/trips/<id>/today` + dashboard **Today** link: one tap to the correct day; the overview also auto-expands today's day (`itinerary-overview.tsx:66-70`).
- **Slide times** semantics: rigid, gap-preserving, stops at fixed anchors, reports overlaps; toast says count/direction/minutes; `fromItemId` makes "from here on" a first-class case.
- **Propagation**: share page HTML and `/api/share/<token>.ics` reflected the shifted times immediately with no publish step (verified via curl while shifted).
- Day page **bottom nav** (Day 2 · Full itinerary · Day 4) is in thumb reach; the page has no horizontal overflow at 393 and venue headers carry working `tel:`/`sms:`/Maps links.
- QuickEdit's `#item-<id>` deep link into the editor scrolls to the right row (`scroll-mt-20` works).
- "Move to day…" keeps the item's clock time, and the optimistic reorder is instant.
