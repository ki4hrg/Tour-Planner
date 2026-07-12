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
import Link from "next/link";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_CLASSES,
  type SerializedStay,
  type SerializedBooking,
} from "@/lib/trips";
import { nightsBetween, stayTotal } from "@/lib/stays";
import { currencyOptions } from "@/lib/money";
import {
  addStay,
  updateStay,
  deleteStay,
  type StayInputData,
} from "./actions";

const NONE = "__none__";

type Location = { id: string; name: string; region: string | null };

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
  isTemplate,
  dayCount,
  locations: initialLocations,
  stays,
  currencies,
}: {
  tripId: string;
  canEdit: boolean;
  // Templates are date-less: lodging anchors to day numbers (Day 1 → Day N)
  // instead of calendar dates. dayCount bounds the day pickers.
  isTemplate: boolean;
  dayCount: number;
  locations: Location[];
  stays: SerializedStay[];
  // The trip's currency vocabulary (GH #11) — the stay form picks from these.
  currencies: string[];
}) {
  const locations = useMemo(
    () => initialLocations.sort((a, b) => a.name.localeCompare(b.name)),
    [initialLocations],
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
              tripId={tripId}
              stay={stay}
              canEdit={canEdit}
              isTemplate={isTemplate}
              dayCount={dayCount}
              locations={locations}
              currencies={currencies}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        isTemplate && dayCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add itinerary days first — template lodging anchors to day numbers.
          </p>
        ) : adding ? (
          <div className="rounded-md border border-dashed p-3">
            <p className="mb-2 text-sm font-medium">Add a stay</p>
            <StayFields
              locations={locations}
              isTemplate={isTemplate}
              dayCount={dayCount}
              currencies={currencies}
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
  tripId,
  stay,
  canEdit,
  isTemplate,
  dayCount,
  locations,
  currencies,
}: {
  tripId: string;
  stay: SerializedStay;
  canEdit: boolean;
  isTemplate: boolean;
  dayCount: number;
  locations: Location[];
  currencies: string[];
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);

  // Day-relative (template) stay: span/nights come from the day indices; there
  // are no calendar dates. Dated stay: parse the "yyyy-mm-dd" anchors.
  const dayRelative = stay.checkInDayIndex != null;
  const checkInDate = stay.checkIn
    ? new Date(`${stay.checkIn}T00:00:00.000Z`)
    : null;
  const checkOutDate = stay.checkOut
    ? new Date(`${stay.checkOut}T00:00:00.000Z`)
    : null;
  const nights = dayRelative
    ? Math.max(0, (stay.checkOutDayIndex ?? 0) - (stay.checkInDayIndex ?? 0))
    : nightsBetween(checkInDate, checkOutDate);
  const total = dayRelative
    ? (stay.costPerPersonPerNight ?? 0) * (stay.headcount ?? 0) * nights
    : stayTotal({
        checkIn: checkInDate,
        checkOut: checkOutDate,
        headcount: stay.headcount,
        costPerPersonPerNight: stay.costPerPersonPerNight,
      });

  const dateSpan = dayRelative
    ? `Day ${stay.checkInDayIndex} → Day ${stay.checkOutDayIndex}`
    : `${formatDate(checkInDate)}–${formatDate(checkOutDate)}`;

  return (
    <div className="rounded-md border p-3 space-y-2">
      {editing && canEdit ? (
        <div className="space-y-4 rounded-md border bg-background p-3">
          <StayFields
            initial={stay}
            locations={locations}
            isTemplate={isTemplate}
            dayCount={dayCount}
            currencies={currencies}
            submitLabel="Save stay"
            onSubmit={(data, done) =>
              run(() => updateStay(stay.id, data), () => {
                done();
                setEditing(false);
              })
            }
            onCancel={() => setEditing(false)}
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

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {stay.booking ? (
                  <BookingPill booking={stay.booking} />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    No venue booking yet
                  </span>
                )}
                {canEdit ? (
                  <Link
                    href={`/trips/${tripId}/booking`}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Manage in booking dashboard →
                  </Link>
                ) : null}
              </div>
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

function StayFields({
  locations,
  initial,
  isTemplate,
  dayCount,
  currencies,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  locations: Location[];
  initial?: SerializedStay;
  isTemplate: boolean;
  dayCount: number;
  currencies: string[];
  submitLabel: string;
  onSubmit: (data: StayInputData, done: () => void) => void;
  onCancel: () => void;
}) {
  const [locationId, setLocationId] = useState<string>(
    initial?.locationId ?? NONE,
  );
  const [checkIn, setCheckIn] = useState(initial?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(initial?.checkOut ?? "");
  // Day-relative anchors (template mode). Stored as strings for the <Select>.
  const [checkInDay, setCheckInDay] = useState<string>(
    initial?.checkInDayIndex != null ? String(initial.checkInDayIndex) : "",
  );
  const [checkOutDay, setCheckOutDay] = useState<string>(
    initial?.checkOutDayIndex != null ? String(initial.checkOutDayIndex) : "",
  );
  const [arrivalTime, setArrivalTime] = useState(initial?.arrivalTime ?? "");
  const [departureTime, setDepartureTime] = useState(initial?.departureTime ?? "");
  const [headcount, setHeadcount] = useState<string>(
    initial?.headcount != null ? String(initial.headcount) : "",
  );
  const [costPerPersonPerNight, setCostPerPersonPerNight] = useState<string>(
    initial?.costPerPersonPerNight != null
      ? String(initial.costPerPersonPerNight)
      : "",
  );
  // Offer the trip's currency set (plus the stored value on legacy stays);
  // default new stays to the trip's first currency.
  const currencyChoices = currencyOptions(currencies, initial?.currency);
  const [currency, setCurrency] = useState(
    initial?.currency ?? currencyChoices[0],
  );
  const [priority, setPriority] = useState<string>(
    initial?.priority != null ? String(initial.priority) : "0",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const submit = () => {
    onSubmit(
      {
        locationId,
        // Send exactly one anchor mode — the server rejects a mismatch with the
        // trip's template flag.
        checkIn: isTemplate ? undefined : checkIn,
        checkOut: isTemplate ? undefined : checkOut,
        checkInDayIndex: isTemplate ? checkInDay || undefined : undefined,
        checkOutDayIndex: isTemplate ? checkOutDay || undefined : undefined,
        arrivalTime: arrivalTime || undefined,
        departureTime: departureTime || undefined,
        headcount: headcount || undefined,
        costPerPersonPerNight: costPerPersonPerNight || undefined,
        currency,
        priority: priority || undefined,
        notes: notes.trim() || undefined,
      },
      () => {
        if (!initial) {
          setLocationId(NONE);
          setCheckIn("");
          setCheckOut("");
          setCheckInDay("");
          setCheckOutDay("");
          setArrivalTime("");
          setDepartureTime("");
          setHeadcount("");
          setCostPerPersonPerNight("");
          setCurrency(currencyChoices[0]);
          setPriority("0");
          setNotes("");
        }
      },
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs">Location *</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger size="sm" className="w-full">
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

        {isTemplate ? (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs">Check-in day *</Label>
              <Select value={checkInDay} onValueChange={setCheckInDay}>
                <SelectTrigger size="sm">
                  <SelectValue placeholder="— pick a day —" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: dayCount }, (_, i) => i + 1).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      Day {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Check-out day *</Label>
              <Select value={checkOutDay} onValueChange={setCheckOutDay}>
                <SelectTrigger size="sm">
                  <SelectValue placeholder="— pick a day —" />
                </SelectTrigger>
                <SelectContent>
                  {/* Check-out is the departure morning: Day 2..N, plus Day N+1
                      to cover the last night (mirrors an absolute endDate+1). */}
                  {Array.from({ length: dayCount }, (_, i) => i + 2).map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n > dayCount ? `Day ${n} (after trip)` : `Day ${n}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}

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
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {currencyChoices.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
