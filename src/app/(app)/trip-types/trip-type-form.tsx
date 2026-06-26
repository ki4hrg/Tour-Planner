"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
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
import { ColorField } from "@/components/color-field";
import { useEditSection } from "@/components/editable-section";
import { CURRENCIES } from "@/lib/money";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function TripTypeForm({
  action,
  initial,
  submitLabel,
}: {
  action: Action;
  initial?: {
    id?: string;
    name: string;
    description: string | null;
    color: string | null;
    defaultCurrency: string;
  };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  const section = useEditSection();

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      section?.setEditing(false);
    } else if (state.error) toast.error(state.error);
    // section identity is stable; depend only on the action result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={initial?.name} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="defaultCurrency">Default currency</Label>
        <Select
          name="defaultCurrency"
          defaultValue={initial?.defaultCurrency ?? "USD"}
        >
          <SelectTrigger id="defaultCurrency">
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
      <ColorField
        name="color"
        label="Accent color"
        defaultValue={initial?.color ?? ""}
      />
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
        />
      </div>
      <div className="flex gap-2 sm:col-span-2">
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
