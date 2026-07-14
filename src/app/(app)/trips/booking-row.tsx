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
import { ContactChannels } from "@/components/contact-channels";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { formatMoney, isCostStale, COST_UNIT_LABELS, currencyOptions } from "@/lib/money";
import { isBookingSecured } from "@/lib/booking";
import type { FormState } from "@/lib/forms";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import type { ResolvedInstallment } from "@/lib/payment-schedule";
import {
  setVenueBookingStatus,
  setBookingStatus,
  upsertVenueBooking,
  addPayment,
  deletePayment,
  setPaymentSchedule,
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

function PriceCell({ row }: { row: VenueBookingRow }) {
  if (!row.bookable)
    return <span className="text-muted-foreground">—</span>;
  // The negotiated engagement price beats the catalog's asking price.
  if (row.agreedAmount != null) {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span>
            {formatMoney(row.agreedAmount, row.agreedCurrency)}
            {row.agreedUnit ? (
              <span className="text-muted-foreground">
                {" "}
                {COST_UNIT_LABELS[row.agreedUnit]}
              </span>
            ) : null}
          </span>
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
      <PaymentState row={row} />
    </div>
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
  if (row.agreedAmount == null) return null;
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
  return <span className="text-xs text-muted-foreground">Nothing paid yet</span>;
}

function coverageLine(row: VenueBookingRow): string {
  return [
    row.sessions.length
      ? `${row.sessions.length} session${row.sessions.length === 1 ? "" : "s"}`
      : null,
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
function VenueDetails({
  row,
  tripId,
  canEdit,
  contacts,
  currencies,
}: {
  row: VenueBookingRow;
  tripId: string;
  canEdit: boolean;
  contacts: ContactOption[];
  currencies: string[];
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
  const [agreedUnit, setAgreedUnit] = useState<string>(row.agreedUnit ?? NONE);
  // The trip's currency vocabulary (GH #11), plus the stored value on legacy rows.
  const currencyChoices = currencyOptions(currencies, row.agreedCurrency);

  // Keep the row expanded after saving so you can keep editing / see it stuck.
  const save = () =>
    run(() =>
      upsertVenueBooking(tripId, row.locationId, {
        status: row.status,
        label: label.trim() || undefined,
        bookedContactId: contactId === NONE ? undefined : contactId,
        confirmationRef: confirmationRef.trim() || undefined,
        notes: notes.trim() || undefined,
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
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— flat —</SelectItem>
                  <SelectItem value="PER_PERSON">per person</SelectItem>
                  <SelectItem value="PER_GROUP">per group</SelectItem>
                </SelectContent>
              </Select>
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
    </div>
  );
}

const INSTALLMENT_STATE_STYLES: Record<ResolvedInstallment["state"], string> = {
  paid: "text-emerald-700 dark:text-emerald-300",
  overdue: "font-medium text-red-600 dark:text-red-400",
  upcoming: "text-muted-foreground",
  unscheduled: "text-amber-700 dark:text-amber-300",
};

const INSTALLMENT_STATE_LABELS: Record<ResolvedInstallment["state"], string> = {
  paid: "paid",
  overdue: "overdue",
  upcoming: "due",
  unscheduled: "needs agreed price / trip dates",
};

// One editable installment row's local form state.
type InstallmentDraft = {
  key: number;
  label: string;
  mode: "percent" | "fixed";
  value: string;
  offsetDays: string;
};

function draftsFromRow(schedule: ResolvedInstallment[]): InstallmentDraft[] {
  return schedule.map((i, idx) => ({
    key: idx,
    label: i.label ?? "",
    mode: i.percent != null ? "percent" : "fixed",
    value: String(i.percent ?? i.fixedAmount ?? ""),
    offsetDays: String(i.dueOffsetDays),
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
        : [{ key: 0, label: "Deposit", mode: "percent", value: "", offsetDays: "180" }],
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
            dueOffsetDays: d.offsetDays,
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
            No schedule — payments are free-form against the agreed price.
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
                </span>
                <span className={cn("text-xs", INSTALLMENT_STATE_STYLES[i.state])}>
                  {i.state === "unscheduled"
                    ? INSTALLMENT_STATE_LABELS.unscheduled
                    : `${INSTALLMENT_STATE_LABELS[i.state]}${i.dueDate ? ` ${formatDate(i.dueDate)}` : ""}`}
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
              <div className="space-y-1">
                <Label className="text-xs">Days before start</Label>
                <Input
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={d.offsetDays}
                  onChange={(e) => patch(d.key, { offsetDays: e.target.value })}
                  className="w-28"
                />
              </div>
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
                    offsetDays: "30",
                  },
                ])
              }
            >
              Add installment
            </Button>
            <Button
              size="sm"
              disabled={pending || drafts.some((d) => !d.value || d.offsetDays === "")}
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
        {row.agreedAmount != null ? (
          <span className="ml-2 font-normal">
            {formatMoney(row.paidTotal, row.agreedCurrency)} of{" "}
            {formatMoney(row.agreedAmount, row.agreedCurrency)} paid
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
}: {
  row: VenueBookingRow;
  tripId: string;
  canEdit: boolean;
  contacts: ContactOption[];
  currencies: string[];
}) {
  const [open, setOpen] = useState(false);
  const coverage = coverageLine(row);

  return (
    <>
      <TableRow
        className={cn(
          row.needsInfo && "bg-amber-50 dark:bg-amber-950/40",
          !row.bookable && "text-muted-foreground",
        )}
      >
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
            <StatusControl
              status={row.status}
              canEdit={canEdit}
              onSet={(status) =>
                setVenueBookingStatus(tripId, row.locationId, status)
              }
            />
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
}: {
  row: VenueBookingRow;
  tripId: string;
  canEdit: boolean;
  contacts: ContactOption[];
  currencies: string[];
}) {
  const [open, setOpen] = useState(false);
  const coverage = coverageLine(row);

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        row.needsInfo && "bg-amber-50 dark:bg-amber-950/40",
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
                {row.isMissingTime ? " · some sessions missing a time" : ""}
              </span>
            ) : null}
          </span>
        </button>
        <span className="shrink-0">
          {row.bookable ? (
            <StatusControl
              status={row.status}
              canEdit={canEdit}
              onSet={(status) =>
                setVenueBookingStatus(tripId, row.locationId, status)
              }
            />
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
          />
        </div>
      ) : null}
    </div>
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

// The <sm stacked-card rendering of a one-off (site-less) item booking.
export function ItemCard({
  row,
  canEdit,
}: {
  row: ItemBookingRow;
  canEdit: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium">{row.label}</span>
          <span className="block text-xs text-muted-foreground">
            Day {row.dayIndex}
            {row.date ? ` · ${formatDate(row.date)}` : ""} · one-off
            {row.contactName ? ` · ${row.contactName}` : ""}
            {row.confirmationRef ? ` · ref ${row.confirmationRef}` : ""}
          </span>
        </span>
        <span className="shrink-0">
          <StatusControl
            status={row.status}
            canEdit={canEdit}
            onSet={(status: BookingStatus) =>
              setBookingStatus(row.bookingId, status)
            }
          />
        </span>
      </div>
    </div>
  );
}
