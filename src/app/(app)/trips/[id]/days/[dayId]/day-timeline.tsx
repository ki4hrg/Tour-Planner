"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Lock } from "lucide-react";
import type { FormState } from "@/lib/forms";
import type { DayLodgingSummary, SerializedScheduleItem } from "@/lib/trips";
import { timeToMinutes, minutesToTime } from "@/lib/schedule-gaps";
import { scheduleItemPrimaryLabel } from "@/lib/trips";
import { TimelineGroups } from "../../../itinerary-timeline";
import { VenueEngagementStatus } from "../../../venue-engagements";
import { updateScheduleItem, shiftDaySchedule } from "../../../actions";

// Local direct-call action helper — same shape as booking-row / itinerary-editor
// (a deliberate per-file copy, per project convention).
function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>, onOk?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        if (res.message) toast.success(res.message);
        onOk?.();
      }
    });
  return { pending, run };
}

// The day view's timeline: the shared read component plus, for planners, an
// inline quick-edit on each row — time / title / notes tweaks without leaving
// the phone screen. Structural changes (venues, category, reorder) jump to the
// full itinerary editor anchored at this item.
export function DayTimeline({
  tripId,
  dayId,
  items,
  lodging,
  canEdit,
}: {
  tripId: string;
  dayId: string;
  items: SerializedScheduleItem[];
  lodging: DayLodgingSummary | null;
  canEdit: boolean;
}) {
  const hasTimedItems = items.some((it) => it.startTime);
  return (
    <div className="space-y-3">
      {canEdit && hasTimedItems ? (
        <DayShiftControl dayId={dayId} items={items} />
      ) : null}
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
            ? (item) => <QuickEdit key={item.id} tripId={tripId} item={item} />
            : undefined
        }
      />
    </div>
  );
}

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Slide times →
      </button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-dashed p-3">
      <p className="text-sm font-medium">Slide times</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`shift-min-${dayId}`}>
            Minutes
          </Label>
          <Input
            id={`shift-min-${dayId}`}
            type="number"
            min={1}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="w-24"
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => apply(-1)}
          >
            − Earlier
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => apply(1)}
          >
            + Later
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`shift-from-${dayId}`}>
          From
        </Label>
        <select
          id={`shift-from-${dayId}`}
          value={fromId}
          onChange={(e) => setFromId(e.target.value)}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Whole day</option>
          {timedItems.map((it) => (
            <option key={it.id} value={it.id}>
              {it.startTime} · {scheduleItemPrimaryLabel(it).primary}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}

function QuickEdit({
  tripId,
  item,
}: {
  tripId: string;
  item: SerializedScheduleItem;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();

  const [title, setTitle] = useState(item.title ?? "");
  const [startTime, setStartTime] = useState(item.startTime ?? "");
  const [endTime, setEndTime] = useState(item.endTime ?? "");
  const [fixedTime, setFixedTime] = useState(item.fixedTime);
  const [notes, setNotes] = useState(item.notes ?? "");
  // Ripple a time change through the rest of the day (default on).
  const [cascade, setCascade] = useState(true);

  // End can't precede start: `min` guides the picker; this backstops manual entry.
  const timesInvalid =
    !!startTime &&
    !!endTime &&
    timeToMinutes(startTime) !== null &&
    timeToMinutes(endTime) !== null &&
    (timeToMinutes(endTime) as number) < (timeToMinutes(startTime) as number);

  // Pushing the start past the end drags the end along, preserving the duration.
  const onStartChange = (v: string) => {
    const vMin = v ? timeToMinutes(v) : null;
    const endMin = endTime ? timeToMinutes(endTime) : null;
    if (vMin !== null && endMin !== null && vMin > endMin) {
      const prevStart = startTime ? timeToMinutes(startTime) : null;
      const prevDuration =
        prevStart !== null && endMin >= prevStart ? endMin - prevStart : 0;
      setEndTime(minutesToTime(Math.min(24 * 60 - 1, vMin + prevDuration)));
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
            title: title.trim() || undefined,
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
      () => setOpen(false),
    );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-0.5 text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs" htmlFor={`qe-start-${item.id}`}>
            Start
          </Label>
          <Input
            id={`qe-start-${item.id}`}
            type="time"
            value={startTime}
            onChange={(e) => onStartChange(e.target.value)}
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
          />
        </div>
      </div>

      {timesInvalid ? (
        <p className="text-xs text-destructive">
          End is before start.
        </p>
      ) : null}

      {startTime ? (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {/* A fixed time is one we don't control (a public event): shifting
              and reordering never move it, and a ripple stops there. */}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={fixedTime}
              onCheckedChange={(v) => setFixedTime(v === true)}
            />
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3.5" aria-hidden />
              Fixed time
            </span>
          </label>
          {canCascade ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
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
          size="sm"
          disabled={pending || timesInvalid}
          onClick={save}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        <Link
          href={`/trips/${tripId}/itinerary#item-${item.id}`}
          className="ml-auto text-xs text-muted-foreground hover:underline"
        >
          All options →
        </Link>
      </div>
    </div>
  );
}
