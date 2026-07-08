"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
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
import { useEditSection } from "@/components/editable-section";
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

const BLANK = "__blank__";

export function TripForm({
  action,
  submitLabel,
  tripTypes,
  initial,
  templates,
  defaultIsTemplate,
}: {
  action: Action;
  submitLabel: string;
  tripTypes: { id: string; name: string }[];
  initial?: TripInitial;
  // When provided (create flow), offer to instantiate from a template of the
  // selected trip type. Omitted on edit — you don't re-instantiate an existing trip.
  templates?: { id: string; name: string; tripTypeId: string }[];
  defaultIsTemplate?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  const section = useEditSection();
  const [tripTypeId, setTripTypeId] = useState(initial?.tripTypeId ?? "");
  const [templateId, setTemplateId] = useState(BLANK);
  // Templates carry no calendar dates — they're reusable skeletons. Track the
  // flag reactively so the date fields disappear the moment "template" is chosen.
  const [isTemplate, setIsTemplate] = useState(
    initial?.isTemplate ?? defaultIsTemplate ?? false,
  );

  // Templates are type-scoped: only show those matching the selected type.
  const typeTemplates = useMemo(
    () => (templates ?? []).filter((t) => t.tripTypeId === tripTypeId),
    [templates, tripTypeId],
  );

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      section?.setEditing(false);
    } else if (state.error) toast.error(state.error);
    // section identity is stable; depend only on the action result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <input type="hidden" name="tripTypeId" value={tripTypeId} />
          <Select
            value={tripTypeId}
            onValueChange={(v) => {
              setTripTypeId(v);
              // Template choices are type-scoped — reset on type change.
              setTemplateId(BLANK);
            }}
          >
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

        {templates && typeTemplates.length ? (
          <div className="space-y-1.5">
            <Label htmlFor="templateId">Start from template</Label>
            <input type="hidden" name="templateId" value={templateId === BLANK ? "" : templateId} />
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="templateId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BLANK}>Blank itinerary</SelectItem>
                {typeTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {/* Status is a dated-trip lifecycle concern — templates have none (they're
            always PLANNING). Submit it hidden so the required field still validates. */}
        {isTemplate ? (
          <input
            type="hidden"
            name="status"
            value={initial?.status ?? "PLANNING"}
          />
        ) : (
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
        )}

        {!isTemplate ? (
          <>
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
          </>
        ) : null}

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
        {/* Participants is a registered-headcount concern for real trips only;
            templates estimate costs against capacity instead. */}
        {!isTemplate ? (
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
        ) : null}

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={initial?.notes ?? ""}
          />
        </div>

        {/* Marking-as-template only applies when creating. Existing trips use the
            "Save as template" button, which snapshots the itinerary into a new template. */}
        {!initial?.id ? (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              name="isTemplate"
              checked={isTemplate}
              onCheckedChange={(v) => setIsTemplate(v === true)}
            />
            Save as a reusable template (no calendar dates)
          </label>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {section ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => section.setEditing(false)}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
