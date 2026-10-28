"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock, Pencil } from "lucide-react";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useAction } from "@/lib/use-action";
import type { SerializedScheduleItem } from "@/lib/trips";
import {
  timeToMinutes,
  minutesToTime,
  formatDuration,
} from "@/lib/schedule-gaps";
import { gapAfterRemoval, type RemovalGap } from "@/lib/schedule-shift";
import { scheduleItemPrimaryLabel } from "@/lib/trips";
import {
  TimelineGroups,
  type OvernightLodging,
} from "../../../itinerary-timeline";
import { VenueEngagementStatus } from "../../../venue-engagements";
import {
  addScheduleItem,
  deleteScheduleItem,
  pullScheduleForward,
  shiftDaySchedule,
  updateScheduleItem,
} from "../../../actions";

const LAST_MINUTE = 24 * 60 - 1;

// A venue the quick-add can pick: `tagged` = catalogued under this trip's type
// (listed first; the rest sit under a second group).
export type DayLocationOption = { id: string; name: string; tagged: boolean };

// The day view's timeline: the shared read component plus, for planners, an
// inline quick-edit on each row — time / title / notes tweaks without leaving
// the phone screen — a compact quick-add at the foot of the list, and a
// one-tap remove that offers to close the hole it leaves. Structural changes
// (venues, category, reorder) jump to the full itinerary editor anchored at
// this item.
//
// This is the one-handed coach screen: every control here is a real Button at
// 40px+ (min-h-10) rather than an inline text link.
export function DayTimeline({
  tripId,
  dayId,
  items,
  lodging,
  canEdit,
  locations,
}: {
  tripId: string;
  dayId: string;
  items: SerializedScheduleItem[];
  lodging: OvernightLodging | null;
  canEdit: boolean;
  locations: DayLocationOption[];
}) {
  const hasTimedItems = items.some((it) => it.startTime);

  // The pull-forward offered on the remove toast runs from here: by the time
  // it is tapped the removed row (and its own transition) has unmounted.
  const { run: runPull } = useAction();
  const onRemoved = (gap: RemovalGap | null) => {
    if (!gap) {
      toast.success("Item removed.");
      return;
    }
    // The minutes sit in the description, not the action label: at phone
    // width sonner lays title and action on one row, and a long label clips.
    toast.success("Item removed.", {
      description: `Leaves a ${gap.minutes} min gap.`,
      // Long enough to read the hole and decide, phone in hand.
      duration: 10_000,
      action: {
        label: "Pull forward",
        onClick: () =>
          runPull(() => pullScheduleForward(dayId, gap.nextId, gap.minutes)),
      },
    });
  };

  return (
    <div className="space-y-3">
      {canEdit && hasTimedItems ? (
        <DayShiftControl dayId={dayId} items={items} />
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
      ) : (
        <TimelineGroups
          items={items}
          lodging={lodging}
          showBookings={canEdit}
          linkVenues
          showVenueContacts
          showGaps
          renderVenueExtra={(id) => <VenueEngagementStatus locationId={id} />}
          renderItemExtra={
            canEdit
              ? (item) => (
                  <QuickEdit
                    key={item.id}
                    tripId={tripId}
                    item={item}
                    // Measured against the list as it stands before the
                    // remove, so the offer reflects the hole actually left.
                    gap={gapAfterRemoval(items, item.id)}
                    onRemoved={onRemoved}
                  />
                )
              : undefined
          }
        />
      )}
      {canEdit ? <QuickAdd dayId={dayId} locations={locations} /> : null}
    </div>
  );
}

const SHIFT_PRESETS = [15, 30, 45] as const;

