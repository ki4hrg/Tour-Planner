"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/money";
import {
  describeCadence,
  type PaymentAnchor,
  type PaymentOffsetUnit,
} from "@/lib/payment-schedule";
import type { FormState } from "@/lib/forms";
import { setLocationPaymentSchedule } from "./actions";

// A venue's STANDING payment terms (GH #86) — the deposit/balance cadence that
// tends to hold year to year. Stored on the Location like the Cost catalog and
// used to pre-fill a new engagement's schedule. These are anchor-relative and
// carry no resolved amounts/dates of their own — resolution happens once they
// land on a real booking (dated trip / booked-on date).

export type StandingTerm = {
  id: string;
  label: string | null;
  percent: number | null;
  fixedAmount: number | null;
  anchor: PaymentAnchor;
  offsetValue: number | null;
  offsetUnit: PaymentOffsetUnit | null;
};

type Draft = {
  key: number;
  label: string;
  mode: "percent" | "fixed";
  value: string;
  anchor: PaymentAnchor;
  offset: string;
  unit: PaymentOffsetUnit;
};

function draftsFrom(terms: StandingTerm[]): Draft[] {
  return terms.map((t, idx) => ({
    key: idx,
    label: t.label ?? "",
    mode: t.percent != null ? "percent" : "fixed",
    value: String(t.percent ?? t.fixedAmount ?? ""),
    anchor: t.anchor,
    offset: t.offsetValue == null ? "" : String(t.offsetValue),
    unit: t.offsetUnit ?? "DAY",
  }));
}

const newDraft = (key: number): Draft => ({
  key,
  label: "",
  mode: "percent",
  value: "",
  anchor: "EVENT_START",
  offset: "30",
  unit: "DAY",
});

export function LocationPaymentTerms({
  locationId,
  terms,
  currency,
  canEdit,
}: {
  locationId: string;
  terms: StandingTerm[];
  // A representative currency (the venue's first cost, else USD) purely to format
  // fixed amounts in the read view; the real currency is set per engagement.
  currency: string;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const run = (fn: () => Promise<FormState>, onOk?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        if (res.message) toast.success(res.message);
        onOk?.();
      }
    });

  const startEditing = () => {
    setDrafts(
      terms.length
        ? draftsFrom(terms)
        : [{ ...newDraft(0), label: "Deposit", offset: "180" }],
    );
    setEditing(true);
  };

  const patch = (key: number, part: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...part } : d)));

  const save = () =>
    run(
      () =>
        setLocationPaymentSchedule(locationId, {
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
    <div className="space-y-2">
      <p className="flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
        Standing terms
        {canEdit && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="font-normal underline-offset-2 hover:underline"
          >
            {terms.length ? "Edit" : "Add"}
          </button>
        ) : null}
      </p>

      {!editing ? (
        terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No standing terms.
          </p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {terms.map((t, idx) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-2">
                <span>{t.label || `Installment ${idx + 1}`}</span>
                <span className="text-xs text-muted-foreground">
                  {t.percent != null
                    ? `${t.percent}% of agreed`
                    : formatMoney(t.fixedAmount ?? 0, currency)}
                  {" · "}
                  {describeCadence(t)}
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
                  patch(d.key, { mode: mode as Draft["mode"] })
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
              {/* Offset value + unit — hidden for a no-deadline (NONE) term. */}
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
                  newDraft((prev[prev.length - 1]?.key ?? -1) + 1),
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
              Save terms
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
