"use client";

import { useActionState, useEffect, useState } from "react";
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
import {
  CURRENCIES,
  COST_UNIT_LABELS,
  formatMoney,
  type SerializedCost,
} from "@/lib/money";
import type { FormState } from "@/lib/forms";
import { addCost, updateCost, deleteCost } from "./actions";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

// Staleness is computed on the server (render-time Date.now() is impure here).
type CostView = SerializedCost & { stale: boolean };

function CostFields({
  action,
  locationId,
  defaultCurrency,
  initial,
  submitLabel,
  onSuccess,
}: {
  action: Action;
  locationId: string;
  defaultCurrency: string;
  initial?: SerializedCost;
  submitLabel: string;
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  useEffect(() => {
    if (state.ok) {
      if (state.message) toast.success(state.message);
      onSuccess?.();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, onSuccess]);

  return (
    // Two columns at every width: the form lives in the Location page's
    // narrow side card, where a viewport-sized four-column grid collided.
    <form action={formAction} className="grid grid-cols-2 gap-3 [&>div]:min-w-0">
      <input type="hidden" name="locationId" value={locationId} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="col-span-2 space-y-1.5">
        <Label className="text-xs">Label</Label>
        <Input name="label" defaultValue={initial?.label} required />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Amount</Label>
        <Input
          name="amount"
          type="number"
          step="0.01"
          min="0"
          defaultValue={initial?.amount ?? ""}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Currency</Label>
        <Select name="currency" defaultValue={initial?.currency ?? defaultCurrency}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CURRENCIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Unit</Label>
        <Select name="unit" defaultValue={initial?.unit ?? "PER_PERSON"}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(COST_UNIT_LABELS).map(([v, label]) => (
              <SelectItem key={v} value={v}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Price confirmed</Label>
        <Input
          name="confirmedAt"
          type="date"
          defaultValue={initial?.confirmedAt?.slice(0, 10) ?? ""}
        />
      </div>
      <div className="col-span-2 space-y-1.5">
        <Label className="text-xs">Notes</Label>
        <Input name="notes" defaultValue={initial?.notes ?? ""} />
      </div>
      <div className="col-span-2 flex items-end">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function CostRow({
  cost,
  locationId,
  defaultCurrency,
  canEdit,
}: {
  cost: CostView;
  locationId: string;
  defaultCurrency: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="rounded-md border p-3">
        <CostFields
          action={updateCost}
          locationId={locationId}
          defaultCurrency={defaultCurrency}
          initial={cost}
          submitLabel="Save"
          onSuccess={() => setEditing(false)}
        />
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="font-medium">
          {cost.label}{" "}
          <span className="text-muted-foreground">
            — {formatMoney(cost.amount, cost.currency)}{" "}
            {COST_UNIT_LABELS[cost.unit]}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {cost.confirmedAt
            ? `Confirmed ${cost.confirmedAt.slice(0, 10)}`
            : "Price not confirmed"}
          {cost.stale ? " · ⚠ stale" : ""}
          {cost.notes ? ` · ${cost.notes}` : ""}
        </div>
      </div>
      {canEdit ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <form action={deleteCost}>
            <input type="hidden" name="id" value={cost.id} />
            <input type="hidden" name="locationId" value={locationId} />
            <Button variant="ghost" size="sm" className="text-destructive">
              Delete
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function CostsManager({
  locationId,
  costs,
  defaultCurrency,
  canEdit,
}: {
  locationId: string;
  costs: CostView[];
  defaultCurrency: string;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      <div className="divide-y">
        {costs.map((c) => (
          <CostRow
            key={c.id}
            cost={c}
            locationId={locationId}
            defaultCurrency={defaultCurrency}
            canEdit={canEdit}
          />
        ))}
        {costs.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No costs.</p>
        ) : null}
      </div>
      {canEdit ? (
        adding ? (
          <div className="rounded-md border border-dashed p-3">
            <p className="mb-2 text-sm font-medium">Add a cost</p>
            <CostFields
              action={addCost}
              locationId={locationId}
              defaultCurrency={defaultCurrency}
              submitLabel="Add cost"
              onSuccess={() => setAdding(false)}
            />
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            + Add cost
          </Button>
        )
      ) : null}
    </div>
  );
}
