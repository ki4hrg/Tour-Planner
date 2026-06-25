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
  BOOKING_STATUS_CLASSES,
  BOOKING_STATUSES,
  type SerializedDay,
  type SerializedScheduleItem,
  type SerializedBooking,
} from "@/lib/trips";
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
  createTripSite,
  createContactInline,
  type ScheduleItemInputData,
  type BookingInputData,
  type CreatedSite,
  type CreatedContact,
} from "./actions";

const NONE = "__none__";

type Site = { id: string; name: string; region: string | null; tagged: boolean };
type Contact = { id: string; name: string };
type Category = { id: string; name: string; color: string | null };

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
  categories,
  sites: initialSites,
  contacts: initialContacts,
}: {
  tripId: string;
  canEdit: boolean;
  hasStartDate: boolean;
  days: SerializedDay[];
  categories: Category[];
  sites: Site[];
  contacts: Contact[];
}) {
  // Inline-created sites/contacts are held locally so they show immediately;
  // server revalidation folds them into the props shortly after (deduped by id).
  const [extraSites, setExtraSites] = useState<Site[]>([]);
  const sites = useMemo(() => {
    const ids = new Set(initialSites.map((s) => s.id));
    const merged = [...initialSites, ...extraSites.filter((s) => !ids.has(s.id))];
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [initialSites, extraSites]);

  const [extraContacts, setExtraContacts] = useState<Contact[]>([]);
  const contacts = useMemo(() => {
    const ids = new Set(initialContacts.map((c) => c.id));
    const merged = [
      ...initialContacts,
      ...extraContacts.filter((c) => !ids.has(c.id)),
    ];
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }, [initialContacts, extraContacts]);

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
          categories={categories}
          sites={sites}
          contacts={contacts}
          onMove={moveDay}
          onCreateSite={addNewSite}
          onCreateContact={addNewContact}
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
  sites,
  contacts,
  onMove,
  onCreateSite,
  onCreateContact,
}: {
  day: SerializedDay;
  index: number;
  total: number;
  canEdit: boolean;
  categories: Category[];
  sites: Site[];
  contacts: Contact[];
  onMove: (index: number, dir: -1 | 1) => void;
  onCreateSite: (name: string, region: string) => Promise<CreatedSite | null>;
  onCreateContact: (
    name: string,
    organization: string,
  ) => Promise<CreatedContact | null>;
}) {
  const { pending, run } = useAction();
  const [editingDay, setEditingDay] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(day.title ?? "");
  const [notes, setNotes] = useState(day.logisticalNotes ?? "");

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

      {/* The day's route line: items as waymarkers on a single vertical way. */}
      <div className="px-4 py-3">
        {day.items.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">No items yet.</p>
        ) : (
          <ol className="relative ml-1.5 space-y-1 border-l-2 border-border">
            {day.items.map((item, si) => (
              <ItemRow
                key={item.id}
                item={item}
                index={si}
                total={day.items.length}
                canEdit={canEdit}
                categories={categories}
                sites={sites}
                contacts={contacts}
                onMove={moveItem}
                onCreateSite={onCreateSite}
                onCreateContact={onCreateContact}
              />
            ))}
          </ol>
        )}
      </div>

      {canEdit ? (
        <div className="border-t p-4">
          {adding ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-2 text-sm font-medium">Add an item</p>
              <ItemFields
                categories={categories}
                sites={sites}
                contacts={contacts}
                submitLabel="Add item"
                onCreateSite={onCreateSite}
                onCreateContact={onCreateContact}
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
  sites,
  contacts,
  onMove,
  onCreateSite,
  onCreateContact,
}: {
  item: SerializedScheduleItem;
  index: number;
  total: number;
  canEdit: boolean;
  categories: Category[];
  sites: Site[];
  contacts: Contact[];
  onMove: (index: number, dir: -1 | 1) => void;
  onCreateSite: (name: string, region: string) => Promise<CreatedSite | null>;
  onCreateContact: (
    name: string,
    organization: string,
  ) => Promise<CreatedContact | null>;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);

  const time = [item.startTime, item.endTime].filter(Boolean).join("–");
  const siteNames = item.sites.map((s) => s.site.name);
  const primary =
    item.title ??
    (item.sites.length === 1
      ? siteNames[0]
      : item.isBlock
        ? `Choose from ${item.sites.length} site${item.sites.length === 1 ? "" : "s"}`
        : item.sites.length > 1
          ? `${item.sites.length} sites`
          : "Untitled item");
  // The single bare site name is already the primary label; otherwise list the
  // member sites so they're never hidden behind a title (e.g. Travel items).
  const siteIsPrimary =
    item.sites.length === 1 && !item.title && !item.isBlock;

  return (
    <li className="relative pl-5">
      <Marker item={item} />
      <div className="flex items-start justify-between gap-3 py-1.5">
        <div className="min-w-0 flex-1">
          {editing && canEdit ? (
            <div className="space-y-4 rounded-md border bg-background p-3">
              <ItemFields
                categories={categories}
                sites={sites}
                contacts={contacts}
                initial={item}
                submitLabel="Save item"
                onCreateSite={onCreateSite}
                onCreateContact={onCreateContact}
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
                {time ? (
                  <time className="font-mono text-xs tabular-nums text-muted-foreground">
                    {time}
                  </time>
                ) : null}
                {item.category ? (
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    style={{
                      color: item.category.color ?? "var(--muted-foreground)",
                      backgroundColor: item.category.color
                        ? `color-mix(in oklab, ${item.category.color} 14%, transparent)`
                        : "var(--muted)",
                    }}
                  >
                    {item.category.name}
                  </span>
                ) : null}
                {item.isBlock ? (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    block
                  </span>
                ) : null}
                <span className="font-medium">{primary}</span>
              </div>

              {/* Member sites — shown unless the single site is already the title. */}
              {item.sites.length > 0 && !siteIsPrimary ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.sites.map((s) => (
                    <span
                      key={s.id}
                      className="rounded border bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {s.site.name}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {item.presenter ? <span>· {item.presenter.name}</span> : null}
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

function BookingPill({
  booking,
  item,
}: {
  booking: SerializedBooking;
  item: SerializedScheduleItem;
}) {
  const forSite =
    booking.siteId != null
      ? item.sites.find((s) => s.siteId === booking.siteId)?.site.name
      : null;
  const what = booking.label ?? forSite ?? null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={cn(
          "rounded-full px-2 py-0.5 font-medium",
          BOOKING_STATUS_CLASSES[booking.status],
        )}
      >
        {BOOKING_STATUS_LABELS[booking.status]}
      </span>
      {what ? <span className="text-muted-foreground">{what}</span> : null}
      {booking.bookedContact ? (
        <span className="text-muted-foreground">· {booking.bookedContact.name}</span>
      ) : null}
      {booking.confirmationRef ? (
        <span className="text-muted-foreground">· ref {booking.confirmationRef}</span>
      ) : null}
    </span>
  );
}

function ItemFields({
  categories,
  sites,
  contacts,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  onCreateSite,
  onCreateContact,
}: {
  categories: Category[];
  sites: Site[];
  contacts: Contact[];
  initial?: SerializedScheduleItem;
  submitLabel: string;
  onSubmit: (data: ScheduleItemInputData, done: () => void) => void;
  onCancel: () => void;
  onCreateSite: (name: string, region: string) => Promise<CreatedSite | null>;
  onCreateContact: (
    name: string,
    organization: string,
  ) => Promise<CreatedContact | null>;
}) {
  const [categoryId, setCategoryId] = useState<string>(
    initial?.categoryId ?? NONE,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [isBlock, setIsBlock] = useState(initial?.isBlock ?? false);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [presenterId, setPresenterId] = useState<string>(
    initial?.presenterContactId ?? NONE,
  );
  const [siteIds, setSiteIds] = useState<string[]>(
    initial?.sites.map((s) => s.siteId) ?? [],
  );

  const [showAll, setShowAll] = useState(false);
  const [addSite, setAddSite] = useState<string>(NONE);

  // Inline site creation.
  const [creatingSite, setCreatingSite] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRegion, setNewRegion] = useState("");

  // Inline presenter (contact) creation.
  const [creatingPresenter, setCreatingPresenter] = useState(false);
  const [newPresenterName, setNewPresenterName] = useState("");
  const [newPresenterOrg, setNewPresenterOrg] = useState("");

  const handleCreatePresenter = async () => {
    const created = await onCreateContact(newPresenterName, newPresenterOrg);
    if (created) {
      setPresenterId(created.id);
      setCreatingPresenter(false);
      setNewPresenterName("");
      setNewPresenterOrg("");
    }
  };

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? id;

  const availableSites = (showAll ? sites : sites.filter((s) => s.tagged)).filter(
    (s) => !siteIds.includes(s.id),
  );

  const pickSite = (id: string) => {
    if (id === NONE || siteIds.includes(id)) return;
    setSiteIds((prev) => [...prev, id]);
    setAddSite(NONE);
  };

  const handleCreate = async () => {
    const created = await onCreateSite(newName, newRegion);
    if (created) {
      setSiteIds((prev) =>
        prev.includes(created.id) ? prev : [...prev, created.id],
      );
      setCreatingSite(false);
      setNewName("");
      setNewRegion("");
    }
  };

  const submit = () => {
    onSubmit(
      {
        categoryId: categoryId === NONE ? undefined : categoryId,
        title: title.trim() || undefined,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        notes: notes.trim() || undefined,
        isBlock,
        presenterContactId: presenterId === NONE ? undefined : presenterId,
        siteIds,
      },
      () => {
        if (!initial) {
          setCategoryId(NONE);
          setTitle("");
          setIsBlock(false);
          setStartTime("");
          setEndTime("");
          setNotes("");
          setPresenterId(NONE);
          setSiteIds([]);
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

        <div className="space-y-1.5">
          <Label className="text-xs">
            Title{" "}
            <span className="text-muted-foreground">
              {siteIds.length === 0 ? "(required without a site)" : "(optional)"}
            </span>
          </Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              siteIds.length === 0 ? "e.g. Lunch, Transit, Talk" : "Override label"
            }
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

        <div className="space-y-1.5">
          <Label className="text-xs">Presenter</Label>
          <Select value={presenterId} onValueChange={setPresenterId}>
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
                <Button type="button" size="sm" onClick={handleCreatePresenter}>
                  Create & select
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

        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isBlock}
              onCheckedChange={(v) => setIsBlock(v === true)}
            />
            Free-choice block (subgroups pick among the sites)
          </label>
        </div>
      </div>

      {/* Sites (0..n) */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Sites</Label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={showAll}
              onCheckedChange={(v) => setShowAll(v === true)}
            />
            Show all sites
          </label>
        </div>

        {siteIds.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {siteIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded border bg-muted/50 px-2 py-0.5 text-xs"
              >
                {siteName(id)}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${siteName(id)}`}
                  onClick={() =>
                    setSiteIds((prev) => prev.filter((s) => s !== id))
                  }
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No sites — this is an informational line (give it a title).
          </p>
        )}

        <Select value={addSite} onValueChange={pickSite}>
          <SelectTrigger size="sm">
            <SelectValue placeholder="+ Add a site" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>+ Add a site…</SelectItem>
            {availableSites.map((s) => (
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
                Create & add
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
        <Label className="text-xs">Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
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
  const [siteId, setSiteId] = useState<string>(initial?.siteId ?? NONE);
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
        siteId: siteId === NONE ? undefined : siteId,
        label: label.trim() || undefined,
        status,
        bookedContactId: bookedContactId === NONE ? undefined : bookedContactId,
        confirmationRef: confirmationRef.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      () => {
        if (!initial) {
          setSiteId(NONE);
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
          <Label className="text-xs">For site</Label>
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>The whole item</SelectItem>
              {item.sites.map((s) => (
                <SelectItem key={s.siteId} value={s.siteId}>
                  {s.site.name}
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
