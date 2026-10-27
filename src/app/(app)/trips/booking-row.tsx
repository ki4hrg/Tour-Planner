"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronRight } from "lucide-react";
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
import { TableCell, TableRow } from "@/components/ui/table";
import { ContactChannels } from "@/components/contact-channels";
import { cn } from "@/lib/utils";
import type { SerializedDocument } from "@/lib/documents";
import { DocumentsPanel } from "../documents/documents-panel";
import { formatDate } from "@/lib/dates";
import { formatMoney, isCostStale, COST_UNIT_LABELS, currencyOptions } from "@/lib/money";
import { agreedTotal } from "@/lib/costs";
import { isBookingSecured } from "@/lib/booking";
import type { FormState } from "@/lib/forms";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import {
  describeCadence,
  type ResolvedInstallment,
  type PaymentAnchor,
  type PaymentOffsetUnit,
} from "@/lib/payment-schedule";
import {
  upsertVenueBooking,
  addPayment,
  deletePayment,
  setPaymentSchedule,
} from "./actions";
import { WorkflowControl } from "./workflow-control";
import { WaitingNote } from "./waiting-note";

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
export function WindowCell({ row }: { row: VenueBookingRow }) {
  if (!row.bookable || row.status === "NOT_NEEDED")
    return <span className="text-muted-foreground">—</span>;
  if (isBookingSecured(row.status))
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

export function PriceCell({ row }: { row: VenueBookingRow }) {
  if (!row.bookable)
    return <span className="text-muted-foreground">—</span>;
  // The negotiated engagement price beats the catalog's asking price.
  if (row.agreedAmount != null) {
    return (
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <AgreedPrice
            amount={row.agreedAmount}
            currency={row.agreedCurrency}
            perPerson={row.agreedUnit === "PER_PERSON"}
            headcount={row.headcount}
          />
          <span className="rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            agreed
          </span>
        </div>
        <PaymentState row={row} />
      </div>
    );
  }
  if (row.costs.length === 0)
    return (
      <div className="space-y-0.5">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          No price
        </span>
        {/* Fixed-amount installments can be overdue without an agreed price. */}
        <PaymentState row={row} />
      </div>
    );
  // No agreed price yet: fall back to the venue's list prices (its Cost
  // catalog, edited on the Location page), each named, and tagged "list" so
  // they read as reference prices, not this trip's deal.
  return (
    <div className="space-y-0.5">
      {row.costs.map((c, i) => (
        <div key={c.id} className="flex flex-wrap items-center gap-x-1.5">
          <span className="text-muted-foreground">{c.label}</span>
          <span>
            {formatMoney(c.amount, c.currency)}
            <span className="text-muted-foreground"> {COST_UNIT_LABELS[c.unit]}</span>
          </span>
          {i === 0 ? (
            <span
              className="rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground"
              title="Venue list price"
            >
              list
            </span>
          ) : null}
          {isCostStale(c.confirmedAt) ? (
            <span
              className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
              title="Unconfirmed for 1+ year"
            >
              stale
            </span>
          ) : null}
        </div>
      ))}
      <PaymentState row={row} />
    </div>
  );
}

// The agreed price as entered, with the total it implies: a total reads as
// itself; a per-person rate as "£15 × 40 = £600" against the trip headcount, or
// "£15/person" + a "no headcount" chip when there's none to multiply (the total
// — and so the balance — is then unknown).
function AgreedPrice({
  amount,
  currency,
  perPerson,
  headcount,
}: {
  amount: number;
  currency: string;
  perPerson: boolean;
  headcount: number | null;
}) {
  if (!perPerson) return <span>{formatMoney(amount, currency)}</span>;
  const total = agreedTotal(
    { agreedAmount: amount, agreedUnit: "PER_PERSON" },
    headcount,
  );
  if (total == null)
    return (
      <>
        <span>
          {formatMoney(amount, currency)}
          <span className="text-muted-foreground">/person</span>
        </span>
        <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          no headcount
        </span>
      </>
    );
  return (
    <span>
      {formatMoney(amount, currency)}
      <span className="text-muted-foreground"> × {headcount} = </span>
      {formatMoney(total, currency)}
    </span>
  );
}

// Settled / unpaid chip under an agreed price, sharpened by the payment
// schedule when one exists: overdue beats everything, then the next due date.
function PaymentState({ row }: { row: VenueBookingRow }) {
  if (row.overdueAmount > 0)
    return (
      <span className="text-xs font-medium text-red-600 dark:text-red-400">
        {formatMoney(row.overdueAmount, row.agreedCurrency)} overdue
      </span>
    );
  // No agreed price, or a per-person rate with no headcount: no known total.
  if (row.agreedTotal == null) return null;
  if (row.settled)
    return (
      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
        Paid in full
      </span>
    );
  if (row.nextDue?.amountDue != null && row.nextDue.dueDate)
    return (
      <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
        {formatMoney(row.nextDue.amountDue - row.nextDue.covered, row.agreedCurrency)}{" "}
        due {formatDate(row.nextDue.dueDate)}
      </span>
    );
  if (row.paidTotal > 0)
    return (
      <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
        {formatMoney(row.unpaidBalance ?? 0, row.agreedCurrency)} unpaid
      </span>
    );
  return <span className="text-xs text-muted-foreground">Unpaid</span>;
}

export function coverageLine(row: VenueBookingRow): string {
  const planned = row.sessions.filter((s) => s.planned).length;
  const timed = row.sessions.length - planned;
  return [
    timed ? `${timed} session${timed === 1 ? "" : "s"}` : null,
    planned ? `${planned} planned` : null,
    row.nightCount
      ? `${row.nightCount} night${row.nightCount === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// The expanded engagement panel — covered sessions plus (for planners) the
// label/contact/ref/notes editor. Owns its own form state so the desktop table
// row and the mobile card can each mount an instance.
export function VenueDetails({
  row,
  tripId,
  canEdit,
  contacts,
  currencies,
  documents,
}: {
  row: VenueBookingRow;
  tripId: string;
  canEdit: boolean;
  contacts: ContactOption[];
  currencies: string[];
  documents: SerializedDocument[];
}) {
  const { pending, run } = useAction();

  const [label, setLabel] = useState(row.label ?? "");
  const [contactId, setContactId] = useState(row.bookedContactId ?? NONE);
  const [confirmationRef, setConfirmationRef] = useState(row.confirmationRef ?? "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const [agreedAmount, setAgreedAmount] = useState(
    row.agreedAmount != null ? String(row.agreedAmount) : "",
  );
  const [agreedCurrency, setAgreedCurrency] = useState(row.agreedCurrency);
  // Total (stored null) or per person (× trip headcount). Legacy PER_GROUP
  // already means the total, so it opens as — and saves back as — total.
  const [agreedUnit, setAgreedUnit] = useState<string>(
    row.agreedUnit === "PER_PERSON" ? "PER_PERSON" : NONE,
  );
  const agreedRate = Number(agreedAmount);
  const showAgreedTotal =
    agreedUnit === "PER_PERSON" &&
    agreedAmount.trim() !== "" &&
    Number.isFinite(agreedRate);
  const [bookedOn, setBookedOn] = useState(row.bookedOn ?? "");
  // The trip's currency vocabulary (GH #11), plus the stored value on legacy rows.
  const currencyChoices = currencyOptions(currencies, row.agreedCurrency);

  // Keep the row expanded after saving so you can keep editing / see it stuck.
  const save = () =>
    run(() =>
      upsertVenueBooking(tripId, row.locationId, {
        // Only used if this save CREATES the engagement; on update the server
        // ignores status (the quick status control owns it), so a stale
        // render-time value here can't clobber a just-made status change.
        status: row.status,
        label: label.trim() || undefined,
        bookedContactId: contactId === NONE ? undefined : contactId,
        confirmationRef: confirmationRef.trim() || undefined,
        notes: notes.trim() || undefined,
        bookedOn: bookedOn || undefined,
        agreedAmount: agreedAmount.trim() || undefined,
        agreedCurrency,
        agreedUnit: agreedUnit === NONE ? undefined : agreedUnit,
      }),
    );

  return (
    <div className="grid grid-cols-1 gap-4 py-1 md:grid-cols-2">
      {/* Covered sessions — so a multi-timeslot booking stays visible. */}
      <div className="min-w-0">
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
                  {s.dayId ? (
                    <Link
                      href={`/trips/${tripId}/days/${s.dayId}${
                        s.planned ? "" : `#item-${s.id}`
                      }`}
                      className="underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                    >
                      {s.label}
                    </Link>
                  ) : (
                    s.label
                  )}
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
            <Label className="text-xs">Booked on</Label>
            <Input
              type="date"
              value={bookedOn}
              onChange={(e) => setBookedOn(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Agreed price</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={agreedAmount}
                onChange={(e) => setAgreedAmount(e.target.value)}
                placeholder="e.g. 450"
                className="w-28"
              />
              <Select value={agreedCurrency} onValueChange={setAgreedCurrency}>
                <SelectTrigger size="sm" className="w-24">
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
              <Select value={agreedUnit} onValueChange={setAgreedUnit}>
                <SelectTrigger size="sm" className="flex-1" aria-label="Price basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>total</SelectItem>
                  <SelectItem value="PER_PERSON">per person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {showAgreedTotal ? (
              <p className="flex flex-wrap items-center gap-1.5 text-xs">
                <AgreedPrice
                  amount={agreedRate}
                  currency={agreedCurrency}
                  perPerson
                  headcount={row.headcount}
                />
              </p>
            ) : null}
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

      {/* Payment schedule + log — span the grid; need the engagement to exist. */}
      {row.bookingId && (row.schedule.length > 0 || canEdit) ? (
        <div className="md:col-span-2">
          <PaymentSchedule row={row} canEdit={canEdit} />
        </div>
      ) : null}
      {row.bookingId && (row.payments.length > 0 || canEdit) ? (
        <div className="md:col-span-2">
          <PaymentLog row={row} canEdit={canEdit} currencies={currencies} />
        </div>
      ) : null}

      {/* Paperwork for the engagement — the contract, the invoice, the signed
          confirmation. Needs the engagement to exist to attach to. */}
      {row.bookingId && (documents.length > 0 || canEdit) ? (
        <div className="md:col-span-2">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Documents
          </p>
          <DocumentsPanel
            target="booking"
            targetId={row.bookingId}
            documents={documents}
            canEdit={canEdit}
            emptyLabel="No documents."
            venueName={row.locationName}
          />
        </div>
      ) : null}
    </div>
  );
}

const INSTALLMENT_STATE_STYLES: Record<ResolvedInstallment["state"], string> = {
  paid: "text-emerald-700 dark:text-emerald-300",
  overdue: "font-medium text-red-600 dark:text-red-400",
  upcoming: "text-muted-foreground",
  unscheduled: "text-amber-700 dark:text-amber-300",
};

// The right-hand state chip text for one resolved installment.
function installmentStateText(i: ResolvedInstallment): string {
  if (i.state === "unscheduled") return "needs price / date";
  if (i.state === "paid") return "paid";
  if (i.state === "overdue")
    return `overdue${i.dueDate ? ` ${formatDate(i.dueDate)}` : ""}`;
  // upcoming — a NONE installment has no date, so it's just owed.
  return i.dueDate ? `due ${formatDate(i.dueDate)}` : "outstanding";
}

// One editable installment row's local form state.
type InstallmentDraft = {
  key: number;
  label: string;
  mode: "percent" | "fixed";
  value: string;
  anchor: PaymentAnchor;
  offset: string;
  unit: PaymentOffsetUnit;
};

function draftsFromRow(schedule: ResolvedInstallment[]): InstallmentDraft[] {
  return schedule.map((i, idx) => ({
    key: idx,
    label: i.label ?? "",
    mode: i.percent != null ? "percent" : "fixed",
    value: String(i.percent ?? i.fixedAmount ?? ""),
    anchor: i.anchor,
    offset: i.offsetValue == null ? "" : String(i.offsetValue),
    unit: i.offsetUnit ?? "DAY",
  }));
}

// The engagement's payment schedule: installments due relative to trip start
// ("20% deposit 180 days out"). Read view shows resolved amounts/dates/state;
// planners edit the whole set and save it in one replace (GH #51).
function PaymentSchedule({
  row,
  canEdit,
}: {
  row: VenueBookingRow;
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<InstallmentDraft[]>([]);

  const startEditing = () => {
    setDrafts(
      row.schedule.length
        ? draftsFromRow(row.schedule)
        : [
            {
              key: 0,
              label: "Deposit",
              mode: "percent",
              value: "",
              anchor: "EVENT_START",
              offset: "180",
              unit: "DAY",
            },
          ],
    );
    setEditing(true);
  };

  const patch = (key: number, part: Partial<InstallmentDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...part } : d)));

  const save = () =>
    run(
      () =>
        setPaymentSchedule(row.bookingId!, {
          installments: drafts.map((d) => ({
            label: d.label.trim() || undefined,
            percent: d.mode === "percent" ? d.value : undefined,
            fixedAmount: d.mode === "fixed" ? d.value : undefined,
            anchor: d.anchor,
            offsetValue: d.anchor === "NONE" ? undefined : d.offset,
            offsetUnit: d.anchor === "NONE" ? undefined : d.unit,
          })),
        }),
      () => setEditing(false),
    );

  return (
    <div className="space-y-2 border-t pt-2">
      <p className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
        Payment schedule
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="font-normal underline-offset-2 hover:underline"
          >
            {row.schedule.length ? "Edit" : "Add"}
          </button>
        ) : null}
      </p>

      {!editing ? (
        row.schedule.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No schedule.
          </p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {row.schedule.map((i, idx) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-2">
                <span>{i.label || `Installment ${idx + 1}`}</span>
                <span className="text-xs text-muted-foreground">
                  {i.percent != null
                    ? `${i.percent}%${i.amountDue != null ? ` · ${formatMoney(i.amountDue, row.agreedCurrency)}` : ""}`
                    : formatMoney(i.fixedAmount ?? 0, row.agreedCurrency)}
                  {" · "}
                  {describeCadence(i)}
                </span>
                <span className={cn("text-xs", INSTALLMENT_STATE_STYLES[i.state])}>
                  {installmentStateText(i)}
                  {i.state !== "paid" && i.covered > 0
                    ? ` · ${formatMoney(i.covered, row.agreedCurrency)} covered`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-2">
          {drafts.map((d, idx) => (
            <div key={d.key} className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={d.label}
                  onChange={(e) => patch(d.key, { label: e.target.value })}
                  placeholder={`Installment ${idx + 1}`}
                  className="w-32"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={d.value}
                  onChange={(e) => patch(d.key, { value: e.target.value })}
                  className="w-24"
                />
              </div>
              <Select
                value={d.mode}
                onValueChange={(mode) =>
                  patch(d.key, { mode: mode as InstallmentDraft["mode"] })
                }
              >
                <SelectTrigger size="sm" className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">% of agreed</SelectItem>
                  <SelectItem value="fixed">fixed amount</SelectItem>
                </SelectContent>
              </Select>
              {/* Offset value + unit — hidden for a no-deadline (NONE) installment. */}
              {d.anchor !== "NONE" ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Offset</Label>
                    <Input
                      type="number"
                      step="1"
                      inputMode="numeric"
                      value={d.offset}
                      onChange={(e) => patch(d.key, { offset: e.target.value })}
                      className="w-20"
                    />
                  </div>
                  <Select
                    value={d.unit}
                    onValueChange={(unit) =>
                      patch(d.key, { unit: unit as PaymentOffsetUnit })
                    }
                  >
                    <SelectTrigger size="sm" className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DAY">days</SelectItem>
                      <SelectItem value="WEEK">weeks</SelectItem>
                      <SelectItem value="MONTH">months</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              ) : null}
              <Select
                value={d.anchor}
                onValueChange={(anchor) =>
                  patch(d.key, { anchor: anchor as PaymentAnchor })
                }
              >
                <SelectTrigger size="sm" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EVENT_START">before trip start</SelectItem>
                  <SelectItem value="BOOKING">after booking</SelectItem>
                  <SelectItem value="NONE">no deadline</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  setDrafts((prev) => prev.filter((x) => x.key !== d.key))
                }
                className="pb-2 text-xs text-destructive underline-offset-2 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                setDrafts((prev) => [
                  ...prev,
                  {
                    key: (prev[prev.length - 1]?.key ?? -1) + 1,
                    label: "",
                    mode: "percent",
                    value: "",
                    anchor: "EVENT_START",
                    offset: "30",
                    unit: "DAY",
                  },
                ])
              }
            >
              Add installment
            </Button>
            <Button
              size="sm"
              disabled={
                pending ||
                drafts.some(
                  (d) => !d.value || (d.anchor !== "NONE" && d.offset === ""),
                )
              }
              onClick={save}
            >
              Save schedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// The engagement's payment log: what's been paid against the agreed price,
// plus an add-payment row for planners.
function PaymentLog({
  row,
  canEdit,
  currencies,
}: {
  row: VenueBookingRow;
  canEdit: boolean;
  currencies: string[];
}) {
  const currencyChoices = currencyOptions(currencies, row.agreedCurrency);
  const { pending, run } = useAction();

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(row.agreedCurrency);
  const [paidOn, setPaidOn] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");

  const add = () =>
    run(
      () =>
        addPayment(row.bookingId!, {
          amount,
          currency,
          paidOn,
          method: method.trim() || undefined,
          note: note.trim() || undefined,
        }),
      () => {
        setAmount("");
        setPaidOn("");
        setMethod("");
        setNote("");
      },
    );

  return (
    <div className="space-y-2 border-t pt-2">
      <p className="text-xs font-medium text-muted-foreground">
        Payments
        {row.agreedTotal != null ? (
          <span className="ml-2 font-normal">
            {formatMoney(row.paidTotal, row.agreedCurrency)} of{" "}
            {formatMoney(row.agreedTotal, row.agreedCurrency)} paid
          </span>
        ) : null}
      </p>
      {row.payments.length > 0 ? (
        <ul className="space-y-0.5 text-sm">
          {row.payments.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDate(p.paidOn)}
              </span>
              <span>{formatMoney(p.amount, p.currency)}</span>
              {p.method ? (
                <span className="text-xs text-muted-foreground">{p.method}</span>
              ) : null}
              {p.note ? (
                <span className="truncate text-xs text-muted-foreground">
                  · {p.note}
                </span>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => deletePayment(p.id))}
                  className="ml-auto text-xs text-destructive underline-offset-2 hover:underline"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No payments logged.</p>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Amount</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger size="sm" className="w-24">
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
          <div className="space-y-1">
            <Label className="text-xs">Paid on</Label>
            <Input
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Method</Label>
            <Input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. bank transfer"
              className="w-36"
            />
          </div>
          <div className="min-w-32 flex-1 space-y-1">
            <Label className="text-xs">Note</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={pending || !amount || !paidOn}
            onClick={add}
          >
            Log payment
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function VenueRow({
  row,
  tripId,
  canEdit,
  contacts,
  currencies,
  documents,
  defaultOpen = false,
}: {
  row: VenueBookingRow;
  tripId: string;
  canEdit: boolean;
  contacts: ContactOption[];
  currencies: string[];
  documents: SerializedDocument[];
  // Deep-linked (`?venue=`) rows start expanded.
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const coverage = coverageLine(row);

  return (
    <>
      <TableRow
        id={`venue-${row.locationId}`}
        className={cn(
          "scroll-mt-20",
          row.needsInfo && "bg-amber-50 dark:bg-amber-950/40",
          !row.bookable && "text-muted-foreground",
          defaultOpen && "ring-2 ring-primary/40 ring-inset",
        )}
      >
        {/* Long venue names wrap rather than pushing the other columns off. */}
        <TableCell className="min-w-48 whitespace-normal [overflow-wrap:anywhere]">
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
                  {row.isMissingTime ? " · missing times" : ""}
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
          <span className="flex items-center gap-1.5">
            {row.contactName ?? "—"}
            <ContactChannels phone={row.contactPhone} email={row.contactEmail} />
          </span>
          {row.confirmationRef ? (
            <span className="block text-xs">ref {row.confirmationRef}</span>
          ) : null}
        </TableCell>
        <TableCell>
          {row.bookable ? (
            <>
              <WorkflowControl
                target={{ tripId, locationId: row.locationId }}
                progress={row.progress}
                canEdit={canEdit}
                showAge={!row.waiting}
              />
              <WaitingNote waiting={row.waiting} className="mt-1 block" />
            </>
          ) : (
            <span className="text-xs italic text-muted-foreground">
              No booking needed
            </span>
          )}
        </TableCell>
      </TableRow>

      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={5} className="bg-muted/30">
            <VenueDetails
              row={row}
              tripId={tripId}
              canEdit={canEdit}
              contacts={contacts}
              currencies={currencies}
              documents={documents}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

// The <sm stacked-card rendering of a venue engagement — same data and actions
// as VenueRow, laid out for a phone (the table doesn't stack).
export function VenueCard({
  row,
  tripId,
  canEdit,
  contacts,
  currencies,
  documents,
  defaultOpen = false,
}: {
  row: VenueBookingRow;
  tripId: string;
  canEdit: boolean;
  contacts: ContactOption[];
  currencies: string[];
  documents: SerializedDocument[];
  // Deep-linked (`?venue=`) rows start expanded.
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const coverage = coverageLine(row);

  return (
    <div
      id={`venue-card-${row.locationId}`}
      className={cn(
        "scroll-mt-20 rounded-lg border p-3",
        row.needsInfo && "bg-amber-50 dark:bg-amber-950/40",
        defaultOpen && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 items-start gap-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="font-medium">{row.locationName}</span>
            {coverage ? (
              <span className="block text-xs text-muted-foreground">
                {coverage}
                {row.isMissingTime ? " · missing times" : ""}
              </span>
            ) : null}
          </span>
        </button>
        <span className="shrink-0 text-right">
          {row.bookable ? (
            <>
              <WorkflowControl
                target={{ tripId, locationId: row.locationId }}
                progress={row.progress}
                canEdit={canEdit}
                showAge={!row.waiting}
              />
              <WaitingNote waiting={row.waiting} className="mt-1 block" />
            </>
          ) : (
            <span className="text-xs italic text-muted-foreground">
              No booking needed
            </span>
          )}
        </span>
      </div>

      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex items-baseline gap-2">
          <dt className="w-16 shrink-0 text-xs text-muted-foreground">Window</dt>
          <dd>
            <WindowCell row={row} />
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="w-16 shrink-0 text-xs text-muted-foreground">Price</dt>
          <dd>
            <PriceCell row={row} />
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-16 shrink-0 text-xs text-muted-foreground">POC</dt>
          <dd className="flex items-center gap-1.5 text-muted-foreground">
            {row.contactName ?? "—"}
            <ContactChannels phone={row.contactPhone} email={row.contactEmail} />
            {row.confirmationRef ? (
              <span className="text-xs">· ref {row.confirmationRef}</span>
            ) : null}
          </dd>
        </div>
      </dl>

      {open ? (
        <div className="mt-2 border-t pt-2">
          <VenueDetails
            row={row}
            tripId={tripId}
            canEdit={canEdit}
            contacts={contacts}
            currencies={currencies}
            documents={documents}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ItemRow({
  row,
  canEdit,
  documents,
}: {
  row: ItemBookingRow;
  canEdit: boolean;
  documents: SerializedDocument[];
}) {
  // A one-off booking has no editor of its own, but it does collect paperwork
  // (a coach hire has a contract like any venue), so it expands for that alone.
  const [open, setOpen] = useState(false);

  return (
    <>
    <TableRow>
      <TableCell className="min-w-48 whitespace-normal [overflow-wrap:anywhere]">
        <button
          type="button"
          className="text-left font-medium hover:underline"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {row.label}
        </button>
        <span className="block text-xs text-muted-foreground">
          Day {row.dayIndex}
          {row.date ? ` · ${formatDate(row.date)}` : ""} · one-off
          {documents.length > 0 ? ` · ${documents.length} file${documents.length === 1 ? "" : "s"}` : ""}
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
        <WorkflowControl
          target={{ bookingId: row.bookingId }}
          progress={row.progress}
          canEdit={canEdit}
          showAge={!row.waiting}
        />
        <WaitingNote waiting={row.waiting} className="mt-1 block" />
      </TableCell>
    </TableRow>
    {open ? (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={5} className="bg-muted/30">
          <DocumentsPanel
            target="booking"
            targetId={row.bookingId}
            documents={documents}
            canEdit={canEdit}
            emptyLabel="No documents."
            venueName={null}
          />
        </TableCell>
      </TableRow>
    ) : null}
    </>
  );
}

// The <sm stacked-card rendering of a one-off (site-less) item booking.
export function ItemCard({
  row,
  canEdit,
  documents,
}: {
  row: ItemBookingRow;
  canEdit: boolean;
  documents: SerializedDocument[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <button
            type="button"
            className="text-left font-medium hover:underline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {row.label}
          </button>
          <span className="block text-xs text-muted-foreground">
            Day {row.dayIndex}
            {row.date ? ` · ${formatDate(row.date)}` : ""} · one-off
            {row.contactName ? ` · ${row.contactName}` : ""}
            {row.confirmationRef ? ` · ref ${row.confirmationRef}` : ""}
            {documents.length > 0
              ? ` · ${documents.length} file${documents.length === 1 ? "" : "s"}`
              : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <WorkflowControl
            target={{ bookingId: row.bookingId }}
            progress={row.progress}
            canEdit={canEdit}
            showAge={!row.waiting}
          />
          <WaitingNote waiting={row.waiting} className="mt-1 block" />
        </span>
      </div>

      {open ? (
        <div className="mt-2 border-t pt-2">
          <DocumentsPanel
            target="booking"
            targetId={row.bookingId}
            documents={documents}
            canEdit={canEdit}
            emptyLabel="No documents."
            venueName={null}
          />
        </div>
      ) : null}
    </div>
  );
}
