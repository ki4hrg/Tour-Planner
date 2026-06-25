"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type SiteInitial = {
  id?: string;
  name: string;
  region: string | null;
  address: string | null;
  description: string | null;
  notes: string | null;
  website: string | null;
  mapUrl: string | null;
  bookingOpensLeadDays: number | null;
  bookingNotes: string | null;
  scheduleLimitations: string | null;
  tripTypeIds: string[];
};

export function SiteForm({
  action,
  submitLabel,
  tripTypes,
  initial,
}: {
  action: Action;
  submitLabel: string;
  tripTypes: { id: string; name: string }[];
  initial?: SiteInitial;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  const selected = new Set(initial?.tripTypeIds ?? []);

  return (
    <form action={formAction} className="space-y-5">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={initial?.name} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="region">Region</Label>
          <Input
            id="region"
            name="region"
            placeholder="e.g. Lincolnshire"
            defaultValue={initial?.region ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" defaultValue={initial?.address ?? ""} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            name="website"
            type="url"
            placeholder="https://…"
            defaultValue={initial?.website ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mapUrl">Map link</Label>
          <Input
            id="mapUrl"
            name="mapUrl"
            type="url"
            placeholder="https://maps.…"
            defaultValue={initial?.mapUrl ?? ""}
          />
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
                  defaultChecked={selected.has(t.id)}
                />
                {t.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No trip types yet — create one first to tag sites.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="bookingOpensLeadDays">Booking opens (days before)</Label>
          <Input
            id="bookingOpensLeadDays"
            name="bookingOpensLeadDays"
            type="number"
            min={0}
            placeholder="e.g. 180"
            defaultValue={initial?.bookingOpensLeadDays ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="scheduleLimitations">Schedule limitations</Label>
          <Input
            id="scheduleLimitations"
            name="scheduleLimitations"
            placeholder="e.g. Open Wed–Sat"
            defaultValue={initial?.scheduleLimitations ?? ""}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="bookingNotes">Booking notes</Label>
          <Textarea
            id="bookingNotes"
            name="bookingNotes"
            rows={2}
            defaultValue={initial?.bookingNotes ?? ""}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">
            Description{" "}
            <span className="text-muted-foreground">(shown on itineraries)</span>
          </Label>
          <Textarea
            id="description"
            name="description"
            rows={3}
            defaultValue={initial?.description ?? ""}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">
            Internal notes{" "}
            <span className="text-muted-foreground">(staff only)</span>
          </Label>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            defaultValue={initial?.notes ?? ""}
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
