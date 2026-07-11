"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/forms";
import type { DayLodgingSummary, SerializedScheduleItem } from "@/lib/trips";
import { TimelineGroups } from "../../../itinerary-timeline";
import { updateScheduleItem } from "../../../actions";

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
  items,
  lodging,
  canEdit,
}: {
  tripId: string;
  items: SerializedScheduleItem[];
  lodging: DayLodgingSummary | null;
  canEdit: boolean;
}) {
  return (
    <TimelineGroups
      items={items}
      lodging={lodging}
      showBookings={canEdit}
      linkVenues
      showVenueContacts
      renderItemExtra={
        canEdit
          ? (item) => <QuickEdit key={item.id} tripId={tripId} item={item} />
          : undefined
      }
    />
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
  const [notes, setNotes] = useState(item.notes ?? "");

  const save = () =>
    run(
      () =>
        // Full-input action: pass the structural fields through unchanged so a
        // quick time fix never drops venues / category / speakers.
        updateScheduleItem(item.id, {
          categoryId: item.categoryId ?? undefined,
          title: title.trim() || undefined,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          notes: notes.trim() || undefined,
          isBlock: item.isBlock,
          presentationId: item.presentationId ?? undefined,
          presenterIds: item.presenters.map((p) => p.id),
          locationIds: item.sites.map((s) => s.locationId),
        }),
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
            onChange={(e) => setStartTime(e.target.value)}
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
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs" htmlFor={`qe-title-${item.id}`}>
          Title
        </Label>
        <Input
          id={`qe-title-${item.id}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Leave blank to use the talk / category label"
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
        <Button size="sm" disabled={pending} onClick={save}>
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
