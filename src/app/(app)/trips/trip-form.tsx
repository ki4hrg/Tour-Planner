"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TRIP_STATUS_LABELS, TRIP_STATUSES } from "@/lib/trips";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type TripInitial = {
  id?: string;
  name: string;
  tripTypeId: string;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  participantCount: number | null;
  status: string;
  notes: string | null;
  isTemplate: boolean;
};

export function TripForm({
  action,
  submitLabel,
  tripTypes,
  initial,
}: {
  action: Action;
  submitLabel: string;
  tripTypes: { id: string; name: string }[];
  initial?: TripInitial;
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
    <form action={formAction} className="space-y-5">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={initial?.name} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tripTypeId">Trip type</Label>
          <Select name="tripTypeId" defaultValue={initial?.tripTypeId}>
            <SelectTrigger id="tripTypeId">
              <SelectValue placeholder="Choose a trip type…" />
            </SelectTrigger>
            <SelectContent>
              {tripTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select name="status" defaultValue={initial?.status ?? "PLANNING"}>
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIP_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {TRIP_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={initial?.startDate ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            defaultValue={initial?.endDate ?? ""}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="capacity">Capacity</Label>
          <Input
            id="capacity"
            name="capacity"
            type="number"
            min={0}
            placeholder="max slots"
            defaultValue={initial?.capacity ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="participantCount">Participants</Label>
          <Input
            id="participantCount"
            name="participantCount"
            type="number"
            min={0}
            placeholder="registered headcount"
            defaultValue={initial?.participantCount ?? ""}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={initial?.notes ?? ""}
          />
        </div>

        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <Checkbox
            name="isTemplate"
            defaultChecked={initial?.isTemplate ?? false}
          />
          Save as a reusable template
          <span className="text-muted-foreground">
            (instantiation arrives in a later milestone)
          </span>
        </label>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
