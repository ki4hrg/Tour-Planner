"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useAction } from "@/lib/use-action";
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
import { formatDate } from "@/lib/dates";
import Link from "next/link";
import type { SerializedStay } from "@/lib/trips";
import { stayHeadcount, stayNights, stayTotal } from "@/lib/stays";
import { currencyOptions } from "@/lib/money";
import type { SerializedDocument } from "@/lib/documents";
import { DocumentsPanel } from "../documents/documents-panel";
import { WorkflowControl } from "./workflow-control";
import { progressView, type BookingProgressView } from "@/lib/booking-workflow";
import {
  addStay,
  updateStay,
  deleteStay,
  type StayInputData,
} from "./actions";

const NONE = "__none__";

type Location = { id: string; name: string; region: string | null };

// Pre-fill for "+ Add stay": the first run of uncovered nights, in whichever
// anchor mode the trip uses.
export type SuggestedStaySpan = Pick<
  SerializedStay,
  "checkIn" | "checkOut" | "checkInDayIndex" | "checkOutDayIndex"
>;

export function LodgingManager({
  tripId,
  canEdit,
  isTemplate,
  dayCount,
  locations,
  stays,
  currencies,
  documentsByStay,
  progressByLocation,
  headcount,
  suggestedSpan = null,
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
  // Stay-specific paperwork (rooming lists, arrival sheets), keyed by stay id.
  // The lodging CONTRACT belongs to the venue engagement, not here — a stay has
  // no booking of its own (see the booking dashboard).
  documentsByStay: Record<string, SerializedDocument[]>;
  // Workflow state of each lodging venue's engagement (keyed by location).
  progressByLocation: Record<string, BookingProgressView>;
  // Trip headcount (participants ?? capacity): prices a stay that has no
  // headcount of its own, matching the trip cost estimate.
  headcount: number | null;
  suggestedSpan?: SuggestedStaySpan | null;
}) {
  const { pending, run } = useAction();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      {stays.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stays.</p>
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
              documents={documentsByStay[stay.id] ?? []}
              progress={progressByLocation[stay.locationId]}
              tripHeadcount={headcount}
            />
          ))}
        </div>
      )}

      {canEdit ? (
        isTemplate && dayCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            No days.{" "}
            <Link href={`/trips/${tripId}/itinerary`} className="link-quiet">
              Add days
            </Link>
          </p>
        ) : adding ? (
          <div className="rounded-md border border-dashed p-3">
            <p className="mb-2 text-sm font-medium">New stay</p>
            {locations.length === 0 ? (
              <p className="mb-2 text-xs text-muted-foreground">
                No lodging venues.
              </p>
            ) : null}
            <StayFields
              defaults={suggestedSpan ?? undefined}
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
  documents,
  progress,
  tripHeadcount,
}: {
  tripId: string;
  stay: SerializedStay;
  canEdit: boolean;
  isTemplate: boolean;
  dayCount: number;
  locations: Location[];
  currencies: string[];
  documents: SerializedDocument[];
  progress: BookingProgressView | undefined;
  tripHeadcount: number | null;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  // Day-relative (template) stay: span/nights come from the day indices; there
  // are no calendar dates. Dated stay: parse the "yyyy-mm-dd" anchors.
  const dayRelative = stay.checkInDayIndex != null;
  const checkInDate = stay.checkIn
    ? new Date(`${stay.checkIn}T00:00:00.000Z`)
    : null;
  const checkOutDate = stay.checkOut
    ? new Date(`${stay.checkOut}T00:00:00.000Z`)
    : null;
  const span = { ...stay, checkIn: checkInDate, checkOut: checkOutDate };
  const nights = stayNights(span);
  const heads = stayHeadcount(stay, tripHeadcount);
  const total = stayTotal(span, tripHeadcount);

  const dateSpan = dayRelative
    ? `Day ${stay.checkInDayIndex} → Day ${stay.checkOutDayIndex}`
    : `${formatDate(checkInDate)}–${formatDate(checkOutDate)}`;

  return (
    <div id={`stay-${stay.id}`} className="scroll-mt-20 rounded-md border p-3 space-y-2">
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
                {heads != null ? (
                  <span
                    title={stay.headcount == null ? "Trip headcount" : undefined}
                  >
                    · {heads} person{heads === 1 ? "" : "s"}
                  </span>
                ) : null}
                {stay.costPerPersonPerNight != null ? (
                  <span>
                    · {stay.currency} {stay.costPerPersonPerNight.toFixed(2)}/person/night
                  </span>
                ) : null}
                {/* No headcount anywhere → the total is unknown, not zero. */}
                {nights > 0 && stay.costPerPersonPerNight != null && heads != null ? (
                  <span>
                    · {nights} night{nights === 1 ? "" : "s"}: {stay.currency}{" "}
                    {total.toFixed(2)}
                  </span>
                ) : null}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {/* Lodging's booking state IS the venue engagement — set it
                    right here (the first status set creates the engagement).
                    A site booked via a parent acts on the parent's. */}
                <WorkflowControl
                  target={{ tripId, locationId: stay.locationId }}
                  progress={progress ?? progressView(null)}
                  canEdit={canEdit}
                />
                {stay.bookedVia ? (
                  <span className="text-xs text-muted-foreground">
                    via {stay.bookedVia.name}
                  </span>
                ) : null}
                {stay.booking?.bookedContact ? (
                  <span className="text-xs text-muted-foreground">
                    {stay.booking.bookedContact.name}
                  </span>
                ) : null}
                {stay.booking?.confirmationRef ? (
                  <span className="text-xs text-muted-foreground">
                    ref {stay.booking.confirmationRef}
                  </span>
                ) : null}
                <Link
                  href={`/trips/${tripId}/booking?venue=${stay.bookedVia?.id ?? stay.locationId}`}
                  className="text-xs text-muted-foreground link-quiet"
                >
                  Booking
                </Link>
                {canEdit || documents.length > 0 ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs font-normal text-muted-foreground link-quiet"
                    onClick={() => setShowFiles((v) => !v)}
                    aria-expanded={showFiles}
                  >
                    {documents.length > 0
                      ? `Files (${documents.length})`
                      : "Files"}
                  </Button>
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
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={pending}
                  pending={pending}
                  title={`Delete stay at ${stay.location.name}`}
                  description="Deletes its files and notes."
                  confirmLabel="Delete stay"
                  onConfirm={() => run(() => deleteStay(stay.id))}
                >
                  Delete
                </ConfirmButton>
              </div>
            ) : null}
          </div>

          {showFiles ? (
            <div className="border-t pt-2">
              <DocumentsPanel
                target="stay"
                targetId={stay.id}
                documents={documents}
                canEdit={canEdit}
                emptyLabel="No documents."
                venueName={stay.location.name}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function StayFields({
  locations,
  initial,
  defaults,
  isTemplate,
  dayCount,
  currencies,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  locations: Location[];
  initial?: SerializedStay;
  // Starting span for a new stay (ignored when editing `initial`).
  defaults?: SuggestedStaySpan;
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
  const anchors = initial ?? defaults;
  const [checkIn, setCheckIn] = useState(anchors?.checkIn ?? "");
  const [checkOut, setCheckOut] = useState(anchors?.checkOut ?? "");
  // Day-relative anchors (template mode). Stored as strings for the <Select>.
  const [checkInDay, setCheckInDay] = useState<string>(
    anchors?.checkInDayIndex != null ? String(anchors.checkInDayIndex) : "",
  );
  const [checkOutDay, setCheckOutDay] = useState<string>(
    anchors?.checkOutDayIndex != null ? String(anchors.checkOutDayIndex) : "",
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
              <SelectItem value={NONE}>Choose location…</SelectItem>
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
                  <SelectValue placeholder="Choose day…" />
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
                  <SelectValue placeholder="Choose day…" />
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
            placeholder="e.g. 24"
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
          placeholder="e.g. Breakfast included"
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
