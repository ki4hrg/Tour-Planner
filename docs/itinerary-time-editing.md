# Itinerary time editing — on-the-fly rearranging

How a day's schedule times stay consistent when a planner edits them live — what
ships today (v1), and why the biggest remaining piece (**compress**) is the priority,
not an edge case.

## What's implemented (v1)

Three moving parts, all duration- and gap-preserving:

1. **Reorder cascade** — `cascadeReorderedTimes` (`src/lib/schedule-reorder.ts`).
   Dragging/↑↓-moving an item re-lays the day onto its time skeleton (anchor +
   inter-slot gaps); each item keeps its own duration. Wired into
   `reorderScheduleItems`.

2. **Edit ripple** — `cascadeFromEdit` (`src/lib/schedule-shift.ts`). Changing one
   item's start/end optionally shifts every _later_ timed item by the delta the
   edited item's trailing edge moved (`newEnd − oldEnd`), so downstream gaps survive.
   Opt-in via a "Shift later items to match" checkbox (default on) in both edit
   surfaces — the full itinerary editor (`ItemFields`) and the day-view `QuickEdit`.
   Threaded through `updateScheduleItem(itemId, input, { cascade })`.

3. **Day slide** — `shiftDayItems` (`src/lib/schedule-shift.ts`) + the
   `shiftDaySchedule` action. Slides the whole day, or everything from a chosen item
   onward, by a fixed ±N minutes. Surfaced by `DayShiftControl` on the single-day
   view. **This is a _slide_ tool, not a _compress_ tool — see below.**

Plus a client-side guard against the inverted slot: the end input carries
`min={start}`, moving the start past the end drags the end along (preserving the
item's prior duration), an inline message shows on any residual crossover, and Save
is disabled — backstopping the server's `endTime >= startTime` zod refine so the bad
state never reaches it.

All shifts operate on an item's **`order`** (the day's manual sequence), not on
wall-clock position: "from here onward" = "later in the list," matching what the
planner sees. Times clamp to `00:00–23:59`.

## Two situations: slide vs. compress

When a day goes sideways there are two fundamentally different reflows:

- **Slide** — the day just runs late; there's no hard evening anchor, so everything
  (dinner included) shifts by the same delta. A rigid translation. This is what v1's
  `DayShiftControl` does.
- **Compress** — the day lost time but must still hit fixed end points (a booked
  worship slot, a coach home, a dinner reservation). The lost time is _absorbed_ by
  cutting content and resequencing the middle so it still fits before the fixed
  anchors. The anchors do **not** move.

**Compress is the common case; pure slide is the exception** — and even a "slide"
usually carries some compression (you rarely push the whole evening back an hour with
nothing fixed). Compress is also the harder-pressed moment: phone in hand, on the
coach, needing to re-plan the rest of the day in under a minute. That's exactly where
ease-of-use and flexibility matter most, so it's where the tooling should be
strongest — and today it's weakest.

v1 does slide well and does not do compress. The slide control is honestly labelled
so it doesn't imply otherwise (a "+N later" on a day with a fixed dinner would shove
the dinner too — the wrong outcome).

## Worked example: the coach runs an hour late (a compress)

The coach is stuck in traffic and picks the group up an hour late. The planner
reflows the rest of the day:

- **Lunch becomes the first thing** (was after a presentation + site visit).
- **A later presentation is dropped.**
- **Two site visits** that were before/after lunch are moved to sit **back-to-back
  right after lunch.**
- Then the day **returns to its normal, fixed evening**: worship, travel back to home
  base, dinner — at their original times.

Decomposed against v1:

| Move | What it really is | v1 |
|---|---|---|
| Lunch to the front, re-anchored to the real arrival time | Re-sequence + set a new anchor | Reorder does the sequence; you edit lunch's start. **Mostly ✓** |
| Drop the presentation | Delete an item | Deletes, but leaves a **time hole** — later items keep their old clock times. **✗** |
| Two site visits back-to-back after lunch | Re-sequence **and close the gaps** between them | Reorder moves them but _preserves gaps by position_ — won't make them back-to-back; you hand-edit. **✗** |
| Worship / travel / dinner unchanged | Hold fixed anchors while the middle is replanned | No concept of a fixed anchor; the slide control would push them. **✗** |

So v1 gets you there only as **separate manual steps** (reorder, edit-anchor, delete,
reorder, hand-edit two starts), with the crossover guard as the only automation that
consistently helps. The one-tap reflow is the _wrong_ tool here: this day compresses
against a fixed evening, and the slide would carry the evening along with it.

## The next increment: make compress first-class

Because compress dominates, this is the priority — not a "revisit later" footnote.
Three parts, smallest-blast-radius first:

1. **Delete-closes-the-gap.** Dropping an item should _optionally_ pull the rest of
   the day up (same opt-in model as the edit ripple), instead of leaving a hole to
   close by hand. Cheapest win; reuses `cascadeFromEdit`-style logic. No schema change.

2. **Fixed-time anchors** — ✅ shipped as `ScheduleItem.fixedTime` (a "Fixed time"
   toggle with a lock marker in the item editor, travel editor, and day-view quick
   edit; `fixedTime` on the MCP add/update tools). A fixed item's times never move:
   the edit ripple and the day slide **stop at the anchor** (the first rule below —
   the fixed item and everything after it keep their times), and the reorder cascade
   leaves fixed items' times alone while re-laying the movable ones onto their own
   skeleton. When the shifted run now overlaps the anchor, the toast says so — a
   first, minimal cut of #3.

3. **Overflow / collision indicator.** After a replan, show whether the middle
   actually _fits_ before the first pinned anchor, or has spilled past it.
   `computeScheduleGaps` already finds gaps; an inverse pass finds overlaps. This is
   what turns "I think it fits" into "it fits."

**Engine shape.** (Shipped with "stop at the anchor"; kept for the record.)
`cascadeFromEdit` / `shiftDayItems` stay the right primitive — a
single-delta, order-based translation — but grow to take the pinned set and
**segment the shift at each anchor** rather than applying one delta across the whole
tail. Two candidate rules where a shift meets a pinned item:

- _Stop at the anchor_ — shift only up to the first pinned item; leave it and
  everything after untouched. Simplest; "push what you can, I'll sort the rest."
- _Absorb into the gap_ — shift downstream items but clamp so the pinned item stays
  put, compressing (never past zero) or expanding the gap before it. Closer to what a
  planner means by "we're behind," but can silently create overlaps — which is
  exactly why the overflow indicator (#3) is a dependency, not a nicety.

## Further out

- **Infer-the-lag slide.** Instead of typing minutes, read the device clock on open
  and offer the delta for you ("it's 14:20, the current item was due to end at 14:00 —
  shift the rest +20?"). A smarter default for the _slide_ case; leans on a
  client-only, floating-local clock read (schedule times are tz-free `"HH:MM"`, and
  the react-hooks/purity lint forbids `new Date()` in render — read it in an event
  handler / effect, not on the server or during render).
- **Smart-default the slide anchor to "now"** when the day being viewed is today, so
  the past morning isn't shifted. Same client-clock constraint as above; `isToday` is
  server-computable from `day.date` vs `todayUtc()`.

Until compress lands: the ripple and slide are conveniences the planner stays in
charge of, not an authority on what the day's fixed points are.
