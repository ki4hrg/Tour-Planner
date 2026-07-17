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
import type { FormState } from "@/lib/forms";
import { setLocationPaymentSchedule } from "./actions";

// A venue's STANDING payment terms (GH #86) — the deposit/balance cadence that
// tends to hold year to year. Stored on the Location like the Cost catalog and
// used to pre-fill a new engagement's schedule. These are date-relative
// ("N days before trip start") and carry no resolved amounts of their own —
// resolution happens once they land on a dated trip's booking.

export type StandingTerm = {
  id: string;
  label: string | null;
  percent: number | null;
  fixedAmount: number | null;
  dueOffsetDays: number;
};

type Draft = {
  key: number;
  label: string;
  mode: "percent" | "fixed";
  value: string;
  offsetDays: string;
};

function draftsFrom(terms: StandingTerm[]): Draft[] {
  return terms.map((t, idx) => ({
    key: idx,
    label: t.label ?? "",
    mode: t.percent != null ? "percent" : "fixed",
    value: String(t.percent ?? t.fixedAmount ?? ""),
    offsetDays: String(t.dueOffsetDays),
  }));
}

// "180 days before start" / "day of" / "30 days after start" — the same
// date-relative language the booking schedule uses, minus the resolved date.
function offsetLabel(days: number): string {
  if (days === 0) return "day of start";
  return days > 0
    ? `${days} day${days === 1 ? "" : "s"} before start`
    : `${-days} day${days === -1 ? "" : "s"} after start`;
}

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
        : [{ key: 0, label: "Deposit", mode: "percent", value: "", offsetDays: "180" }],
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
            dueOffsetDays: d.offsetDays,
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
            No standing terms. Add the venue&apos;s usual deposit/balance cadence
            and new bookings here will pre-fill from it.
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
                  {offsetLabel(t.dueOffsetDays)}
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