// Slide the whole day, or everything from a chosen item onward, by a fixed number
// of minutes — items keep their own lengths and spacing. This is a *slide*, not a
// *compress*: it moves later items rigidly, so it won't hold a fixed end time (a
// booked worship slot, dinner). Absorbing a delay against fixed anchors is the
// compress case — tracked in docs/itinerary-time-editing.md, not built yet.
function DayShiftControl({
  dayId,
  items,
}: {
  dayId: string;
  items: SerializedScheduleItem[];
}) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(15);
  const [fromId, setFromId] = useState<string>("");
  const { pending, run } = useAction();

  const timedItems = items.filter((it) => it.startTime);

  // Opening from the coach mid-day: the slide almost always starts at the next
  // thing on the schedule, so preselect the first item still ahead of the
  // clock (an event handler, so reading the clock here is render-pure).
  const openPanel = () => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const next = timedItems.find((it) => {
      const start = timeToMinutes(it.startTime ?? "");
      return start !== null && start > nowMin;
    });
    setFromId(next?.id ?? "");
    setOpen(true);
  };

  const apply = (sign: 1 | -1) => {
    const delta = sign * Math.abs(Math.trunc(minutes));
    if (!delta) {
      toast.error("Minutes must be non-zero.");
      return;
    }
    run(
      () => shiftDaySchedule(dayId, delta, fromId || undefined),
      () => setOpen(false),
    );
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-10"
        onClick={openPanel}
      >
        Slide times
      </Button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Slide times</p>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`shift-from-${dayId}`}>
          From
        </Label>
        <select
          id={`shift-from-${dayId}`}
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="h-10 w-full rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Whole day</option>
          {timedItems.map((it) => (
            <option key={it.id} value={it.id}>
              {it.startTime} · {scheduleItemPrimaryLabel(it).primary}
              {/* A fixed item never moves and stops the slide — say so where
                  the planner picks the start point. */}
              {it.fixedTime ? " (fixed)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`shift-min-${dayId}`}>
          Minutes
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id={`shift-min-${dayId}`}
            type="number"
            inputMode="numeric"
            min={1}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="h-10 w-20 font-mono tabular-nums"
          />
          {SHIFT_PRESETS.map((m) => (
            <Button
              key={m}
              type="button"
              variant={minutes === m ? "secondary" : "outline"}
              aria-pressed={minutes === m}
              className="min-h-10 flex-1"
              onClick={() => setMinutes(m)}
            >
              {m}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-10 w-full"
          disabled={pending}
          onClick={() => apply(-1)}
        >
          − Earlier
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-10 w-full"
          disabled={pending}
          onClick={() => apply(1)}
        >
          + Later
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="min-h-10"
        disabled={pending}
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </div>
  );
}

// The Edit affordance plus the form it opens. The form is mounted only while
// open, so Cancel discards the draft and the next open starts from the saved
// item again.
function QuickEdit({
  tripId,
  item,
  gap,
  onRemoved,
}: {
  tripId: string;
  item: SerializedScheduleItem;
  gap: RemovalGap | null;
  onRemoved: (gap: RemovalGap | null) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="mt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Edit"
          className="-ml-2.5 min-h-10 text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          <Pencil aria-hidden />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <QuickEditForm
      tripId={tripId}
      item={item}
      gap={gap}
      onRemoved={onRemoved}
      onClose={() => setOpen(false)}
    />
  );
}

function QuickEditForm({
  tripId,
  item,
  gap,
  onRemoved,
  onClose,
}: {
  tripId: string;
  item: SerializedScheduleItem;
  gap: RemovalGap | null;
  onRemoved: (gap: RemovalGap | null) => void;
  onClose: () => void;
}) {
  const { pending, run } = useAction();

  const [title, setTitle] = useState(item.title ?? "");
  const [startTime, setStartTime] = useState(item.startTime ?? "");
  const [endTime, setEndTime] = useState(item.endTime ?? "");
  const [fixedTime, setFixedTime] = useState(item.fixedTime);
  const [notes, setNotes] = useState(item.notes ?? "");
  // Ripple a time change through the rest of the day (default on).
  const [cascade, setCascade] = useState(true);

  const startMin = startTime ? timeToMinutes(startTime) : null;
  const endMin = endTime ? timeToMinutes(endTime) : null;

  // End can't precede start: `min` guides the picker; this backstops manual entry.
  const timesInvalid =
    startMin !== null && endMin !== null && endMin < startMin;
  const duration =
    startMin !== null && endMin !== null && endMin >= startMin
      ? endMin - startMin
      : null;

  // Moving the start moves the end with it, either direction, so a nudge keeps
  // the item's length (clamped to the day's last minute).
  const onStartChange = (v: string) => {
    const vMin = v ? timeToMinutes(v) : null;
    if (vMin !== null && startMin !== null && endMin !== null) {
      const delta = vMin - startMin;
      setEndTime(
        minutesToTime(Math.max(0, Math.min(LAST_MINUTE, endMin + delta))),
      );
    }
    setStartTime(v);
  };

  const canCascade = !!startTime;

  const save = () =>
    run(
      () =>
        // Full-input action: pass the structural fields through unchanged so a
        // quick time fix never drops venues / category / speakers.
        updateScheduleItem(
          item.id,
          {
            categoryId: item.categoryId ?? undefined,
            title: title.trim(),
            startTime: startTime || undefined,
            endTime: endTime || undefined,
            notes: notes.trim() || undefined,
            isBlock: item.isBlock,
            fixedTime: !!startTime && fixedTime,
            presentationId: item.presentationId ?? undefined,
            presenterIds: item.presenters.map((p) => p.id),
            locationIds: item.sites.map((s) => s.locationId),
          },
          { cascade: canCascade && cascade },
        ),
      onClose,
    );

  // "Site closed, move on": drop the item; the parent's toast then offers to
  // pull what follows into the hole. The action's own message is swallowed
  // so the one toast carries both the fact and the offer.
  const remove = () =>
    run(async () => {
      const res = await deleteScheduleItem(item.id);
      if (!res.error) onRemoved(gap);
      return { ...res, message: undefined };
    }, onClose);

  // A booked item confirms first (same rule as the itinerary editor).
  const bookingCount = item.bookings.length;

  return (
    <form
      className="mt-2 space-y-2 rounded-md border border-dashed p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending && !timesInvalid) save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* One column on a phone: a side-by-side pair clips the picker text. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`qe-start-${item.id}`}>
            Start
          </Label>
          <Input
            id={`qe-start-${item.id}`}
            type="time"
            value={startTime}
            onChange={(e) => onStartChange(e.target.value)}
            className="min-h-10 min-w-0 font-mono tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`qe-end-${item.id}`}>
            End
          </Label>
          <Input
            id={`qe-end-${item.id}`}
            type="time"
            value={endTime}
            min={startTime || undefined}
            aria-invalid={timesInvalid}
            onChange={(e) => setEndTime(e.target.value)}
            className="min-h-10 min-w-0 font-mono tabular-nums"
          />
        </div>
      </div>

      {timesInvalid ? (
        <p className="text-xs text-destructive">End is before start.</p>
      ) : duration !== null && duration > 0 ? (
        <p className="text-xs text-muted-foreground">
          {/* The gap formatter's default label is "free"; this is a length. */}
          {formatDuration(duration, "").trim()}
        </p>
      ) : null}

      {startTime ? (
        <div className="space-y-0.5">
          {/* A fixed time is one we don't control (a public event): shifting
              and reordering never move it, and a ripple stops there. */}
          <label className="flex min-h-10 w-full items-center gap-3 text-sm">
            <Checkbox
              checked={fixedTime}
              onCheckedChange={(v) => setFixedTime(v === true)}
            />
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3.5" aria-hidden />
              Fixed time
            </span>
          </label>
          {canCascade ? (
            <label className="flex min-h-10 w-full items-center gap-3 text-sm">
              <Checkbox
                checked={cascade}
                onCheckedChange={(v) => setCascade(v === true)}
              />
              <span>Shift later items</span>
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`qe-title-${item.id}`}>
          Title
        </Label>
        <Input
          id={`qe-title-${item.id}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Optional"
          className="min-h-10"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`qe-notes-${item.id}`}>
          Notes
        </Label>
        <Textarea
          id={`qe-notes-${item.id}`}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          className="min-h-10"
          disabled={pending || timesInvalid}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-10"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </Button>
        {bookingCount > 0 ? (
          <ConfirmButton
            variant="ghost"
            className="min-h-10 text-destructive"
            disabled={pending}
            title="Remove item?"
            description={`Deletes its booking${bookingCount === 1 ? "" : "s"}.`}
            confirmLabel="Remove"
            onConfirm={remove}
          >
            Remove
          </ConfirmButton>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="min-h-10 text-destructive"
            disabled={pending}
            onClick={remove}
          >
            Remove
          </Button>
        )}
        <Button
          asChild
          variant="ghost"
          className="ml-auto min-h-10 text-muted-foreground"
        >
          <Link href={`/trips/${tripId}/itinerary#item-${item.id}`}>
            All options
          </Link>
        </Button>
      </div>
    </form>
  );
}

// "+ Add item" at the foot of the day: a one-screen form (title, times, venue)
// that lands the item by its start time. Anything beyond that — category,
// speakers, a travel leg — is the full editor's job.
function QuickAdd({
  dayId,
  locations,
}: {
  dayId: string;
  locations: DayLocationOption[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        className="min-h-10 w-full"
        onClick={() => setOpen(true)}
      >
        + Add item
      </Button>
    );
  }

  return (
    <QuickAddForm
      dayId={dayId}
      locations={locations}
      onClose={() => setOpen(false)}
    />
  );
}

function QuickAddForm({
  dayId,
  locations,
  onClose,
}: {
  dayId: string;
  locations: DayLocationOption[];
  onClose: () => void;
}) {
  const { pending, run } = useAction();
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [locationId, setLocationId] = useState("");

  const startMin = startTime ? timeToMinutes(startTime) : null;
  const endMin = endTime ? timeToMinutes(endTime) : null;
  const timesInvalid =
    startMin !== null && endMin !== null && endMin < startMin;

  // Same nudge as the quick edit: once both ends are set, moving the start
  // carries the end along so the length holds.
  const onStartChange = (v: string) => {
    const vMin = v ? timeToMinutes(v) : null;
    if (vMin !== null && startMin !== null && endMin !== null) {
      setEndTime(
        minutesToTime(
          Math.max(0, Math.min(LAST_MINUTE, endMin + (vMin - startMin))),
        ),
      );
    }
    setStartTime(v);
  };

  // The server's identity rule: a title or a venue.
  const identified = title.trim().length > 0 || locationId !== "";

  const tagged = locations.filter((l) => l.tagged);
  const others = locations.filter((l) => !l.tagged);

  const save = () =>
    run(
      () =>
        addScheduleItem(dayId, {
          title: title.trim(),
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          presenterIds: [],
          locationIds: locationId ? [locationId] : [],
        }),
      onClose,
    );

  return (
    <form
      className="space-y-2 rounded-md border border-dashed p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending && !timesInvalid && identified) save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <p className="text-sm font-medium">New item</p>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`qa-title-${dayId}`}>
          Title
        </Label>
        <Input
          id={`qa-title-${dayId}`}
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          className="min-h-10"
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`qa-start-${dayId}`}>
            Start
          </Label>
          <Input
            id={`qa-start-${dayId}`}
            type="time"
            value={startTime}
            onChange={(e) => onStartChange(e.target.value)}
            className="min-h-10 min-w-0 font-mono tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`qa-end-${dayId}`}>
            End
          </Label>
          <Input
            id={`qa-end-${dayId}`}
            type="time"
            value={endTime}
            min={startTime || undefined}
            aria-invalid={timesInvalid}
            onChange={(e) => setEndTime(e.target.value)}
            className="min-h-10 min-w-0 font-mono tabular-nums"
          />
        </div>
      </div>
      {timesInvalid ? (
        <p className="text-xs text-destructive">End is before start.</p>
      ) : null}
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`qa-location-${dayId}`}>
          Location
        </Label>
        <select
          id={`qa-location-${dayId}`}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="h-10 w-full rounded-md border bg-background px-2 text-sm"
        >
          <option value="">None</option>
          {tagged.length > 0 && others.length > 0 ? (
            <>
              <optgroup label="This trip type">
                {tagged.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All locations">
                {others.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))
          )}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          className="min-h-10"
          disabled={pending || timesInvalid || !identified}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-10"
          disabled={pending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
