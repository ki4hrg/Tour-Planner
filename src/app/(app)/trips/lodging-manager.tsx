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
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import {
  BOARD_LABELS,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_CLASSES,
  BOOKING_STATUSES,
  type SerializedStay,
  type SerializedBooking,
} from "@/lib/trips";
import { nightsBetween, stayTotal } from "@/lib/stays";
import { BOARD_TYPES } from "@/lib/validators/stay";
import {
  addStay,
  updateStay,
  deleteStay,
  addStayBooking,
  updateBooking,
  deleteBooking,
  type StayInputData,
  type BookingInputData,
} from "./actions";

const NONE = "__none__";

type Location = { id: string; name: string; region: string | null };
type Contact = { id: string; name: string };

// Run a FormState-returning action, surfacing the result as a toast.
function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string; ok?: boolean }>, onOk?: () => void) =>
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

export function LodgingManager({
  tripId,
  canEdit,
  locations: initialLocations,
  contacts: initialContacts,
  stays,
}: {
  tripId: string;
  canEdit: boolean;
  locations: Location[];
  contacts: Contact[];
  stays: SerializedStay[];
}) {
  const locations = useMemo(
    () => initialLocations.sort((a, b) => a.name.localeCompare(b.name)),
    [initialLocations],
  );

  const contacts = useMemo(
    () => initialContacts.sort((a, b) => a.name.localeCompare(b.name)),
    [initialContacts],
  );

  const { pending, run } = useAction();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      {stays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stays yet.</p>
      ) : (
        <div className="space-y-2">
          {stays.map((stay) => (
            <StayRow
              key={stay.id}
              stay={stay}
              canEdit={canEdit}
              locations={locations}
              contacts={contacts}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        adding ? (
          <div className="rounded-md border border-dashed p-3">
            <p className="mb-2 text-sm font-medium">Add a stay</p>
            <StayFields
              locations={locations}
              submitLabel="Add stay"
              onSubmit={(data, done) =>
                run(() => addStay(tripId, data), () => {
                  done();
                  setAdding(false);
                })
              }
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setAdding(true)}
          >
            + Add stay
          </Button>
        )
      ) : null}
    </div>
  );
}

