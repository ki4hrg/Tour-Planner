"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorField } from "@/components/color-field";
import type { FormState } from "@/lib/forms";
import type { ScheduleItemKind } from "@prisma/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SCHEDULE_ITEM_KINDS,
  SCHEDULE_ITEM_KIND_LABELS,
} from "@/lib/schedule-kinds";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function CategoryForm({
  action,
  initial,
  submitLabel,
}: {
  action: Action;
  initial?: {
    id?: string;
    name: string;
    color: string | null;
    sortOrder: number;
    kind: ScheduleItemKind;
    // Built-in: the kind is fixed.
    system?: boolean;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="space-y-1.5 sm:col-span-3">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={initial?.name} required />
      </div>
      <ColorField
        name="color"
        label="Accent color"
        defaultValue={initial?.color ?? ""}
        className="sm:col-span-2"
      />
      {/* The kind decides which fields an item of this category offers. */}
      <div className="space-y-1.5 sm:col-span-3">
        <Label htmlFor="kind">Kind</Label>
        {initial?.system ? (
          <p id="kind" className="text-sm">
            {SCHEDULE_ITEM_KIND_LABELS[initial.kind]}
          </p>
        ) : (
          <Select name="kind" defaultValue={initial?.kind ?? "OTHER"}>
            <SelectTrigger id="kind" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULE_ITEM_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {SCHEDULE_ITEM_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="sortOrder">Order</Label>
        <Input
          id="sortOrder"
          name="sortOrder"
          type="number"
          defaultValue={initial?.sortOrder ?? 0}
        />
      </div>
      <div className="sm:col-span-6">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
