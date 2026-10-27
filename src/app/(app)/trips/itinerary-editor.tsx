"use client";

import { useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { GripVertical, Lock } from "lucide-react";
import { VenueEngagementStatus, VenueEngagementSteps } from "./venue-engagements";
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
import { timeToMinutes, minutesToTime } from "@/lib/schedule-gaps";
import {
  TRAVEL_METHOD_LABELS,
  effectivePresenters,
  scheduleItemPrimaryLabel,
  travelDetailLine,
  type SerializedDay,
  type SerializedScheduleItem,
  type SerializedBooking,
  type SerializedPlannedLocation,
} from "@/lib/trips";
import {
  TimelineGroups,
  BookingPill,
  CategoryChip,
  TravelMethodIcon,
} from "./itinerary-timeline";
import type { TravelMethod } from "@prisma/client";
import type { FormState } from "@/lib/forms";
import {
  addDay,
  updateDay,
  deleteDay,
  reorderDays,
  addScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
  moveScheduleItem,
  movePlannedLocation,
  previewDayReorderAction,
  addPlannedLocation,
  removePlannedLocation,
  promotePlannedLocation,
  addBooking,
  updateBooking,
  deleteBooking,
  createTripLocation,
  createContactInline,
  createPresentationInline,
  type ScheduleItemInputData,
  type TravelLegInputData,
  type BookingInputData,
  type CreatedLocation,
  type CreatedContact,
  type CreatedPresentation,
} from "./actions";

import {
  ItineraryDndProvider,
  inLowerHalf,
  useItineraryDnd,
  type ItineraryDrag,
  type ItineraryDrop,
} from "./itinerary-dnd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { applyItineraryMove, type ItineraryMove } from "@/lib/itinerary-moves";
import type { StayFollowLine } from "@/lib/itinerary-mutations";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const NONE = "__none__";

// A day as the "Move to day…" menu lists it.
type DayOption = { id: string; label: string };

type Location = {
  id: string;
  name: string;
  region: string | null;
  tagged: boolean;
};
type Contact = { id: string; name: string };
// A Region option for the day's city: `label` is the full path for the picker,
// `name` the short form for the day header.
type City = { id: string; name: string; label: string };
type Category = {
  id: string;
  name: string;
  color: string | null;
  system: boolean;
};
type Presentation = {
  id: string;
  title: string;
  defaultPresenters: { id: string; name: string }[];
};

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
  isTemplate,
  days,
  categories,
  locations: initialLocations,
  contacts: initialContacts,
  presentations: initialPresentations,
  cities,
}: {
  tripId: string;
  canEdit: boolean;
  hasStartDate: boolean;
  isTemplate?: boolean;
  days: SerializedDay[];
  categories: Category[];
  locations: Location[];
  contacts: Contact[];
  presentations: Presentation[];
  cities: City[];
}) {
  // Inline-created locations/contacts are held locally so they show immediately;
  // server revalidation folds them into the props shortly after (deduped by id).
  const [extraLocations, setExtraLocations] = useState<Location[]>([]);
  const locations = useMemo(() => {
    const ids = new Set(initialLocations.map((s) => s.id));
    const merged = [
      ...initialLocations,
      ...extraLocations.filter((s) => !ids.has(s.id)),
    ];
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [initialLocations, extraLocations]);

  const [extraContacts, setExtraContacts] = useState<Contact[]>([]);
  const contacts = useMemo(() => {
    const ids = new Set(initialContacts.map((c) => c.id));
    const merged = [
      ...initialContacts,
      ...extraContacts.filter((c) => !ids.has(c.id)),
    ];
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [initialContacts, extraContacts]);

  const [extraPresentations, setExtraPresentations] = useState<Presentation[]>(
    [],
  );
  const presentations = useMemo(() => {
    const ids = new Set(initialPresentations.map((p) => p.id));
    const merged = [
      ...initialPresentations,
      ...extraPresentations.filter((p) => !ids.has(p.id)),
    ];
    return merged.sort((a, b) => a.title.localeCompare(b.title));
  }, [initialPresentations, extraPresentations]);

  const { pending, run } = useAction();

  const addNewContact = async (
    name: string,
    organization: string,
  ): Promise<CreatedContact | null> => {
    const res = await createContactInline(name, organization);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setExtraContacts((prev) =>
      prev.some((c) => c.id === res.contact.id) ? prev : [...prev, res.contact],
    );
    toast.success(`Created ${res.contact.name}.`);
    return res.contact;
  };

  const addNewLocation = async (
    name: string,
  ): Promise<CreatedLocation | null> => {
    const res = await createTripLocation(tripId, name);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setExtraLocations((prev) =>
      prev.some((s) => s.id === res.location.id)
        ? prev
        : [...prev, { ...res.location, region: null, tagged: true }],
    );
    toast.success(`Created ${res.location.name}.`);
    return res.location;
  };

  const addNewPresentation = async (
    title: string,
  ): Promise<CreatedPresentation | null> => {
    const res = await createPresentationInline(title);
    if (!res.ok) {
      toast.error(res.error);
      return null;
    }
    setExtraPresentations((prev) =>
      prev.some((p) => p.id === res.presentation.id)
        ? prev
        : [...prev, { ...res.presentation, defaultPresenters: [] }],
    );
    toast.success(`Created ${res.presentation.title}.`);
    return res.presentation;
  };

  // Moves (drag, arrows, "Move to day…") show immediately and settle when the
  // revalidated days arrive.
  const [shownDays, preview] = useOptimistic<SerializedDay[], ItineraryMove>(
    days,
    applyItineraryMove,
  );
  const [, startMove] = useTransition();
  const commit = (move: ItineraryMove, fn: () => Promise<FormState>) =>
    startMove(async () => {
      preview(move);
      const res = await fn();
      if (res.error) toast.error(res.error);
    });

  // A day reorder that moves nights with lodging on them asks first whether
  // the stays should follow their days (the server lists which, and where to).
  const [lodgingPrompt, setLodgingPrompt] = useState<{
    ids: string[];
    stays: StayFollowLine[];
  } | null>(null);
  const applyDayOrder = (ids: string[], moveStays: boolean) => {
    setLodgingPrompt(null);
    commit({ kind: "days", orderedIds: ids }, async () => {
      const res = await reorderDays(tripId, ids, { moveStays });
      if (res.message) toast.success(res.message);
      return res;
    });
  };
  const reorderDayIds = (ids: string[]) =>
    startMove(async () => {
      const preview = await previewDayReorderAction(tripId, ids);
      if ("error" in preview) {
        toast.error(preview.error);
        return;
      }
      if (preview.stays.length > 0) setLodgingPrompt({ ids, stays: preview.stays });
      else applyDayOrder(ids, false);
    });

  const moveDay = (index: number, dir: -1 | 1) => {
    const next = shownDays.map((d) => d.id);
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderDayIds(next);
  };

  // `toIndex` is the position among the target day's OTHER items.
  const moveItemTo = (itemId: string, toDayId: string, toIndex: number) =>
    commit({ kind: "item", itemId, toDayId, toIndex }, () =>
      moveScheduleItem(itemId, toDayId, toIndex),
    );

  const onDrop = (drag: ItineraryDrag, over: ItineraryDrop) => {
    if (drag.kind === "day" && over.kind === "day") {
      const ids = shownDays.map((d) => d.id).filter((id) => id !== drag.id);
      const at = ids.indexOf(over.dayId);
      if (at < 0) return; // dropped on itself
      ids.splice(over.after ? at + 1 : at, 0, drag.id);
      if (ids.join() !== shownDays.map((d) => d.id).join()) reorderDayIds(ids);
    } else if (drag.kind === "item" && over.kind === "item") {
      // `over.index` is a gap in the full list; drop the dragged item's own
      // slot from the count when it moves down within its day.
      let index = over.index;
      if (drag.dayId === over.dayId) {
        const from = shownDays
          .find((d) => d.id === over.dayId)
          ?.items.findIndex((it) => it.id === drag.id);
        if (from == null || from < 0) return;
        if (index > from) index--;
        if (index === from) return;
      }
      moveItemTo(drag.id, over.dayId, index);
    } else if (drag.kind === "planned" && over.kind === "planned") {
      commit({ kind: "planned", id: drag.id, toDayId: over.dayId }, () =>
        movePlannedLocation(drag.id, over.dayId),
      );
    }
  };

  const dayOptions: DayOption[] = shownDays.map((d) => ({
    id: d.id,
    label: `Day ${d.dayIndex}${d.title ? ` — ${d.title}` : ""}`,
  }));

  return (
    <ItineraryDndProvider onDrop={onDrop}>
    <div className="space-y-4">
      {!hasStartDate && !isTemplate ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No start date — days are undated.
        </p>
      ) : null}

      {shownDays.map((day, i) => (
        <DayCard
          key={day.id}
          day={day}
          index={i}
          total={shownDays.length}
          dayOptions={dayOptions}
          onMoveItemTo={moveItemTo}
          canEdit={canEdit}
          categories={categories}
          locations={locations}
          contacts={contacts}
          presentations={presentations}
          cities={cities}
          onMove={moveDay}
          onCreateLocation={addNewLocation}
          onCreateContact={addNewContact}
          onCreatePresentation={addNewPresentation}
        />
      ))}

      {shownDays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No days.</p>
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
      <Dialog
        open={lodgingPrompt != null}
        onOpenChange={(o) => !o && setLodgingPrompt(null)}
      >
        {lodgingPrompt ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move lodging with these days?</DialogTitle>
            </DialogHeader>
            <ul className="space-y-2 text-sm">
              {lodgingPrompt.stays.map((st) => (
                <li key={st.stayId}>
                  <p className="font-medium">{st.name}</p>
                  <p className="text-muted-foreground">
                    {st.to ? (
                      <>
                        {st.from} → <span className="text-foreground">{st.to}</span>
                      </>
                    ) : (
                      <>{st.from} · stays put (its nights are no longer together)</>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => setLodgingPrompt(null)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() => applyDayOrder(lodgingPrompt.ids, false)}
              >
                Keep lodging dates
              </Button>
              {lodgingPrompt.stays.some((st) => st.to) ? (
                <Button onClick={() => applyDayOrder(lodgingPrompt.ids, true)}>
                  Move lodging
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
    </ItineraryDndProvider>
  );
}

function DayCard({
  day,
  index,
  total,
  dayOptions,
  onMoveItemTo,
  canEdit,
  categories,
  locations,
  contacts,
  presentations,
  cities,
  onMove,
  onCreateLocation,
  onCreateContact,
  onCreatePresentation,
}: {
  day: SerializedDay;
  index: number;
  total: number;
  dayOptions: DayOption[];
  onMoveItemTo: (itemId: string, toDayId: string, toIndex: number) => void;
  canEdit: boolean;
  categories: Category[];
  locations: Location[];
  contacts: Contact[];
  presentations: Presentation[];
  cities: City[];
  onMove: (index: number, dir: -1 | 1) => void;
  onCreateLocation: (name: string) => Promise<CreatedLocation | null>;
  onCreateContact: (
    name: string,
    organization: string,
  ) => Promise<CreatedContact | null>;
  onCreatePresentation: (title: string) => Promise<CreatedPresentation | null>;
}) {
  const { pending, run } = useAction();
  const [editingDay, setEditingDay] = useState(false);
  const [adding, setAdding] = useState<"item" | "travel" | null>(null);
  const [title, setTitle] = useState(day.title ?? "");
  const [notes, setNotes] = useState(day.logisticalNotes ?? "");
  const [participantNotes, setParticipantNotes] = useState(
    day.participantNotes ?? "",
  );
  const [primaryLocationId, setPrimaryLocationId] = useState<string>(
    day.primaryLocationId ?? NONE,
  );
  const [cityRegionId, setCityRegionId] = useState<string>(
    day.cityRegionId ?? NONE,
  );
  const cityName = cities.find((c) => c.id === day.cityRegionId)?.name;

  const moveItem = (itemIndex: number, dir: -1 | 1) => {
    const target = itemIndex + dir;
    if (target < 0 || target >= day.items.length) return;
    onMoveItemTo(day.items[itemIndex].id, day.id, target);
  };

  const dnd = useItineraryDnd();
  const cardRef = useRef<HTMLDivElement>(null);
  const over = dnd.over?.dayId === day.id ? dnd.over : null;
  // A drag anywhere over the card: days drop before/after it, items append to
  // its route (rows refine the spot), planned locations join its cluster.
  const onCardDragOver = (e: React.DragEvent) => {
    const drag = dnd.current();
    if (!drag) return;
    if (drag.kind === "day") {
      dnd.hover(e, { kind: "day", dayId: day.id, after: inLowerHalf(e) });
    } else if (drag.kind === "item") {
      dnd.hover(e, { kind: "item", dayId: day.id, index: day.items.length });
    } else {
      dnd.hover(
        e,
        drag.dayId === day.id ? null : { kind: "planned", dayId: day.id },
      );
    }
  };
  const itemLineAt = over?.kind === "item" ? over.index : null;

  return (
    <div
      ref={cardRef}
      id={`day-${day.id}`}
      onDragOver={canEdit ? onCardDragOver : undefined}
      onDrop={canEdit ? dnd.drop : undefined}
      className={cn(
        "relative rounded-lg border bg-card transition-opacity",
        dnd.drag?.kind === "day" && dnd.drag.id === day.id && "opacity-50",
        over?.kind === "planned" && "ring-2 ring-primary/50",
      )}
    >
      {over?.kind === "day" ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-x-0 h-1 rounded bg-primary",
            over.after ? "-bottom-2.5" : "-top-2.5",
          )}
        />
      ) : null}
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2">
        <div className="flex min-w-0 items-center gap-1">
          {canEdit ? (
            <span
              draggable
              onDragStart={(e) =>
                dnd.begin(e, { kind: "day", id: day.id }, cardRef.current)
              }
              onDragEnd={dnd.end}
              className="-ml-2 shrink-0 cursor-grab rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground active:cursor-grabbing"
              title="Drag to reorder"
              aria-hidden
            >
              <GripVertical className="size-4" />
            </span>
          ) : null}
          <div className="min-w-0">
          <span className="font-medium">Day {day.dayIndex}</span>
          {day.title ? <span> — {day.title}</span> : null}
          {cityName ? (
            <span className="text-sm text-muted-foreground">
              {" "}
              · {cityName}
            </span>
          ) : null}
          {day.date ? (
            <span className="text-sm text-muted-foreground">
              {" "}
              · {formatDate(day.date)}
            </span>
          ) : null}
          </div>
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
                if (window.confirm(`Delete day ${day.dayIndex} and its items?`))
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
          <div className="space-y-1.5">
            <Label className="text-xs">Participant notes</Label>
            <Textarea
              rows={2}
              value={participantNotes}
              onChange={(e) => setParticipantNotes(e.target.value)}
              placeholder="e.g. Theme: The Road to Emmaus · Luke 24:13–35"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">City</Label>
            <Select value={cityRegionId} onValueChange={setCityRegionId}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Primary location</Label>
            <Select value={primaryLocationId} onValueChange={setPrimaryLocationId}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    participantNotes,
                    primaryLocationId:
                      primaryLocationId === NONE ? "" : primaryLocationId,
                    cityRegionId: cityRegionId === NONE ? "" : cityRegionId,
                  }),
                () => setEditingDay(false),
              )
            }
          >
            Save day
          </Button>
        </div>
      ) : null}

      {/* Participant-facing day note (theme/scripture) — shown to everyone. */}
      {day.participantNotes && !editingDay ? (
        <p className="border-b px-4 py-2 text-sm italic text-muted-foreground">
          {day.participantNotes}
        </p>
      ) : null}

      {/* Rough-plan cluster (GH #9): intended venues with no times, distinct from
          the timed route below. Planners can add/remove/promote; viewers see a
          read-only list (hidden entirely when empty). */}
      <PlannedLocations
        dayId={day.id}
        planned={day.plannedLocations ?? []}
        locations={locations}
        canEdit={canEdit}
      />

      {/* Editing: the day's route line with per-item controls. Read-only viewers
          get the grouped venue-run layout (location once per run). */}
      <div className="px-4 py-3">
        {day.items.length === 0 ? (
          <p
            className={cn(
              "py-1 text-sm text-muted-foreground",
              itemLineAt != null && "rounded bg-primary/10 px-2 text-foreground",
            )}
          >
            No items.
          </p>
        ) : canEdit ? (
          <ol className="relative ml-2 space-y-1.5 border-l-2 border-border/60">
            {day.items.map((item, si) => (
              <ItemRow
                key={item.id}
                tripId={day.tripId}
                dayId={day.id}
                item={item}
                index={si}
                total={day.items.length}
                dropLine={
                  itemLineAt === si
                    ? "before"
                    : itemLineAt === day.items.length && si === day.items.length - 1
                      ? "after"
                      : null
                }
                dayOptions={dayOptions}
                onMoveToDay={(toDayId) => onMoveItemTo(item.id, toDayId, Number.MAX_SAFE_INTEGER)}
                canEdit={canEdit}
                categories={categories}
                locations={locations}
                contacts={contacts}
                presentations={presentations}
                onMove={moveItem}
                onCreateLocation={onCreateLocation}
                onCreateContact={onCreateContact}
                onCreatePresentation={onCreatePresentation}
              />
            ))}
          </ol>
        ) : (
          <TimelineGroups
            items={day.items}
            showBookings
            linkVenues
            showGaps
            renderVenueExtra={(id) => <VenueEngagementStatus locationId={id} />}
          />
        )}
      </div>

      {canEdit ? (
        <div className="border-t p-4">
          {adding === "item" ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-2 text-sm font-medium">Add an item</p>
              <ItemFields
                categories={categories}
                locations={locations}
                contacts={contacts}
                presentations={presentations}
                defaultLocationId={day.primaryLocationId}
                submitLabel="Add item"
                onCreateLocation={onCreateLocation}
                onCreateContact={onCreateContact}
                onCreatePresentation={onCreatePresentation}
                onSubmit={(data, done) =>
                  run(() => addScheduleItem(day.id, data), () => {
                    done();
                    setAdding(null);
                  })
                }
                onCancel={() => setAdding(null)}
              />
            </div>
          ) : adding === "travel" ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-2 text-sm font-medium">Add travel</p>
              <TravelFields
                categories={categories}
                locations={locations}
                submitLabel="Add travel"
                onSubmit={(data, done) =>
                  run(() => addScheduleItem(day.id, data), () => {
                    done();
                    setAdding(null);
                  })
                }
                onCancel={() => setAdding(null)}
              />
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding("item")}
              >
                + Add item
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdding("travel")}
              >
                + Add travel
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// The day's rough-plan cluster (GH #9): locations intended for the day with no
// timed schedule item. A loose set a planner firms up later — each entry can be
// promoted into a real schedule item (which removes it here). Renders nothing for
// a viewer when empty; a planner always gets the add control.
function PlannedLocations({
  dayId,
  planned,
  locations,
  canEdit,
}: {
  dayId: string;
  planned: SerializedPlannedLocation[];
  locations: Location[];
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const dnd = useItineraryDnd();
  const [pick, setPick] = useState<string>(NONE);
  const [note, setNote] = useState("");

  if (!canEdit && planned.length === 0) return null;

  // Don't offer a location already planned for this day (one row per pair).
  const plannedIds = new Set(planned.map((p) => p.locationId));
  const available = locations.filter((l) => !plannedIds.has(l.id));

  const add = () => {
    if (pick === NONE) return;
    run(() => addPlannedLocation(dayId, { locationId: pick, note }), () => {
      setPick(NONE);
      setNote("");
    });
  };

  return (
    <div className="space-y-2 border-b px-4 py-3">
      <p className="text-xs font-medium text-muted-foreground">
        Planned locations
      </p>

      {planned.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {planned.map((p) => (
            <li
              key={p.id}
              draggable={canEdit}
              onDragStart={(e) => dnd.begin(e, { kind: "planned", id: p.id, dayId })}
              onDragEnd={dnd.end}
              title={canEdit ? "Drag to another day" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-sm",
                canEdit && "cursor-grab active:cursor-grabbing",
                dnd.drag?.kind === "planned" && dnd.drag.id === p.id && "opacity-50",
              )}
            >
              <span>{p.name}</span>
              {p.note ? (
                <span className="text-xs text-muted-foreground">· {p.note}</span>
              ) : null}
              {canEdit ? (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => promotePlannedLocation(p.id))}
                    className="rounded px-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                    title="Promote to a schedule item"
                    aria-label={`Promote ${p.name} to a schedule item`}
                  >
                    → schedule
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => removePlannedLocation(p.id))}
                    className="rounded px-1 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                    title="Remove planned location"
                    aria-label={`Remove ${p.name}`}
                  >
                    ×
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder="Add a location…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Add a location…</SelectItem>
              {available.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="h-8 w-40"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={pending || pick === NONE}
            onClick={add}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// A waymarker on the route line — filled when the item carries a booking,
// hollow when it's purely informational; a diamond for a free-choice block.
// Tinted by the item's category colour so the route encodes the day's shape.
function Marker({ item }: { item: SerializedScheduleItem }) {
  const color = item.category?.color ?? "var(--muted-foreground)";
  const hasBooking = item.bookings.length > 0;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-2 z-10 h-3 w-3 -translate-x-1/2 border-2",
        item.isBlock ? "rounded-[3px] rotate-45" : "rounded-full",
      )}
      style={{
        left: "-1px",
        borderColor: color,
        backgroundColor: hasBooking ? color : "var(--card)",
      }}
    />
  );
}

function ItemRow({
  tripId,
  dayId,
  item,
  index,
  total,
  dropLine,
  dayOptions,
  onMoveToDay,
  canEdit,
  categories,
  locations,
  contacts,
  presentations,
  onMove,
  onCreateLocation,
  onCreateContact,
  onCreatePresentation,
}: {
  tripId: string;
  dayId: string;
  item: SerializedScheduleItem;
  index: number;
  total: number;
  // Drop indicator for an item being dragged here (above / below this row).
  dropLine: "before" | "after" | null;
  dayOptions: DayOption[];
  onMoveToDay: (toDayId: string) => void;
  canEdit: boolean;
  categories: Category[];
  locations: Location[];
  contacts: Contact[];
  presentations: Presentation[];
  onMove: (index: number, dir: -1 | 1) => void;
  onCreateLocation: (name: string) => Promise<CreatedLocation | null>;
  onCreateContact: (
    name: string,
    organization: string,
  ) => Promise<CreatedContact | null>;
  onCreatePresentation: (title: string) => Promise<CreatedPresentation | null>;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const dnd = useItineraryDnd();
  const rowRef = useRef<HTMLLIElement>(null);

  const time = [item.startTime, item.endTime].filter(Boolean).join("–");
  const speakers = effectivePresenters(item);
  // Heading is the "what" (title → talk → category); the venue is listed as
  // member-location tags below. Drop the chip when the label IS the category.
  const { primary, presentationIsPrimary, labelFromCategory } =
    scheduleItemPrimaryLabel(item);

  return (
    // Anchor target for deep links from the day view's quick-edit ("All options →").
    <li
      ref={rowRef}
      id={`item-${item.id}`}
      className={cn(
        "relative scroll-mt-20 pl-5",
        dnd.drag?.kind === "item" && dnd.drag.id === item.id && "opacity-50",
      )}
      onDragOver={(e) => {
        if (dnd.current()?.kind !== "item") return;
        dnd.hover(e, {
          kind: "item",
          dayId,
          index: inLowerHalf(e) ? index + 1 : index,
        });
      }}
    >
      {dropLine ? (
        <span
          aria-hidden
          className={cn(
            "absolute -left-px right-0 h-0.5 rounded bg-primary",
            dropLine === "before" ? "-top-1" : "-bottom-1",
          )}
        />
      ) : null}
      <Marker item={item} />
      <div className="flex items-start justify-between gap-3 py-1.5">
        <div className="min-w-0 flex-1">
          {editing && canEdit ? (
            <div className="space-y-4 rounded-md border bg-background p-3">
              {item.travel ? (
                <TravelFields
                  categories={categories}
                  locations={locations}
                  initial={item}
                  submitLabel="Save travel"
                  onSubmit={(data, done, opts) =>
                    run(() => updateScheduleItem(item.id, data, opts), () => {
                      done();
                      setEditing(false);
                    })
                  }
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <ItemFields
                  categories={categories}
                  locations={locations}
                  contacts={contacts}
                  presentations={presentations}
                  initial={item}
                  submitLabel="Save item"
                  onCreateLocation={onCreateLocation}
                  onCreateContact={onCreateContact}
                  onCreatePresentation={onCreatePresentation}
                  onSubmit={(data, done, opts) =>
                    run(() => updateScheduleItem(item.id, data, opts), () => {
                      done();
                      setEditing(false);
                    })
                  }
                  onCancel={() => setEditing(false)}
                />
              )}
              {/* Item bookings are only for site-less items (a coach, a
                  label-only reservation, a travel leg). A venue item is
                  covered by its (trip, location) engagement — point there. */}
              {item.sites.length === 0 ? (
                <BookingsPanel item={item} contacts={contacts} />
              ) : (
                <VenueEngagementNote tripId={tripId} item={item} />
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {/* Fixed-width time gutter so category chips and titles align
                    across rows whether or not an item carries an end time. */}
                <time className="inline-flex w-[5.25rem] shrink-0 items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
                  {time}
                  {item.fixedTime && item.startTime ? (
                    <Lock
                      className="size-3"
                      aria-label="Fixed time"
                    />
                  ) : null}
                </time>
                {item.category && !labelFromCategory ? (
                  <CategoryChip category={item.category} />
                ) : null}
                {item.isBlock ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    block
                  </span>
                ) : null}
                <span
                  className="font-medium"
                  style={
                    labelFromCategory && item.category?.color
                      ? { color: item.category.color }
                      : undefined
                  }
                >
                  {primary}
                </span>
              </div>

              {/* Member locations — the item's "where" (venue is never the heading). */}
              {item.sites.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {item.sites.map((s) => (
                    <span key={s.id} className="inline-flex flex-wrap items-center gap-1.5">
                      <span className="rounded border bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground">
                        {s.location.name}
                      </span>
                      {/* The venue engagement's next step + status. */}
                      <VenueEngagementStatus locationId={s.locationId} />
                    </span>
                  ))}
                </div>
              ) : null}

              {/* A travel item's "where" is its route. */}
              {item.travel ? (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <TravelMethodIcon
                    method={item.travel.method}
                    className="size-3.5 shrink-0"
                  />
                  <span>{travelDetailLine(item.travel) ?? "Route not set"}</span>
                </div>
              ) : null}

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {item.presentation && !presentationIsPrimary ? (
                  <span className="italic">· {item.presentation.title}</span>
                ) : null}
                {speakers.length ? (
                  <span>· {speakers.map((p) => p.name).join(", ")}</span>
                ) : null}
                {item.notes ? <span>· {item.notes}</span> : null}
              </div>

              {/* Booking pills — one per booking. */}
              {item.bookings.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {item.bookings.map((b) => (
                    <BookingPill key={b.id} booking={b} item={item} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        {canEdit && !editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <span
              draggable
              onDragStart={(e) =>
                dnd.begin(e, { kind: "item", id: item.id, dayId }, rowRef.current)
              }
              onDragEnd={dnd.end}
              className="cursor-grab rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
              title="Drag to move"
              aria-hidden
            >
              <GripVertical className="size-4" />
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || index === 0}
              onClick={() => onMove(index, -1)}
              aria-label="Move item up"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || index === total - 1}
              onClick={() => onMove(index, 1)}
              aria-label="Move item down"
            >
              ↓
            </Button>
            {dayOptions.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    Move
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-auto max-w-72">
                  {dayOptions
                    .filter((d) => d.id !== dayId)
                    .map((d) => (
                      <DropdownMenuItem key={d.id} onSelect={() => onMoveToDay(d.id)}>
                        <span className="truncate">{d.label}</span>
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              onClick={() => run(() => deleteScheduleItem(item.id))}
            >
              Delete
            </Button>
          </div>
        ) : null}
      </div>
    </li>
  );
}


function ItemFields({
  categories,
  locations,
  contacts,
  presentations,
  initial,
  defaultLocationId,
  submitLabel,
  onSubmit,
  onCancel,
  onCreateLocation,
  onCreateContact,
  onCreatePresentation,
}: {
  categories: Category[];
  locations: Location[];
  contacts: Contact[];
  presentations: Presentation[];
  initial?: SerializedScheduleItem;
  // Day's primary location — pre-fills the picker for a NEW item (ignored on edit).
  defaultLocationId?: string | null;
  submitLabel: string;
  onSubmit: (
    data: ScheduleItemInputData,
    done: () => void,
    opts?: { cascade?: boolean },
  ) => void;
  onCancel: () => void;
  onCreateLocation: (name: string) => Promise<CreatedLocation | null>;
  onCreateContact: (
    name: string,
    organization: string,
  ) => Promise<CreatedContact | null>;
  onCreatePresentation: (title: string) => Promise<CreatedPresentation | null>;
}) {
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? NONE,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [isBlock, setIsBlock] = useState(initial?.isBlock ?? false);
  const [fixedTime, setFixedTime] = useState(initial?.fixedTime ?? false);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  // Ripple a time change through the rest of the day (edit only). Default on so
  // on-the-fly nudges keep the day's spacing; turn off to leave later items alone.
  const [cascade, setCascade] = useState(true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [presentationId, setPresentationId] = useState<string>(
    initial?.presentationId ?? NONE,
  );
  const [presenterIds, setPresenterIds] = useState<string[]>(
    initial?.presenters.map((p) => p.id) ?? [],
  );
  const [addPresenter, setAddPresenter] = useState<string>(NONE);
  const [locationIds, setLocationIds] = useState<string[]>(
    initial
      ? initial.sites.map((s) => s.locationId)
      : defaultLocationId
        ? [defaultLocationId]
        : [],
  );

  const [showAll, setShowAll] = useState(false);
  const [addLocation, setAddLocation] = useState<string>(NONE);

  // Inline location creation.
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [newName, setNewName] = useState("");

  // Inline talk (presentation) creation.
  const [creatingTalk, setCreatingTalk] = useState(false);
  const [newTalkTitle, setNewTalkTitle] = useState("");

  // Inline presenter (contact) creation.
  const [creatingPresenter, setCreatingPresenter] = useState(false);
  const [newPresenterName, setNewPresenterName] = useState("");
  const [newPresenterOrg, setNewPresenterOrg] = useState("");

  // Self-describing built-ins (Free time / Break) carry only times + notes; the
  // rest of the form is hidden and those fields are cleared on submit.
  const selectedCategory =
    categoryId === NONE
      ? null
      : (categories.find((c) => c.id === categoryId) ?? null);
  const selfDescribing = !!selectedCategory?.system;

  const selectedTalk =
    presentationId === NONE
      ? null
      : (presentations.find((p) => p.id === presentationId) ?? null);
  const contactName = (id: string) =>
    contacts.find((c) => c.id === id)?.name ?? id;
  const availablePresenters = contacts.filter(
    (c) => !presenterIds.includes(c.id),
  );

  const pickPresenter = (id: string) => {
    if (id === NONE || presenterIds.includes(id)) return;
    setPresenterIds((prev) => [...prev, id]);
    setAddPresenter(NONE);
  };

  const handleCreateTalk = async () => {
    const created = await onCreatePresentation(newTalkTitle);
    if (created) {
      setPresentationId(created.id);
      setCreatingTalk(false);
      setNewTalkTitle("");
    }
  };

  const handleCreatePresenter = async () => {
    const created = await onCreateContact(newPresenterName, newPresenterOrg);
    if (created) {
      setPresenterIds((prev) =>
        prev.includes(created.id) ? prev : [...prev, created.id],
      );
      setCreatingPresenter(false);
      setNewPresenterName("");
      setNewPresenterOrg("");
    }
  };

  const locationName = (id: string) =>
    locations.find((s) => s.id === id)?.name ?? id;

  const availableLocations = (
    showAll ? locations : locations.filter((s) => s.tagged)
  ).filter((s) => !locationIds.includes(s.id));

  const pickLocation = (id: string) => {
    if (id === NONE || locationIds.includes(id)) return;
    setLocationIds((prev) => [...prev, id]);
    setAddLocation(NONE);
  };

  const handleCreate = async () => {
    const created = await onCreateLocation(newName);
    if (created) {
      setLocationIds((prev) =>
        prev.includes(created.id) ? prev : [...prev, created.id],
      );
      setCreatingLocation(false);
      setNewName("");
    }
  };

  // End can't precede start. `min` guides native pickers; this backstops manual
  // entry and disables Save so the bad state never reaches the server refine.
  const timesInvalid =
    !!startTime &&
    !!endTime &&
    timeToMinutes(startTime) !== null &&
    timeToMinutes(endTime) !== null &&
    (timeToMinutes(endTime) as number) < (timeToMinutes(startTime) as number);

  // Moving the start past the end drags the end along, preserving the item's
  // prior duration — so nudging a start later never inverts the slot.
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

  // Only editing a persisted, timed item can ripple the rest of the day.
  const canCascade = !!initial && !!startTime && !selfDescribing;

  const submit = () => {
    onSubmit(
      {
        categoryId: categoryId === NONE ? undefined : categoryId,
        title: selfDescribing ? undefined : title.trim() || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        notes: notes.trim() || undefined,
        isBlock: selfDescribing ? false : isBlock,
        fixedTime: !!startTime && fixedTime,
        presentationId:
          selfDescribing || presentationId === NONE ? undefined : presentationId,
        presenterIds: selfDescribing ? [] : presenterIds,
        locationIds: selfDescribing ? [] : locationIds,
      },
      () => {
        if (!initial) {
          setCategoryId(NONE);
          setTitle("");
          setIsBlock(false);
          setFixedTime(false);
          setStartTime("");
          setEndTime("");
          setNotes("");
          setPresentationId(NONE);
          setPresenterIds([]);
          // Re-seed the day's primary so a run of items at one venue stays pre-filled.
          setLocationIds(defaultLocationId ? [defaultLocationId] : []);
        }
      },
      { cascade: canCascade && cascade },
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Uncategorized</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selfDescribing ? null : (
          <div className="space-y-1.5">
            <Label className="text-xs">
              Title{" "}
              <span className="text-muted-foreground">
                {locationIds.length === 0 ? "(required)" : "(optional)"}
              </span>
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                locationIds.length === 0
                  ? "e.g. Lunch, Transit, Talk"
                  : "Override label"
              }
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs">Start time</Label>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => onStartChange(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">End time</Label>
          <Input
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

      {selfDescribing ? null : (
      /* Locations (0..n) — the day's "where", kept near the top. */
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Locations</Label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={showAll}
              onCheckedChange={(v) => setShowAll(v === true)}
            />
            Show all locations
          </label>
        </div>

        {locationIds.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {locationIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded border bg-muted/50 px-2 py-0.5 text-xs"
              >
                {locationName(id)}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${locationName(id)}`}
                  onClick={() =>
                    setLocationIds((prev) => prev.filter((s) => s !== id))
                  }
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No locations.
          </p>
        )}

        <Select value={addLocation} onValueChange={pickLocation}>
          <SelectTrigger size="sm">
            <SelectValue placeholder="+ Add a location" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>+ Add a location…</SelectItem>
            {availableLocations.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                {s.region ? ` · ${s.region}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {creatingLocation ? (
          <div className="space-y-2 rounded-md border border-dashed p-2">
            <Input
              placeholder="New location name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={handleCreate}>
                Create & add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreatingLocation(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setCreatingLocation(true)}
          >
            + Create a new location
          </button>
        )}

        {/* The free-choice block toggle governs the locations above it. */}
        <label className="flex items-center gap-2 border-t pt-2 text-sm">
          <Checkbox
            checked={isBlock}
            onCheckedChange={(v) => setIsBlock(v === true)}
          />
          Free-choice block
        </label>
      </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {selfDescribing ? null : (
      /* Talk & presenters — content/speaker detail, sectioned off (like the
         Bookings panel) since it only applies to presentation-style items. */
      <div className="space-y-3 rounded-md border p-3">
        <Label className="text-xs">Talk &amp; presenters</Label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Talk</Label>
            <Select value={presentationId} onValueChange={setPresentationId}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="— none —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— none —</SelectItem>
                {presentations.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {creatingTalk ? (
              <div className="space-y-2 rounded-md border border-dashed p-2">
                <Input
                  placeholder="Talk title"
                  value={newTalkTitle}
                  onChange={(e) => setNewTalkTitle(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={handleCreateTalk}>
                    Create & select
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreatingTalk(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setCreatingTalk(true)}
              >
                + Create a new talk
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Presenters{" "}
              <span className="text-muted-foreground">(override)</span>
            </Label>
            {presenterIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {presenterIds.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded border bg-muted/50 px-2 py-0.5 text-xs"
                  >
                    {contactName(id)}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${contactName(id)}`}
                      onClick={() =>
                        setPresenterIds((prev) => prev.filter((p) => p !== id))
                      }
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {selectedTalk && selectedTalk.defaultPresenters.length
                  ? `Talk default: ${selectedTalk.defaultPresenters
                      .map((p) => p.name)
                      .join(", ")}`
                  : "None."}
              </p>
            )}
            <Select value={addPresenter} onValueChange={pickPresenter}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="+ Add a presenter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>+ Add a presenter…</SelectItem>
                {availablePresenters.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {creatingPresenter ? (
              <div className="space-y-2 rounded-md border border-dashed p-2">
                <Input
                  placeholder="Presenter name"
                  value={newPresenterName}
                  onChange={(e) => setNewPresenterName(e.target.value)}
                />
                <Input
                  placeholder="Organization (optional)"
                  value={newPresenterOrg}
                  onChange={(e) => setNewPresenterOrg(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreatePresenter}
                  >
                    Create & add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreatingPresenter(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setCreatingPresenter(true)}
              >
                + Create a new presenter
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={timesInvalid}
          onClick={submit}
        >
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// One stop row's local form state in the travel editor.
type StopDraft = {
  key: number;
  locationId: string; // NONE = free-text only
  label: string;
  dwellMinutes: string;
};

// The travel-leg form (GH #80): method + origin/destination (catalogued
// location or free text) + en-route stops, plus the item-level times/notes.
// Submits through the same add/updateScheduleItem actions with a `travel`
// payload; locations/title/presenters are forced empty server-side.
function TravelFields({
  categories,
  locations,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  categories: Category[];
  locations: Location[];
  initial?: SerializedScheduleItem;
  submitLabel: string;
  onSubmit: (
    data: ScheduleItemInputData,
    done: () => void,
    opts?: { cascade?: boolean },
  ) => void;
  onCancel: () => void;
}) {
  const leg = initial?.travel ?? null;
  const [method, setMethod] = useState<TravelMethod>(leg?.method ?? "COACH");
  const [fromLocationId, setFromLocationId] = useState<string>(
    leg?.fromLocation?.id ?? NONE,
  );
  const [fromLabel, setFromLabel] = useState(leg?.fromLabel ?? "");
  const [toLocationId, setToLocationId] = useState<string>(
    leg?.toLocation?.id ?? NONE,
  );
  const [toLabel, setToLabel] = useState(leg?.toLabel ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [fixedTime, setFixedTime] = useState(initial?.fixedTime ?? false);
  const [cascade, setCascade] = useState(true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [stops, setStops] = useState<StopDraft[]>(
    leg?.stops.map((s, i) => ({
      key: i,
      locationId: s.location?.id ?? NONE,
      label: s.label ?? "",
      dwellMinutes: s.dwellMinutes != null ? String(s.dwellMinutes) : "",
    })) ?? [],
  );

  // The non-system "Travel" category, when the catalog still has one — attached
  // for its marker colour only; nothing depends on it.
  const travelCategoryId =
    initial?.categoryId ??
    categories.find((c) => c.name === "Travel" && !c.system)?.id;

  const timesInvalid =
    !!startTime &&
    !!endTime &&
    timeToMinutes(startTime) !== null &&
    timeToMinutes(endTime) !== null &&
    (timeToMinutes(endTime) as number) < (timeToMinutes(startTime) as number);

  // Same duration-preserving nudge as ItemFields: moving the depart time past
  // the arrive time drags the arrive time along.
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

  const patchStop = (key: number, part: Partial<StopDraft>) =>
    setStops((prev) => prev.map((s) => (s.key === key ? { ...s, ...part } : s)));

  const canCascade = !!initial && !!startTime;
  // A stop needs a location or a label to survive the validator.
  const stopsIncomplete = stops.some(
    (s) => s.locationId === NONE && !s.label.trim(),
  );

  const submit = () => {
    const travel: TravelLegInputData = {
      method,
      fromLocationId: fromLocationId === NONE ? undefined : fromLocationId,
      fromLabel: fromLabel.trim() || undefined,
      toLocationId: toLocationId === NONE ? undefined : toLocationId,
      toLabel: toLabel.trim() || undefined,
      stops: stops.map((s) => ({
        locationId: s.locationId === NONE ? undefined : s.locationId,
        label: s.label.trim() || undefined,
        dwellMinutes: s.dwellMinutes.trim() || undefined,
      })),
    };
    onSubmit(
      {
        categoryId: travelCategoryId ?? undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        notes: notes.trim() || undefined,
        isBlock: false,
        fixedTime: !!startTime && fixedTime,
        presenterIds: [],
        locationIds: [],
        travel,
      },
      () => {
        if (!initial) {
          setMethod("COACH");
          setFromLocationId(NONE);
          setFromLabel("");
          setToLocationId(NONE);
          setToLabel("");
          setStartTime("");
          setEndTime("");
          setFixedTime(false);
          setNotes("");
          setStops([]);
        }
      },
      { cascade: canCascade && cascade },
    );
  };

  const endpointPicker = (
    label: string,
    locationId: string,
    setLocationId: (v: string) => void,
    freeText: string,
    setFreeText: (v: string) => void,
  ) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Select value={locationId} onValueChange={setLocationId}>
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— no catalogued location —</SelectItem>
          {locations.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.name}
              {l.region ? ` · ${l.region}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {locationId === NONE ? (
        <Input
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="e.g. Bristol"
        />
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Method</Label>
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as TravelMethod)}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(
                Object.entries(TRAVEL_METHOD_LABELS) as [TravelMethod, string][]
              ).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden sm:block" />
        {endpointPicker("From", fromLocationId, setFromLocationId, fromLabel, setFromLabel)}
        {endpointPicker("To", toLocationId, setToLocationId, toLabel, setToLabel)}
        <div className="space-y-1.5">
          <Label className="text-xs">Depart</Label>
          <Input
            type="time"
            value={startTime}
            onChange={(e) => onStartChange(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Arrive</Label>
          <Input
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
          Arrive is before depart.
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

      {/* En-route stops — comfort/photo stops that belong to the leg, not the day. */}
      <div className="space-y-2 rounded-md border p-3">
        <Label className="text-xs">En-route stops</Label>
        {stops.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            None.
          </p>
        ) : (
          stops.map((s) => (
            <div key={s.key} className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1 space-y-1">
                <Label className="text-xs">Location</Label>
                <Select
                  value={s.locationId}
                  onValueChange={(v) => patchStop(s.key, { locationId: v })}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>— free text —</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {s.locationId === NONE ? (
                <div className="min-w-36 flex-1 space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input
                    value={s.label}
                    onChange={(e) => patchStop(s.key, { label: e.target.value })}
                    placeholder="e.g. M5 services"
                  />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label className="text-xs">Dwell (min)</Label>
                <Input
                  type="number"
                  min="0"
                  step="5"
                  inputMode="numeric"
                  value={s.dwellMinutes}
                  onChange={(e) =>
                    patchStop(s.key, { dwellMinutes: e.target.value })
                  }
                  className="w-24"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  setStops((prev) => prev.filter((x) => x.key !== s.key))
                }
                className="pb-2 text-xs text-destructive underline-offset-2 hover:underline"
              >
                Remove
              </button>
            </div>
          ))
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setStops((prev) => [
              ...prev,
              {
                key: (prev[prev.length - 1]?.key ?? -1) + 1,
                locationId: NONE,
                label: "",
                dwellMinutes: "",
              },
            ])
          }
        >
          + Add stop
        </Button>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={timesInvalid || stopsIncomplete}
          onClick={submit}
        >
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// A venue item's booking lives on the (trip, location) engagement, not the item.
// Per member location: that engagement's step strip (acts on the one (trip,
// location) booking, shared by every item at the venue) + a link to it; any
// legacy per-item bookings still show (read-only) so old data isn't hidden.
function VenueEngagementNote({
  tripId,
  item,
}: {
  tripId: string;
  item: SerializedScheduleItem;
}) {
  const many = item.sites.length > 1;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <ul className="space-y-2 text-xs">
        {item.sites.map((s) => (
          <li key={s.id} className="space-y-1">
            <Link
              href={`/trips/${tripId}/booking?venue=${encodeURIComponent(s.locationId)}`}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {many ? `${s.location.name} booking` : "Venue booking"}
            </Link>
            <VenueEngagementSteps locationId={s.locationId} name={s.location.name} />
          </li>
        ))}
      </ul>
      {item.bookings.length > 0 ? (
        <div className="space-y-1">
          <Label className="text-xs">Legacy item bookings</Label>
          {item.bookings.map((b) => (
            <div key={b.id} className="rounded border px-2 py-1.5">
              <BookingPill booking={b} item={item} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Booking management for a persisted SITE-LESS item (coach, label-only
// reservation, travel leg). Bookings save immediately via their own actions
// (independent of the item's Save).
function BookingsPanel({
  item,
  contacts,
}: {
  item: SerializedScheduleItem;
  contacts: Contact[];
}) {
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Bookings</Label>
        {!adding ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
          >
            + Add booking
          </Button>
        ) : null}
      </div>

      {item.bookings.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">
          No bookings.
        </p>
      ) : null}

      {item.bookings.map((b) =>
        editingId === b.id ? (
          <BookingFields
            key={b.id}
            item={item}
            contacts={contacts}
            initial={b}
            submitLabel="Save booking"
            onSubmit={(data, done) =>
              run(() => updateBooking(b.id, data), () => {
                done();
                setEditingId(null);
              })
            }
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <div
            key={b.id}
            className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
          >
            <BookingPill booking={b} item={item} />
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditingId(b.id)}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      "Delete booking with its payments, schedule, documents and notes?",
                    )
                  )
                    run(() => deleteBooking(b.id));
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ),
      )}

      {adding ? (
        <BookingFields
          item={item}
          contacts={contacts}
          submitLabel="Add booking"
          onSubmit={(data, done) =>
            run(() => addBooking(item.id, data), () => {
              done();
              setAdding(false);
            })
          }
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function BookingFields({
  item,
  contacts,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  item: SerializedScheduleItem;
  contacts: Contact[];
  initial?: SerializedBooking;
  submitLabel: string;
  onSubmit: (data: BookingInputData, done: () => void) => void;
  onCancel: () => void;
}) {
  const [locationId, setLocationId] = useState<string>(
    initial?.locationId ?? NONE,
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [bookedContactId, setBookedContactId] = useState<string>(
    initial?.bookedContactId ?? NONE,
  );
  const [confirmationRef, setConfirmationRef] = useState(
    initial?.confirmationRef ?? "",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const submit = () => {
    onSubmit(
      {
        locationId: locationId === NONE ? undefined : locationId,
        label: label.trim() || undefined,
        bookedContactId: bookedContactId === NONE ? undefined : bookedContactId,
        confirmationRef: confirmationRef.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      () => {
        if (!initial) {
          setLocationId(NONE);
          setLabel("");
          setBookedContactId(NONE);
          setConfirmationRef("");
          setNotes("");
        }
      },
    );
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">For location</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>The whole item</SelectItem>
              {item.sites.map((s) => (
                <SelectItem key={s.locationId} value={s.locationId}>
                  {s.location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Coach"
          />
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
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
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