function StayRow({
  stay,
  canEdit,
  locations,
  contacts,
}: {
  stay: SerializedStay;
  canEdit: boolean;
  locations: Location[];
  contacts: Contact[];
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [editingBooking, setEditingBooking] = useState(false);

  const checkInDate = new Date(`${stay.checkIn}T00:00:00.000Z`);
  const checkOutDate = new Date(`${stay.checkOut}T00:00:00.000Z`);
  const nights = nightsBetween(checkInDate, checkOutDate);
  const total = stayTotal({
    checkIn: checkInDate,
    checkOut: checkOutDate,
    headcount: stay.headcount,
    costPerPersonPerNight: stay.costPerPersonPerNight,
  });

  const dateSpan = `${formatDate(checkInDate)}–${formatDate(checkOutDate)}`;

  return (
    <div className="rounded-md border p-3 space-y-2">
      {editing && canEdit ? (
        <div className="space-y-4 rounded-md border bg-background p-3">
          <StayFields
            initial={stay}
            locations={locations}
            submitLabel="Save stay"
            onSubmit={(data, done) =>
              run(() => updateStay(stay.id, data), () => {
                done();
                setEditing(false);
              })
            }
            onCancel={() => setEditing(false)}
          />
          <StayBookingPanel
            stay={stay}
            contacts={contacts}
            onEditingChange={setEditingBooking}
          />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{stay.location.name}</span>
                <span className="text-sm text-muted-foreground">{dateSpan}</span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {stay.board && stay.board !== "NONE" ? (
                  <span>· {BOARD_LABELS[stay.board]}</span>
                ) : null}
                {stay.headcount != null ? <span>· {stay.headcount} person{stay.headcount === 1 ? "" : "s"}</span> : null}
                {stay.costPerPersonPerNight != null ? (
                  <span>
                    · {stay.currency} {stay.costPerPersonPerNight.toFixed(2)}/night
                  </span>
                ) : null}
                {nights > 0 && stay.costPerPersonPerNight != null ? (
                  <span>
                    · {nights} night{nights === 1 ? "" : "s"}: {stay.currency}{" "}
                    {total.toFixed(2)}
                  </span>
                ) : null}
              </div>

              {stay.booking ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <BookingPill booking={stay.booking} />
                </div>
              ) : null}
            </div>

            {canEdit && !editing ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Delete stay at ${stay.location.name}?`))
                      run(() => deleteStay(stay.id));
                  }}
                >
                  Delete
                </Button>
              </div>
            ) : null}
          </div>

          {canEdit && !editingBooking && !editing ? (
            <StayBookingPanel
              stay={stay}
              contacts={contacts}
              onEditingChange={setEditingBooking}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function BookingPill({ booking }: { booking: SerializedBooking }) {
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
      {booking.label ? (
        <span className="text-muted-foreground">{booking.label}</span>
      ) : null}
      {booking.bookedContact ? (
        <span className="text-muted-foreground">· {booking.bookedContact.name}</span>
      ) : null}
      {booking.confirmationRef ? (
        <span className="text-muted-foreground">· ref {booking.confirmationRef}</span>
      ) : null}
    </span>
  );
}

function StayBookingPanel({
  stay,
  contacts,
  onEditingChange,
}: {
  stay: SerializedStay;
  contacts: Contact[];
  onEditingChange?: (editing: boolean) => void;
}) {
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const booking = stay.booking;

  // Compact empty state: a single inline row instead of a bordered sub-panel,
  // so informational stays (the common case) stay tidy.
  if (!booking && !adding) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          No booking — informational lodging.
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
        >
          + Add booking
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <Label className="text-xs">Booking</Label>

      {booking && editingId !== booking.id ? (
        <div className="flex items-center justify-between gap-2 rounded border px-2 py-1.5">
          <BookingPill booking={booking} />
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingId(booking.id);
                onEditingChange?.(true);
              }}
            >
              Edit
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => run(() => deleteBooking(booking.id))}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      {booking && editingId === booking.id ? (
        <BookingFields
          contacts={contacts}
          initial={booking}
          submitLabel="Save booking"
          onSubmit={(data, done) =>
            run(() => updateBooking(booking.id, data), () => {
              done();
              setEditingId(null);
              onEditingChange?.(false);
            })
          }
          onCancel={() => {
            setEditingId(null);
            onEditingChange?.(false);
          }}
        />
      ) : null}

      {adding ? (
        <BookingFields
          contacts={contacts}
          submitLabel="Add booking"
          onSubmit={(data, done) =>
            run(() => addStayBooking(stay.id, data), () => {
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

function StayFields({
  locations,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  locations: Location[];
  initial?: SerializedStay;
  submitLabel: string;
  onSubmit: (data: StayInputData, done: () => void) => void;
  onCancel: () => void;
}) {
  const [locationId, setLocationId] = useState<string>(
    initial?.locationId ?? NONE,
  );
  const [label, setLabel] = useState(initial?.label ?? "");
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  const [arrivalTime, setArrivalTime] = useState(initial?.arrivalTime ?? "");
  const [departureTime, setDepartureTime] = useState(initial?.departureTime ?? "");
  const [board, setBoard] = useState<string>(initial?.board ?? "NONE");
  const [headcount, setHeadcount] = useState<string>(
    initial?.headcount != null ? String(initial.headcount) : "",
  );
  const [costPerPersonPerNight, setCostPerPersonPerNight] = useState<string>(
    initial?.costPerPersonPerNight != null
      ? String(initial.costPerPersonPerNight)
      : "",
  );
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [priority, setPriority] = useState<string>(
    initial?.priority != null ? String(initial.priority) : "0",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const submit = () => {
    onSubmit(
      {
        locationId,
        label: label.trim() || undefined,
        checkIn,
        checkOut,
        arrivalTime: arrivalTime || undefined,
        departureTime: departureTime || undefined,
        board: board || undefined,
        headcount: headcount || undefined,
        costPerPersonPerNight: costPerPersonPerNight || undefined,
        currency,
        priority: priority || undefined,
        notes: notes.trim() || undefined,
      },
      () => {
        if (!initial) {
          setLocationId(NONE);
          setLabel("");
          setCheckIn("");
          setCheckOut("");
          setArrivalTime("");
          setDepartureTime("");
          setBoard("NONE");
          setHeadcount("");
          setCostPerPersonPerNight("");
          setCurrency("USD");
          setPriority("0");
          setNotes("");
        }
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Location *</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— pick a location —</SelectItem>
              {locations.map((loc) => (
                <SelectItem key={loc.id} value={loc.id}>
                  {loc.name}
                  {loc.region ? ` · ${loc.region}` : ""}
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
            placeholder="e.g. Hotel, Airbnb"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Check-in *</Label>
          <Input
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Check-out *</Label>
          <Input
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Arrival time</Label>
          <Input
            type="time"
            value={arrivalTime}
            onChange={(e) => setArrivalTime(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Departure time</Label>
          <Input
            type="time"
            value={departureTime}
            onChange={(e) => setDepartureTime(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Board type</Label>
          <Select value={board} onValueChange={setBoard}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BOARD_TYPES.map((bt) => (
                <SelectItem key={bt} value={bt}>
                  {BOARD_LABELS[bt as keyof typeof BOARD_LABELS]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Headcount</Label>
          <Input
            type="number"
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
            min="0"
            placeholder="Number of people"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Cost per person per night</Label>
          <Input
            type="number"
            value={costPerPersonPerNight}
            onChange={(e) => setCostPerPersonPerNight(e.target.value)}
            min="0"
            step="0.01"
            placeholder="0.00"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Currency</Label>
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="USD"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Priority</Label>
          <Input
            type="number"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            min="0"
            placeholder="0"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Breakfast included, ask for late checkout"
        />
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

function BookingFields({
  contacts,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  contacts: Contact[];
  initial?: SerializedBooking;
  submitLabel: string;
  onSubmit: (data: BookingInputData, done: () => void) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [status, setStatus] = useState(initial?.status ?? "NOT_BOOKED");
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
        label: label.trim() || undefined,
        status,
        bookedContactId: bookedContactId === NONE ? undefined : bookedContactId,
        confirmationRef: confirmationRef.trim() || undefined,
        notes: notes.trim() || undefined,
      },
      () => {
        if (!initial) {
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
          <Label className="text-xs">Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. accommodation, reserve"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Status *</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as typeof status)}
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
            placeholder="e.g. CONF123456"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Booking notes</Label>
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Twin beds, ground floor preferred"
        />
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
