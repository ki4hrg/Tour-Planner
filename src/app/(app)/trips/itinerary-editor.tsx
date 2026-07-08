"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
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
  BOOKING_STATUSES,
  effectivePresenters,
  scheduleItemPrimaryLabel,
  type SerializedDay,
  type SerializedScheduleItem,
  type SerializedBooking,
} from "@/lib/trips";
import {
  TimelineGroups,
  BookingPill,
  CategoryChip,
} from "./itinerary-timeline";
import type { BookingStatus } from "@prisma/client";
import type { FormState } from "@/lib/forms";
import {
  addDay,
  updateDay,
  deleteDay,
  reorderDays,
  addScheduleItem,
  updateScheduleItem,
  deleteScheduleItem,
  reorderScheduleItems,
  addBooking,
  updateBooking,
  deleteBooking,
  createTripLocation,
  createContactInline,
  createPresentationInline,
  type ScheduleItemInputData,
  type BookingInputData,
  type CreatedLocation,
  type CreatedContact,
  type CreatedPresentation,
} from "./actions";

const NONE = "__none__";

// Hints shown when a self-describing built-in category is chosen, clarifying the
// distinction between similar kinds. Falls back to a generic note.
const SYSTEM_CATEGORY_HINTS: Record<string, string> = {
  Break: "A short on-site pause — refreshments or a stretch. Just set the time.",
  "Free time": "Unstructured time for participants to explore on their own.",
};

