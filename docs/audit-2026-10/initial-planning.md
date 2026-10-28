# Findings — Initial tour planning (sketching a new tour)

Audited hands-on at 1280 and 393 px on the running app (admin login). Flow exercised: `/trips/new` → picked trip type → "Start from template" → "Wesley Pilgrimage — template" → dates 25–31 Oct 2027 → created trip; on `/trips/<id>/itinerary`: + Add day, add a planned location (with/without note), promote ("Schedule") to a schedule item, open "+ Add item" and its location picker, looked for a route to a venue contact from the editor, the overview, the day page and the Location page; checked Compare years; deleted the scratch trip via "Delete trip". Screenshots: `shots/initial-planning/` (scratchpad). Scratch trip was deleted and the DB verified clean.

## Executive summary

1. The rough-plan model is genuinely cheap: planned locations (with a free-text note), drag/arrow reorder across days, "Schedule" promotion and day reorder with a lodging prompt all work, and none of it writes a `Booking` row, so changing your mind costs nothing. Template instantiation is faithful.
2. **On a phone the itinerary editor is unusable for sketching**: every item row reserves 267 px for grip/↑/↓/Move/Edit/Delete and leaves **18 px** for the content column, so times, categories and titles wrap one word per line and the grip handle overlaps the time. Day headers suffer the same squeeze. (Blocker)
3. **Contact info is a dead end from the planning surfaces.** The itinerary editor has zero links to a location (venue chips, planned chips and the day page's "Planned:" line are plain text), so reaching the primary contact is Itinerary → Locations nav → search → Location page → scroll to Contacts (4–5 clicks), and even there the phone number and email are rendered only as icon buttons — never as readable text. (Major)
4. **Previous-visit intelligence does not surface where the decision is made.** The Location page's "Visit history" shows the trip's start date and a count ("Sat, 17 May 2025 · 1 visit"), not the day/time the venue was actually visited (Day 1, 14:15–15:30 in 2025). Schedule limitations, "booking opens N days before", location notes and the contact log live only on the Location page; the location pickers in the editor show a bare name (planned-location picker) or "name · region" (item picker). (Major)
5. **Copying last year** means Overview → "Save as template" → All trips → New trip → choose type → "Start from template" (a select that only appears once a type is chosen). There is no "Duplicate trip" / "Start from Wesley 2025". The new trip's date range (7 days) and the template's day count (3) are not reconciled or flagged. (Major)
6. Smaller frictions: the planned-location picker is unfiltered, un-searchable and shows duplicate names indistinguishably; "Schedule"/"×" on planned chips are 16–20 px tall; "Delete trip" has no confirmation; a freshly created sketch screams "No lodging" in red on the overview.

---

## Blocker / Major

### Phone-width itinerary editor leaves ~18 px for item content
- **Severity**: Blocker
- **Where**: `/trips/<id>/itinerary` at 393 px — `src/app/(app)/trips/itinerary-editor.tsx:1074` (row `flex items-start justify-between gap-3`), `:1204` (controls `flex shrink-0 items-center gap-1`: grip, ↑, ↓, Move, Edit, Delete), day header `:555` + `:589` (↑, ↓, Edit day, Delete).
- **Evidence**: Measured with Playwright on the seeded trip: for the first three items `content` column = **18 px**, `controls` = **267 px** (`shots/initial-planning/wes-itin-393-view.png`: "09:00–11:00" is overdrawn by the grip handle, "Coach to Salisbury", "Heathrow T5 → Sarum College" and the booking pill each wrap one word per line). Day 1's header wraps "Day 1 — Arrive & Salisbury · Salisbury · Mon, 26 Oct 2026" into five lines beside four buttons (`promoted-393.png`). No horizontal overflow, so it is pure squeeze. On the scratch trip the same happened as soon as the first item existed.
- **Why it matters for this use case**: Sketching on a phone (on a site visit, in a meeting with a venue) is exactly when a planner adds a candidate site or nudges a day; today the editor cannot be read, let alone edited, at that width.
- **Recommendation**: Below `sm`, collapse the per-row actions into one `DropdownMenu` (the `Move` menu already exists at `:1236`) with Edit / Move up / Move down / Move to day… / Delete, and drop the grip (drag is desktop-only anyway); do the same for the day header (`Edit day`, arrows, `Delete`). Alternatively stack the controls under the content (`flex-col sm:flex-row`). The day page already proves the terse mobile layout (`days/[dayId]/day-timeline.tsx`).

### No route from the itinerary to a venue's contact (or its page at all)
- **Severity**: Major
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:1167-1170` (member-location chip is a `<span>`), `:904` (planned chip name is a `<span>`); `src/app/(app)/trips/[id]/days/[dayId]/page.tsx:149` ("Planned:" is a text join); `src/app/(app)/trips/itinerary-overview.tsx:170-204` (day header site roll-up is text; only the expanded `TimelineGroups` with `linkVenues` links).
- **Evidence**: `a[href^="/locations/"]` count on the scratch trip's editor: **0** before and after promoting a planned location (desktop and phone). Day 5 (rough plan only): **0** location links, 0 `tel:` links; the planned venues render as "Planned: Christ Church, Oxford (Evensong 18:00?) · Lincoln College, Oxford" with nothing tappable (`day5-393.png`). Overview: 3 location links, all inside the one expanded day; collapsed days show names as text. Shortest path from the editor to Christian Dettlaff's phone: Locations (nav) → search "Wesley" → card → scroll to Contacts → 4 clicks + a search, then the number is still only an icon (next finding).
- **Why it matters for this use case**: While roughing out a day the planner constantly wants to ring or email a venue ("can you do Tuesday afternoon?"); today they must leave the itinerary and re-find the venue by name.
- **Recommendation**: Make the venue chip (`:1167`) and the planned chip name (`:904`) a `Link` to `/locations/<id>` (the overview's `TimelineGroups` already does this with `linkVenues`), and add `primaryContact { name, phone, email }` to the editor's location payload so the chip can carry `<ContactChannels>` the way `day-timeline.tsx:64` (`showVenueContacts`) already does. On the day page, render each planned location as a link (or reuse the venue heading component) instead of a joined string.

### Primary contact's phone and email are never shown as text
- **Severity**: Major
- **Where**: `src/app/(app)/locations/location-contacts-manager.tsx:56-75`; `src/components/contact-channels.tsx:19-45` (icon-only `ChannelLink`s, number only in `aria-label`/`title`); `src/app/(app)/trips/[id]/days/[dayId]/page.tsx:68` (selects `phone` only — no `email`), `itinerary-timeline.tsx:197-200`.
- **Evidence**: Location page Contacts card (`loc-1280.png`): "Christian Dettlaff [Primary] — Heritage Officer, Wesley's Chapel" followed by three 28×28 px circles (call / SMS / mail). `#contacts` innerText contains no digits or `@`. Day 3 page: 1 `tel:` link, **0** `mailto:` links. To *read* the number (desk phone, dictating to a colleague, pasting into a venue's web form) you must open `/contacts/<id>` — one more hop — or hover for the tooltip. On the phone the 28 px targets are below the 44 px guideline.
- **Why it matters for this use case**: The brief's second priority is "see the primary contact's phone + email" from wherever the site is being looked at; today they are reachable by tap but not visible anywhere on the venue surfaces.
- **Recommendation**: In `LocationContactsManager` render the phone and email as text (`<a href="tel:">` / `mailto:` on the text itself, `link-quiet`), keeping `ContactChannels` for SMS/WhatsApp; give `ContactChannels` a `showLabels` variant used on the Location page and bump `ChannelLink` to `size-9` on touch. Load `email` alongside `phone` in the day-page query so `mailto:` works in the field too.

### Visit history shows trip start + count, not the previous slot (day/time)
- **Severity**: Major
- **Where**: `src/app/(app)/locations/[id]/page.tsx:319-362` (tallies `scheduleItemSite` rows per trip, keeps only `trip.startDate`), `:613-646` (renders "`<trip> · <trip start> · N visits`"); `src/app/(app)/trips/compare/page.tsx` + `multi-year-grid.tsx` (booking-status grid only).
- **Evidence**: Wesley's Chapel: "Wesley Pilgrimage 2025 · Sat, 17 May 2025 · 1 visit". The 2025 trip actually visited on **Day 1, Thu 22 May 2025, 14:15–15:30** (`past-over-1280.png`); the only place that arrival time exists is a free-text contact-log note ("2025 visit: arrived 14:00 by coach…"). Compare years (`compare-1280.png`) shows booking chips per year and, usefully, "Opens Sun, 31 Jan 2027" — but no day/time either.
- **Why it matters for this use case**: "When did we do this last year, and did the slot work?" is the first question when deciding which day to put a venue on; the data is in the DB but the page throws the day and times away.
- **Recommendation**: Extend the visit query to select `scheduleItem { startTime, endTime, day { dayIndex, date, title } }` and render each visit as "Day 1 · Thu 22 May 2025 · 14:15–15:30 · Wesley's Chapel tour" linking to `/trips/<id>/itinerary#item-<id>` (the anchor already exists at `itinerary-editor.tsx:1049`). Same rows could feed a "Last visited" line in the picker (next finding).

### Location intelligence absent at the point of choosing a site
- **Severity**: Major
- **Where**: planned-location picker `src/app/(app)/trips/itinerary-editor.tsx:936-948` (bare `l.name`); item picker `:1612-1625` (`name · region`); `src/app/(app)/locations/page.tsx:126-157` (cards: name, region, trip-type badges only). The data lives in `locations/[id]/page.tsx:789-820` (Schedule limitations, Booking opens, Notes) and the `NotesThread` at `:525-537`.
- **Evidence**: Picking Wesley's Chapel for a day in the editor shows nothing about "No groups during Sunday 11:00 service. Museum last entry 15:30", "Museum closes Mondays", "Booking opens 270 days before" or the open follow-up note. The `/locations` catalog (`locs-1280.png`) shows none of it either, and has no "last visited"/"open follow-up" cue. After adding a planned location the only signal is the engagement pill ("Next: Visit requested · Planned").
- **Why it matters for this use case**: These are precisely the constraints that decide *which* day a venue can go on; today the planner must open each candidate's page in another tab to check.
- **Recommendation**: Add a one-line venue hint under the chip/picker: `scheduleLimitations` (truncated) + "Opens <date>" (the compare page already computes it from `bookingOpensLeadDays`) + "Last: Day 1 · 14:15 (2025)". Cheapest first step: include `scheduleLimitations`, `bookingOpensLeadDays` and `notes` in the editor's `locations` payload and show them as the chip's `title`/a `Popover` on the venue chip; and surface Schedule + "Opens" on the `/locations` cards.

### Copying last year is a two-page detour; templates are hidden until a type is picked
- **Severity**: Major
- **Where**: `src/app/(app)/trips/[id]/page.tsx:712-716` and `:727-733` (`Save as template` — appears twice on the overview), `src/app/(app)/trips/trip-form.tsx:141-160` (template select rendered only when `typeTemplates.length`, i.e. after a trip type is chosen), `src/app/(app)/trips/actions.ts:190-254` (`createTrip` instantiates only from `isTemplate` trips).
- **Evidence**: `/trips/new` (`new-1280.png`) shows no template field; it appears after choosing "Wesley Pilgrimage" (`new-typed-1280.png`), listing "Blank itinerary / Wesley Pilgrimage — template". There is no way to start from "Wesley Pilgrimage 2025" directly — you must first "Save as template" on the 2025 trip (creating a permanent template artefact), then come back. The trips list has no "Duplicate" on a card.
- **Why it matters for this use case**: "Same as last year, shifted a week" is the dominant way a recurring tour starts; today it is five navigations and leaves a template behind that then needs curating.
- **Recommendation**: Let `createTrip` accept any non-template trip id as the source (the deep-copy in `src/lib/templates.ts` already resets bookings/dates, and `saveTripAsTemplate` proves the select shape), and list past trips of the type under a "Start from" group ("Templates" / "Past trips"). Show the "Start from" control always (filter on type change) so it is discoverable. Add "Duplicate" next to "Save as template" on the overview.

## Minor / Polish

### Date range and day count are not reconciled after instantiation
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/actions.ts:225-237` (`instantiateDays` from the template regardless of `endDate`), `:412-441` (`addDay` dates past `endDate` silently); overview `src/app/(app)/trips/[id]/page.tsx` Lodging card ("0 of 2 nights covered" counts days, not dates).
- **Evidence**: Created 25–31 Oct 2027 (7 days) from the 3-day template → 3 days; "+ Add day" produced Day 4 = Thu 28 Oct; overview shows "Mon, 25 Oct 2027 → Sun, 31 Oct 2027" next to a 3-day itinerary with no hint (`created-overview-1280.png`). Could not tell from the page that four calendar days have no itinerary day.
- **Why it matters for this use case**: A new sketch typically starts from dates; the planner expects one day per date and has no cue to add the missing ones (or that the end date is wrong).
- **Recommendation**: In `createTrip`, pad days up to `endDate` when a date range is given (or show "4 dates without a day · Add days" in the overview Itinerary card header, reusing `addDay`). Show the mismatch as a badge, not prose.

### Planned-location picker: unfiltered, unsearchable, duplicates indistinguishable
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:936-948` (Radix `Select` over all `locations`, `l.name` only, `w-56`), vs item picker `:1573-1625` (trip-type filter + "Show all locations", `name · region`).
- **Evidence**: Opening the planned-location select lists 18 options including "Epworth Old Rectory" twice with no region to tell them apart (`planned-select-open-1280.png`); the item picker shows "Epworth Old Rectory · England / · Epworth". No typeahead input (`[role=listbox] input` = 0); with a real catalog of 100+ venues this is a scroll.
- **Why it matters for this use case**: The rough plan is the fastest way to drop a candidate into a day, so this picker is the one used most while sketching.
- **Recommendation**: Reuse the item picker's option rendering (`name · region`) and trip-type filter; longer term replace both with a `Command`/combobox (shadcn `Command` + `Popover`) with type-to-filter, and add "+ New location" here too (`createTripLocation` already exists).

### Planned-chip actions are tiny; promoted item repeats the venue name
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/itinerary-editor.tsx:909-928` (text buttons "Schedule" and "×", `text-xs px-1`); heading from `scheduleItemPrimaryLabel` + chip at `:1167`.
- **Evidence**: Measured at 393 px: "Schedule" 57×16 px, "×" 16×20 px — both far below 44 px (same at 1280). After promotion the row reads "Christ Church, Oxford" as heading and "Christ Church, Oxford" again as the member chip (`promoted-1280.png`). Promoting twice created two identical time-less items (allowed; fine, but the duplication of the label doubles the noise).
- **Why it matters for this use case**: Promote/remove are the two most-tapped actions on a rough plan; on a phone they are hard to hit, and the "×" is 16 px from "Schedule".
- **Recommendation**: Use `Button variant="ghost" size="sm"` (28 px) with icons (`CalendarPlus`, `X`) and `aria-label`s, min 36 px on touch; suppress the member chip when the item's primary label *is* the single site's name (mirror the `labelFromCategory` logic).

### "Delete trip" deletes immediately, with no confirmation
- **Severity**: Minor
- **Where**: `src/app/(app)/trips/[id]/page.tsx:1023-1031` (plain `<form action={deleteTrip}>`), `actions.ts:365`.
- **Evidence**: Clicking "Delete trip" on the scratch trip navigated straight to `/trips`; no `dialog` event fired (Playwright listener), trip gone from the DB. By contrast `deleteDay` uses `window.confirm` (`itinerary-editor.tsx:621`).
- **Why it matters for this use case**: A sketch trip sits next to the live one in the list; one mis-click in the Danger zone destroys days, planned locations and stays with no undo.
- **Recommendation**: Wrap in the same `Dialog` pattern as the lodging prompt (`itinerary-editor.tsx:402-448`) or at minimum `window.confirm`, keeping the one-line consequence "Deletes all days and items."

### "No lodging" alarms on a freshly created sketch
- **Severity**: Polish
- **Where**: `src/app/(app)/trips/itinerary-overview.tsx:185-200` (red "No lodging" per day), overview Lodging card ("0 of 2 nights covered" in red).
- **Evidence**: Immediately after creating the trip from the template, every day row and the Lodging card are red (`created-overview-1280.png`) before a single venue has been chosen.
- **Why it matters for this use case**: During rough planning lodging is decided last; red on every row trains the planner to ignore the cue, which is the one that matters once dates are near.
- **Recommendation**: Tone the cue to muted until the trip has any schedule item or the start date is within N months (`deriveTripLifecycle` already distinguishes Planning), keeping red for In-progress/near trips.

---

## What works well (don't break)

- **Planned locations are the right primitive**: a chip with an optional note ("Evensong 18:00?"), drag to another day, "Schedule" promotion that removes the chip, and *no* `Booking` rows written (verified in the DB) — the venue engagement row is derived, so undoing is free.
- **Day reorder is safe**: arrows + drag, with the "Move lodging with these days?" dialog (`itinerary-editor.tsx:402-448`) previewing which stays follow.
- **Template instantiation is faithful** (3 days, titles, cities copied; dates derived from the new start) and "Start from template" is type-scoped so wrong-type skeletons never appear.
- **Inline creation from the item form** ("+ New location", "+ New talk", "+ New presenter") tags the new venue with the trip's type so it shows in the default filtered picker — exactly what you want mid-sketch.
- **Compare years** already derives "Opens Sun, 31 Jan 2027" from the venue's lead days per trip — the right data for the picker hint recommended above.
- **Location page's contact log is first-class** (right 2/3 column, method + contact + date, follow-ups) and the Day page gives one-tap call on venues with a primary contact — the pieces for the recommended linking all exist.
