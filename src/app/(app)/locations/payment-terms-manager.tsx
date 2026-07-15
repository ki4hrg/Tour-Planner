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
import type { FormState } from "@/lib/forms";
import type { ScheduleInstallmentInput } from "@/lib/payment-schedule";
import { setLocationDefaultPaymentSchedule } from "./actions";

// A location's standing payment terms (GH #86): the installment pattern this venue
// generally uses year to year. Unlike the booking-level schedule these are
// unresolved — no agreed price or trip dates — so we show the raw percent/fixed +
// timing only. New engagements pre-fill from this. Mirrors the replace-the-whole-set
// editor in booking-row.tsx.

type Draft = {
  key: number;
  label: string;
  mode: "percent" | "fixed";
  value: string;
  offsetDays: string;
};

function draftsFrom(installments: ScheduleInstallmentInput[]): Draft[] {
  return installments.map((i, idx) => ({
    key: idx,
    label: i.label ?? "",
    mode: i.percent != null ? "percent" : "fixed",
    value: String(i.percent ?? i.fixedAmount ?? ""),
    offsetDays: String(i.dueOffsetDays),
  }));
}

// "180 days before start" / "on the start date" / "10 days after start".
function timingLabel(offsetDays: number): string {
  if (offsetDays === 0) return "on the start date";
  return offsetDays > 0
    ? `${offsetDays} days before start`
    : `${-offsetDays} days after start`;
}

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

export function PaymentTermsManager({
  locationId,
  installments,
  canEdit,
}: {
  locationId: string;
  installments: ScheduleInstallmentInput[];
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const startEditing = () => {
    setDrafts(
      installments.length
        ? draftsFrom(installments)
        : [{ key: 0, label: "Deposit", mode: "percent", value: "", offsetDays: "180" }],
    );
    setEditing(true);
  };

  const patch = (key: number, part: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...part } : d)));

  const save = () =>
    run(
      () =>
        setLocationDefaultPaymentSchedule(locationId, {
          installments: drafts.map((d) => ({
            label: d.label.trim() || undefined,
            percent: d.mode === "percent" ? d.value : undefined,
            fixedAmount: d.mode === "fixed" ? d.value : undefined,
            dueOffsetDays: d.offsetDays,
          })),
        }),
      () => setEditing(false),
    );

  if (!editing) {
    return (
      <div className="space-y-2">
        {installments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No standing terms — set them once and new engagements at this venue
            pre-fill their payment schedule.
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {installments.map((i, idx) => (
              <li key={i.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">
                  {i.label || `Installment ${idx + 1}`}
                </span>
                <span className="text-muted-foreground">
                  {i.percent != null
                    ? `${i.percent}% of agreed`
                    : `${i.fixedAmount} fixed`}
                  {" · "}
                  {timingLabel(i.dueOffsetDays)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <Button variant="outline" size="sm" onClick={startEditing}>
            {installments.length ? "Edit terms" : "+ Add terms"}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
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
            onValueChange={(mode) => patch(d.key, { mode: mode as Draft["mode"] })}
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
            onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
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
  );
}