type Location = {
  id: string;
  name: string;
  region: string | null;
  tagged: boolean;
};
type Contact = { id: string; name: string };
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

  const moveDay = (index: number, dir: -1 | 1) => {
    const next = [...days];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    run(() => reorderDays(tripId, next.map((d) => d.id)));
  };

  return (
    <div className="space-y-4">
      {!hasStartDate && !isTemplate ? (
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
          categories={categories}
          locations={locations}
          contacts={contacts}
          presentations={presentations}
          onMove={moveDay}
          onCreateLocation={addNewLocation}
          onCreateContact={addNewContact}
          onCreatePresentation={addNewPresentation}
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
  categories,
  locations,
  contacts,
  presentations,
  onMove,
  onCreateLocation,
  onCreateContact,
  onCreatePresentation,
}: {
  day: SerializedDay;
  index: number;
  total: number;
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
  const [editingDay, setEditingDay] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(day.title ?? "");
  const [notes, setNotes] = useState(day.logisticalNotes ?? "");
  const [participantNotes, setParticipantNotes] = useState(
    day.participantNotes ?? "",
  );

  const moveItem = (itemIndex: number, dir: -1 | 1) => {
    const next = [...day.items];
    const target = itemIndex + dir;
    if (target < 0 || target >= next.length) return;
    [next[itemIndex], next[target]] = [next[target], next[itemIndex]];
    run(() => reorderScheduleItems(day.id, next.map((s) => s.id)));
  };

  return (
    <div className="rounded-lg border bg-card">
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
            <Label className="text-xs">
              Participant notes{" "}
              <span className="text-muted-foreground">
                (theme, scripture, walk notes — participant-facing)
              </span>
            </Label>
            <Textarea
              rows={2}
              value={participantNotes}
              onChange={(e) => setParticipantNotes(e.target.value)}
              placeholder="e.g. Theme: The Road to Emmaus · Luke 24:13–35"
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
                    participantNotes,
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

      {/* Editing: the day's route line with per-item controls. Read-only viewers
          get the grouped venue-run layout (location once per run). */}
      <div className="px-4 py-3">
        {day.items.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No items yet.</p>
        ) : canEdit ? (
          <ol className="relative ml-1.5 space-y-1 border-l-2 border-border">
            {day.items.map((item, si) => (
              <ItemRow
                key={item.id}
                item={item}
                index={si}
                total={day.items.length}
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
          <TimelineGroups items={day.items} showBookings />
        )}
      </div>

      {canEdit ? (
        <div className="border-t p-4">
          {adding ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-2 text-sm font-medium">Add an item</p>
              <ItemFields
                categories={categories}
                locations={locations}
                contacts={contacts}
                presentations={presentations}
                submitLabel="Add item"
                onCreateLocation={onCreateLocation}
                onCreateContact={onCreateContact}
                onCreatePresentation={onCreatePresentation}
                onSubmit={(data, done) =>
                  run(() => addScheduleItem(day.id, data), () => {
                    done();
                    setAdding(false);
                  })
                }
                onCancel={() => setAdding(false)}
              />
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              + Add item
            </Button>
          )}
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
  item,
  index,
  total,
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
  item: SerializedScheduleItem;
  index: number;
  total: number;
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

  const time = [item.startTime, item.endTime].filter(Boolean).join("–");
  const speakers = effectivePresenters(item);
  // Heading is the "what" (title → talk → category); the venue is listed as
  // member-location tags below. Drop the chip when the label IS the category.
  const { primary, presentationIsPrimary, labelFromCategory } =
    scheduleItemPrimaryLabel(item);

  return (
    <li className="relative pl-5">
      <Marker item={item} />
      <div className="flex items-start justify-between gap-3 py-1.5">
        <div className="min-w-0 flex-1">
          {editing && canEdit ? (
            <div className="space-y-4 rounded-md border bg-background p-3">
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
                onSubmit={(data, done) =>
                  run(() => updateScheduleItem(item.id, data), () => {
                    done();
                    setEditing(false);
                  })
                }
                onCancel={() => setEditing(false)}
              />
              <BookingsPanel item={item} contacts={contacts} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {/* Fixed-width time gutter so category chips and titles align
                    across rows whether or not an item carries an end time. */}
                <time className="w-[5.25rem] shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {time}
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
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.sites.map((s) => (
                    <span
                      key={s.id}
                      className="rounded border bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {s.location.name}
                    </span>
                  ))}
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
  submitLabel: string;
  onSubmit: (data: ScheduleItemInputData, done: () => void) => void;
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
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [presentationId, setPresentationId] = useState<string>(
    initial?.presentationId ?? NONE,
  );
  const [presenterIds, setPresenterIds] = useState<string[]>(
    initial?.presenters.map((p) => p.id) ?? [],
  );
  const [addPresenter, setAddPresenter] = useState<string>(NONE);
  const [locationIds, setLocationIds] = useState<string[]>(
    initial?.sites.map((s) => s.locationId) ?? [],
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

  const submit = () => {
    onSubmit(
      {
        categoryId: categoryId === NONE ? undefined : categoryId,
        title: selfDescribing ? undefined : title.trim() || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        notes: notes.trim() || undefined,
        isBlock: selfDescribing ? false : isBlock,
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
          setStartTime("");
          setEndTime("");
          setNotes("");
          setPresentationId(NONE);
          setPresenterIds([]);
          setLocationIds([]);
        }
      },
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
                {locationIds.length === 0
                  ? "(required without a location)"
                  : "(optional)"}
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
      </div>

      {selfDescribing && selectedCategory ? (
        <p className="text-xs text-muted-foreground">
          {SYSTEM_CATEGORY_HINTS[selectedCategory.name] ??
            "Just set a time (and any notes) — no title or location."}
        </p>
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
            No locations — this is an informational line (give it a title).
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
          Free-choice block (subgroups pick among the locations)
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
                  ? `Using talk defaults: ${selectedTalk.defaultPresenters
                      .map((p) => p.name)
                      .join(", ")}`
                  : "None — leave empty to use the talk's defaults."}
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

// Booking management for a persisted item. Bookings save immediately via their
// own actions (independent of the item's Save).
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
          No bookings — leave empty for informational items.
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
                onClick={() => run(() => deleteBooking(b.id))}
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
  const [status, setStatus] = useState<BookingStatus>(
    initial?.status ?? "NOT_BOOKED",
  );
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
        status,
        bookedContactId: bookedContactId === NONE ? undefined : bookedContactId,
        confirmationRef: confirmationRef.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      () => {
        if (!initial) {
          setLocationId(NONE);
          setLabel("");
          setStatus("NOT_BOOKED");
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
          <Label className="text-xs">
            Label{" "}
            <span className="text-muted-foreground">(e.g. coach, lunch)</span>
          </Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as BookingStatus)}
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
