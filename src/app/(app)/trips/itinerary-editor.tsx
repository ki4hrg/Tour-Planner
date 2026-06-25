"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import type { BookingStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_CLASSES,
  BOOKING_STATUSES,
  type SerializedDay,
  type SerializedStop,
} from "@/lib/trips";
import type { FormState } from "@/lib/forms";
import {
  addDay,
  updateDay,
  deleteDay,
  reorderDays,
  addStop,
  updateStop,
  deleteStop,
  reorderStops,
  createTripSite,
  type StopInputData,
  type CreatedSite,
} from "./actions";

const NONE = "__none__";

type Site = { id: string; name: string; region: string | null; tagged: boolean };
type Contact = { id: string; name: string };

// Run a FormState-returning action, surfacing the result as a toast.
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

export function ItineraryEditor({
  tripId,
  canEdit,
  hasStartDate,
  days,
  sites: initialSites,
  contacts,
}: {
  tripId: string;
  canEdit: boolean;
  hasStartDate: boolean;
  days: SerializedDay[];
  sites: Site[];
  contacts: Contact[];
}) {
  // Inline-created sites are held locally so they show immediately; server
  // revalidation folds them into `initialSites` shortly after (deduped by id).
  const [extraSites, setExtraSites] = useState<Site[]>([]);
  const sites = useMemo(() => {
    const ids = new Set(initialSites.map((s) => s.id));
    const merged = [...initialSites, ...extraSites.filter((s) => !ids.has(s.id))];
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [initialSites, extraSites]);

  const { pending, run } = useAction();

  const addNewSite = async (
    name: string,
    region: string,
  ): Promise<CreatedSite | null> => {
    const res = await createTripSite(tripId, name, region);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setExtraSites((prev) =>
      prev.some((s) => s.id === res.site.id)
        ? prev
        : [...prev, { ...res.site, tagged: true }],
    );
    toast.success(`Created ${res.site.name}.`);
    return res.site;
  };

  const moveDay = (index: number, dir: -1 | 1) => {
    const next = [...days];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(() => reorderDays(tripId, next.map((d) => d.id)));
  };

  return (
    <div className="space-y-4">
      {!hasStartDate ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          This trip has no start date, so day dates aren&apos;t shown. Set a
          start date on the overview to date the itinerary.
        </p>
      ) : null}

      {days.map((day, i) => (
        <DayCard
          key={day.id}
          day={day}
          index={i}
          total={days.length}
          canEdit={canEdit}
          sites={sites}
          contacts={contacts}
          onMove={moveDay}
          onCreateSite={addNewSite}
        />
      ))}

      {days.length === 0 ? (
        <p className="text-sm text-muted-foreground">No days yet.</p>
      ) : null}

      {canEdit ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => addDay(tripId))}
        >
          + Add day
        </Button>
      ) : null}
    </div>
  );
}

