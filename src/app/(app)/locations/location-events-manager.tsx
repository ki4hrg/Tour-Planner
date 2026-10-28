"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useAction } from "@/lib/use-action";
import {
  addLocationEvent,
  deleteLocationEvent,
  updateLocationEvent,
  type LocationEventInputData,
} from "./actions";

const NONE = "__none__";

export type LocationEventView = {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
};

type CategoryOption = { id: string; name: string };

// A venue's standing events ("Evensong 17:00"): what the item form offers in
// one click when the venue is on a day.
export function LocationEventsManager({
  locationId,
  events,
  categories,
  canEdit,
}: {
  locationId: string;
  events: LocationEventView[];
  categories: CategoryOption[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const { pending, run } = useAction();

  return (
    <div className="space-y-3">
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events.</p>
      ) : (
        <ul className="divide-y">
          {events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              categories={categories}
              canEdit={canEdit}
            />
          ))}
        </ul>
      )}
      {canEdit ? (
        adding ? (
          <div className="rounded-md border p-3">
            <EventFields
              categories={categories}
              submitLabel="Create"
              pending={pending}
              onSubmit={(data) =>
                run(() => addLocationEvent(locationId, data), () => setAdding(false))
              }
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            + Add event
          </Button>
        )
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  categories,
  canEdit,
}: {
  event: LocationEventView;
  categories: CategoryOption[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { pending, run } = useAction();

  if (editing) {
    return (
      <li className="py-2">
        <div className="rounded-md border p-3">
          <EventFields
            initial={event}
            categories={categories}
            submitLabel="Save"
            pending={pending}
            onSubmit={(data) =>
              run(() => updateLocationEvent(event.id, data), () => setEditing(false))
            }
            onCancel={() => setEditing(false)}
          />
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {[event.startTime, event.endTime].filter(Boolean).join("–")}
        </span>{" "}
        <span className="font-medium">{event.title}</span>
        {event.categoryName ? (
          <span className="text-muted-foreground"> · {event.categoryName}</span>
        ) : null}
        {event.notes ? (
          <span className="block text-xs text-muted-foreground">{event.notes}</span>
        ) : null}
      </div>
      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <ConfirmButton
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={pending}
            pending={pending}
            title={`Remove ${event.title}`}
            description="Items already added to itineraries stay as they are."
            confirmLabel="Remove"
            onConfirm={() => run(() => deleteLocationEvent(event.id))}
          >
            Remove
          </ConfirmButton>
        </div>
      ) : null}
    </li>
  );
}

function EventFields({
  initial,
  categories,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: LocationEventView;
  categories: CategoryOption[];
  submitLabel: string;
  pending: boolean;
  onSubmit: (data: LocationEventInputData) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? NONE);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  return (
    <form
      className="grid grid-cols-2 gap-3 [&>div]:min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title,
          startTime,
          endTime: endTime || undefined,
          categoryId: categoryId === NONE ? undefined : categoryId,
          notes: notes.trim() || undefined,
        });
      }}
    >
      <div className="col-span-2 space-y-1.5">
        <Label className="text-xs">Title</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Start</Label>
        <Input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">End</Label>
        <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
      </div>
      <div className="col-span-2 space-y-1.5">
        <Label className="text-xs">Category</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue placeholder="— none —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— none —</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="col-span-2 flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !title.trim() || !startTime}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
