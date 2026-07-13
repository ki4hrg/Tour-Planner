# Itinerary time editing — on-the-fly rearranging

How a day's schedule times stay consistent when a planner edits them live, and the
one piece deliberately left for later.

## What's implemented

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

3. **Day reflow** — `shiftDayItems` (`src/lib/schedule-shift.ts`) + the
   `shiftDaySchedule` action. "Running behind?" slides the whole day, or everything
   from a chosen item onward, by a fixed ±N minutes. Surfaced by `DayShiftControl`
   on the single-day view.

Plus a client-side guard against the inverted slot: the end input carries
`min={start}`, moving the start past the end drags the end along (preserving the
item's prior duration), an inline message shows on any residual crossover, and Save
is disabled — backstopping the server's `endTime >= startTime` zod refine so the bad
state never reaches it.

All shifts operate on an item's **`order`** (the day's manual sequence), not on
wall-clock position: "from here onward" = "later in the list," matching what the
planner sees. Times clamp to `00:00–23:59`.

## Deferred: fixed anchors (pinned times)

**Problem.** A real day often has an immovable appointment — a booked 14:00
cathedral tour, a train at 16:05. A ripple or day-reflow that slides "everything
after" will happily shove that anchor off its real time. Today the mitigation is
_control, not correctness_: cascade is opt-in, so a planner unchecks "shift later
items" (or scopes the day-reflow's **From** to start after the anchor) when a
downstream item is pinned. That's a judgment call the tool doesn't yet encode.

**Why it was deferred.** The opt-in covers the common case without a schema change,
and pinning is a meaningfully bigger unit of work (migration + UI + cascade logic)
that shouldn't ride along with the core fix.

**Sketch, if we pick it up.**

- **Schema:** a `pinnedTime Boolean @default(false)` on `ScheduleItem` (a lock icon
  in the editors). A pinned item's start/end are treated as fixed.
- **Cascade behaviour:** when a ripple/reflow reaches a pinned item, it must not move
  it. Two candidate rules:
  - _Stop at the anchor_ — shift only up to the first pinned item; leave it and
    everything after untouched. Simplest; matches "push what you can, I'll sort the
    rest."
  - _Absorb into the gap_ — shift downstream items but clamp so a pinned item stays
    put, compressing (never past zero) or expanding the gap before it. Closer to what
    a planner means by "we're behind," but can silently create overlaps that need a
    conflict indicator.
- **Signalling:** either rule benefits from surfacing the resulting overlap/collision
  in the timeline (`computeScheduleGaps` already finds gaps; an inverse
  "overlap" pass would find collisions) so the planner sees what the reflow couldn't
  resolve.
- **Engine shape:** `cascadeFromEdit` / `shiftDayItems` would take the pinned set and
  segment the shift at each anchor rather than applying one delta across the whole
  tail. Their current single-delta, order-based translation is the right primitive to
  build that on.

Until then: the ripple is a convenience the planner stays in charge of, not an
authority on what the day's fixed points are.