function DayCard({
  day,
  index,
  total,
  canEdit,
  sites,
  contacts,
  onMove,
  onCreateSite,
}: {
  day: SerializedDay;
  index: number;
  total: number;
  canEdit: boolean;
  sites: Site[];
  contacts: Contact[];
  onMove: (index: number, dir: -1 | 1) => void;
  onCreateSite: (name: string, region: string) => Promise<CreatedSite | null>;
}) {
  const { pending, run } = useAction();
  const [editingDay, setEditingDay] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(day.title ?? "");
  const [notes, setNotes] = useState(day.logisticalNotes ?? "");

  const moveStop = (stopIndex: number, dir: -1 | 1) => {
    const next = [...day.stops];
    const target = stopIndex + dir;
    if (target < 0 || target >= next.length) return;
    [next[stopIndex], next[target]] = [next[target], next[stopIndex]];
    run(() => reorderStops(day.id, next.map((s) => s.id)));
  };

  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <div className="min-w-0">
          <span className="font-medium">Day {day.dayIndex}</span>
          {day.title ? <span> — {day.title}</span> : null}
          {day.date ? (
            <span className="text-sm text-muted-foreground">
              {" "}
              · {formatDate(day.date)}
            </span>
          ) : null}
        </div>
        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || index === 0}
              onClick={() => onMove(index, -1)}
              aria-label="Move day up"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || index === total - 1}
              onClick={() => onMove(index, 1)}
              aria-label="Move day down"
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingDay((v) => !v)}
            >
              {editingDay ? "Close" : "Edit day"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Delete day ${day.dayIndex} and its stops?`))
                  run(() => deleteDay(day.id));
              }}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>

      {editingDay && canEdit ? (
        <div className="space-y-3 border-b p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Arrival & Lincoln"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Logistical notes (staff only)</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateDay(day.id, {
                    title,
                    logisticalNotes: notes,
                  }),
                () => setEditingDay(false),
              )
            }
          >
            Save day
          </Button>
        </div>
      ) : null}

      <div className="divide-y px-4">
        {day.stops.map((stop, si) => (
          <StopRow
            key={stop.id}
            stop={stop}
            index={si}
            total={day.stops.length}
            canEdit={canEdit}
            sites={sites}
            contacts={contacts}
            onMove={moveStop}
            onCreateSite={onCreateSite}
          />
        ))}
        {day.stops.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No stops yet.</p>
        ) : null}
      </div>

      {canEdit ? (
        <div className="border-t p-4">
          {adding ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-2 text-sm font-medium">Add a stop</p>
              <StopFields
                sites={sites}
                contacts={contacts}
                submitLabel="Add stop"
                onCreateSite={onCreateSite}
                onSubmit={(data, done) =>
                  run(() => addStop(day.id, data), () => {
                    done();
                    setAdding(false);
                  })
                }
                onCancel={() => setAdding(false)}
              />
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              + Add stop
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StopRow({
  stop,
  index,
  total,
  canEdit,
  sites,
  contacts,
  onMove,
  onCreateSite,
}: {
  stop: SerializedStop;
  index: number;
  total: number;
  canEdit: boolean;
  sites: Site[];
  contacts: Contact[];
  onMove: (index: number, dir: -1 | 1) => void;
  onCreateSite: (name: string, region: string) => Promise<CreatedSite | null>;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="py-3">
        <StopFields
          sites={sites}
          contacts={contacts}
          initial={stop}
          submitLabel="Save stop"
          onCreateSite={onCreateSite}
          onSubmit={(data, done) =>
            run(() => updateStop(stop.id, data), () => {
              done();
              setEditing(false);
            })
          }
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const label = stop.site?.name ?? stop.title ?? "Untitled stop";
  const time = [stop.startTime, stop.endTime].filter(Boolean).join("–");

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="font-medium">
          {time ? (
            <span className="mr-2 text-sm text-muted-foreground">{time}</span>
          ) : null}
          {label}
          {stop.site && stop.title ? (
            <span className="text-muted-foreground"> — {stop.title}</span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium",
              BOOKING_STATUS_CLASSES[stop.bookingStatus],
            )}
          >
            {BOOKING_STATUS_LABELS[stop.bookingStatus]}
          </span>
          {stop.bookedContact ? <span>· {stop.bookedContact.name}</span> : null}
          {stop.confirmationRef ? <span>· ref {stop.confirmationRef}</span> : null}
          {stop.scheduleNotes ? <span>· {stop.scheduleNotes}</span> : null}
        </div>
      </div>
      {canEdit ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || index === 0}
            onClick={() => onMove(index, -1)}
            aria-label="Move stop up"
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || index === total - 1}
            onClick={() => onMove(index, 1)}
            aria-label="Move stop down"
          >
            ↓
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={pending}
            onClick={() => run(() => deleteStop(stop.id))}
          >
            Delete
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function StopFields({
  sites,
  contacts,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onCreateSite,
}: {
  sites: Site[];
  contacts: Contact[];
  initial?: SerializedStop;
  submitLabel: string;
  onSubmit: (data: StopInputData, done: () => void) => void;
  onCancel: () => void;
  onCreateSite: (name: string, region: string) => Promise<CreatedSite | null>;
}) {
  const [siteId, setSiteId] = useState<string>(initial?.siteId ?? NONE);
  const [showAll, setShowAll] = useState(
    // If the current site isn't tagged, reveal the full list so it shows.
    initial?.siteId
      ? !sites.find((s) => s.id === initial.siteId)?.tagged
      : false,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [scheduleNotes, setScheduleNotes] = useState(
    initial?.scheduleNotes ?? "",
  );
  const [bookingStatus, setBookingStatus] = useState<BookingStatus>(
    initial?.bookingStatus ?? "NOT_BOOKED",
  );
  const [bookingNotes, setBookingNotes] = useState(initial?.bookingNotes ?? "");
  const [bookedContactId, setBookedContactId] = useState<string>(
    initial?.bookedContactId ?? NONE,
  );
  const [confirmationRef, setConfirmationRef] = useState(
    initial?.confirmationRef ?? "",
  );

  // Inline site creation.
  const [creatingSite, setCreatingSite] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRegion, setNewRegion] = useState("");

  const visibleSites = showAll ? sites : sites.filter((s) => s.tagged);
  // Always include the currently-selected site even if filtered out.
  const selectedSite = sites.find((s) => s.id === siteId);
  const siteOptions =
    selectedSite && !visibleSites.some((s) => s.id === selectedSite.id)
      ? [selectedSite, ...visibleSites]
      : visibleSites;

  const handleCreate = async () => {
    const created = await onCreateSite(newName, newRegion);
    if (created) {
      setSiteId(created.id);
      setCreatingSite(false);
      setNewName("");
      setNewRegion("");
    }
  };

  const submit = () => {
    onSubmit(
      {
        siteId: siteId === NONE ? undefined : siteId,
        title: title.trim() || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        scheduleNotes: scheduleNotes.trim() || undefined,
        bookingStatus,
        bookingNotes: bookingNotes.trim() || undefined,
        bookedContactId: bookedContactId === NONE ? undefined : bookedContactId,
        confirmationRef: confirmationRef.trim() || undefined,
      },
      () => {
        // Reset for the add form's next entry.
        if (!initial) {
          setSiteId(NONE);
          setTitle("");
          setStartTime("");
          setEndTime("");
          setScheduleNotes("");
          setBookingStatus("NOT_BOOKED");
          setBookingNotes("");
          setBookedContactId(NONE);
          setConfirmationRef("");
        }
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Site</Label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={showAll}
                onCheckedChange={(v) => setShowAll(v === true)}
              />
              Show all sites
            </label>
          </div>
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No site (custom stop)</SelectItem>
              {siteOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.region ? ` · ${s.region}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {creatingSite ? (
            <div className="space-y-2 rounded-md border border-dashed p-2">
              <Input
                placeholder="New site name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input
                placeholder="Region (optional)"
                value={newRegion}
                onChange={(e) => setNewRegion(e.target.value)}
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={handleCreate}>
                  Create & select
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCreatingSite(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setCreatingSite(true)}
            >
              + Create a new site
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">
            Title{" "}
            <span className="text-muted-foreground">
              {siteId === NONE ? "(required for custom stops)" : "(optional)"}
            </span>
          </Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={siteId === NONE ? "e.g. Lunch, Transit" : "Override label"}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Start time</Label>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">End time</Label>
          <Input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Schedule notes</Label>
          <Input
            value={scheduleNotes}
            onChange={(e) => setScheduleNotes(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md border p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Booking</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select
              value={bookingStatus}
              onValueChange={(v) => setBookingStatus(v as BookingStatus)}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {BOOKING_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Booked with</Label>
            <Select value={bookedContactId} onValueChange={setBookedContactId}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {contacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirmation ref</Label>
            <Input
              value={confirmationRef}
              onChange={(e) => setConfirmationRef(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Booking notes</Label>
            <Input
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
