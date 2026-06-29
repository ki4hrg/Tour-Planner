"use client";

import { useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
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
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { formatMoney, isCostStale, COST_UNIT_LABELS } from "@/lib/money";
import type { FormState } from "@/lib/forms";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import {
  setVenueBookingStatus,
  setBookingStatus,
  upsertVenueBooking,
} from "./actions";
import { StatusControl } from "./status-control";

const NONE = "__none__";
type ContactOption = { id: string; name: string };

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

// The window cell: when can this be booked (or is it already done).
function WindowCell({ row }: { row: VenueBookingRow }) {
  if (row.status === "CONFIRMED")
    return <span className="text-muted-foreground">Booked</span>;
  if (row.earliest == null)
    return <span className="text-muted-foreground">—</span>;
  if (row.open)
    return (
      <span className="font-medium text-amber-700 dark:text-amber-300">
        Open now
      </span>
    );
  return (
    <span className="text-muted-foreground">
      Opens {formatDate(row.earliest)}
      {row.daysUntilOpen != null ? ` (${row.daysUntilOpen}d)` : ""}
    </span>
  );
}

function PriceCell({ row }: { row: VenueBookingRow }) {
  if (row.costs.length === 0)
    return (
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
        No price
      </span>
    );
  return (
    <div className="space-y-0.5">
      {row.costs.map((c) => (
        <div key={c.id} className="flex items-center gap-1.5">
          <span>
            {formatMoney(c.amount, c.currency)}
            <span className="text-muted-foreground"> {COST_UNIT_LABELS[c.unit]}</span>
          </span>
          {isCostStale(c.confirmedAt) ? (
            <span
              className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              title="Price not confirmed in over a year"
            >
              stale
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function VenueRow({
  row,
  tripId,
  canEdit,
  contacts,
}: {
  row: VenueBookingRow;
  tripId: string;
  canEdit: boolean;
  contacts: ContactOption[];
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();

  const [label, setLabel] = useState(row.label ?? "");
  const [contactId, setContactId] = useState(row.bookedContactId ?? NONE);
  const [confirmationRef, setConfirmationRef] = useState(row.confirmationRef ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");

  const coverage = [
    row.sessions.length
      ? `${row.sessions.length} session${row.sessions.length === 1 ? "" : "s"}`
      : null,
    row.nightCount
      ? `${row.nightCount} night${row.nightCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Keep the row expanded after saving so you can keep editing / see it stuck.
  const save = () =>
    run(() =>
      upsertVenueBooking(tripId, row.locationId, {
        status: row.status,
        label: label.trim() || undefined,
        bookedContactId: contactId === NONE ? undefined : contactId,
        confirmationRef: confirmationRef.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    );

  return (
    <>
      <TableRow className={cn(row.needsInfo && "bg-amber-50 dark:bg-amber-950/40")}>
        <TableCell>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex items-start gap-1.5 text-left"
          >
            <ChevronRight
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
            <span>
              <span className="font-medium">{row.locationName}</span>
              {coverage ? (
                <span className="block text-xs text-muted-foreground">
                  {coverage}
                  {row.isMissingTime ? " · some sessions missing a time" : ""}
                </span>
              ) : null}
            </span>
          </button>
        </TableCell>
        <TableCell className="text-sm">
          <WindowCell row={row} />
        </TableCell>
        <TableCell className="text-sm">
          <PriceCell row={row} />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {row.contactName ?? "—"}
          {row.confirmationRef ? (
            <span className="block text-xs">ref {row.confirmationRef}</span>
          ) : null}
        </TableCell>
        <TableCell>
          <StatusControl
            status={row.status}
            canEdit={canEdit}
            onSet={(status) => setVenueBookingStatus(tripId, row.locationId, status)}
          />
        </TableCell>
      </TableRow>

      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="grid gap-4 py-1 md:grid-cols-2">
              {/* Covered sessions — so a multi-timeslot booking stays visible. */}
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Covered sessions
                </p>
                {row.sessions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {row.nightCount ? "Lodging only." : "No sessions."}
                  </p>
                ) : (
                  <ul className="space-y-0.5 text-sm">
                    {row.sessions.map((s) => (
                      <li key={s.id} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          D{s.dayIndex}
                        </span>
                        <span className="min-w-0">
                          {s.label}
                          <span className="text-muted-foreground">
                            {s.startTime || s.endTime
                              ? ` · ${[s.startTime, s.endTime].filter(Boolean).join("–")}`
                              : " · no time set"}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Manage the engagement (other than status, which is one-click above). */}
              {canEdit ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="e.g. hall hire"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Confirmation ref</Label>
                      <Input
                        value={confirmationRef}
                        onChange={(e) => setConfirmationRef(e.target.value)}
                        placeholder="e.g. CONF123"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Point of contact</Label>
                    <Select value={contactId} onValueChange={setContactId}>
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
                  <div className="space-y-1">
                    <Label className="text-xs">Notes</Label>
                    <Textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Conversation notes, requirements…"
                    />
                  </div>
                  <Button size="sm" disabled={pending} onClick={save}>
                    Save booking
                  </Button>
                </div>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function ItemRow({
  row,
  canEdit,
}: {
  row: ItemBookingRow;
  canEdit: boolean;
}) {
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{row.label}</span>
        <span className="block text-xs text-muted-foreground">
          Day {row.dayIndex}
          {row.date ? ` · ${formatDate(row.date)}` : ""} · one-off
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">—</TableCell>
      <TableCell className="text-sm text-muted-foreground">—</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {row.contactName ?? "—"}
        {row.confirmationRef ? (
          <span className="block text-xs">ref {row.confirmationRef}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <StatusControl
          status={row.status}
          canEdit={canEdit}
          onSet={(status: BookingStatus) => setBookingStatus(row.bookingId, status)}
        />
      </TableCell>
    </TableRow>
  );
}
