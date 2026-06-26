"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { regionOptions, type RegionNode } from "@/lib/regions";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

const NO_PARENT = "__none__";

export type RegionInitial = {
  id?: string;
  name: string;
  parentId: string | null;
  tripTypeIds: string[];
};

export function RegionForm({
  action,
  submitLabel,
  regions,
  tripTypes,
  initial,
  onSaved,
}: {
  action: Action;
  submitLabel: string;
  regions: RegionNode[];
  tripTypes: { id: string; name: string }[];
  initial?: RegionInitial;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const [parentId, setParentId] = useState(initial?.parentId ?? NO_PARENT);

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      onSaved?.();
    } else if (state.error) toast.error(state.error);
    // onSaved identity is stable enough; depend only on the action result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // A region can't be its own parent; deeper cycles are rejected server-side.
  const parentChoices = regionOptions(regions).filter(
    (o) => o.id !== initial?.id,
  );
  const selectedTypes = new Set(initial?.tripTypeIds ?? []);

  return (
    <form action={formAction} className="space-y-3">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input
        type="hidden"
        name="parentId"
        value={parentId === NO_PARENT ? "" : parentId}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            defaultValue={initial?.name}
            placeholder="e.g. London"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="parentId">Parent region</Label>
          <Select value={parentId} onValueChange={setParentId}>
            <SelectTrigger id="parentId" className="w-full">
              <SelectValue placeholder="— none (top level) —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_PARENT}>— none (top level) —</SelectItem>
              {parentChoices.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Trip types</Label>
        {tripTypes.length ? (
          <div className="flex flex-wrap gap-3">
            {tripTypes.map((t) => (
              <label
                key={t.id}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <Checkbox
                  name="tripTypeIds"
                  value={t.id}
                  defaultChecked={selectedTypes.has(t.id)}
                />
                {t.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No trip types yet.</p>
        )}
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
