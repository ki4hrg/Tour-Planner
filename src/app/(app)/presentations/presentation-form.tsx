"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useEditSection } from "@/components/editable-section";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type PresentationInitial = {
  id?: string;
  title: string;
  description: string | null;
  notes: string | null;
  durationMinutes: number | null;
  defaultPresenterIds: string[];
};

export function PresentationForm({
  action,
  initial,
  submitLabel,
  resetOnSuccess,
  contacts,
}: {
  action: Action;
  initial?: PresentationInitial;
  submitLabel: string;
  resetOnSuccess?: boolean;
  contacts: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const ref = useRef<HTMLFormElement>(null);
  const section = useEditSection();

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
      section?.setEditing(false);
    } else if (state.error) {
      toast.error(state.error);
    }
    // section identity is stable; depend only on the action result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, resetOnSuccess]);

  const selected = new Set(initial?.defaultPresenterIds ?? []);

  return (
    <form
      ref={ref}
      action={formAction}
      className="space-y-5"
    >
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="space-y-1.5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          name="title"
          defaultValue={initial?.title}
          required
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="durationMinutes">Duration (minutes)</Label>
          <Input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min={1}
            placeholder="e.g. 45"
            defaultValue={initial?.durationMinutes ?? ""}
          />
        </div>
      </div>

      <div className="space-y-1.5">
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

      <div className="space-y-1.5">
        <Label htmlFor="notes">
          Notes{" "}
          <span className="text-muted-foreground">(staff only)</span>
        </Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
        />
      </div>

      <div>
        <Label className="mb-2 block">Default presenters</Label>
        {contacts.length ? (
          <div className="flex flex-wrap gap-3">
            {contacts.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
              >
                <Checkbox
                  name="defaultPresenterIds"
                  value={c.id}
                  defaultChecked={selected.has(c.id)}
                />
                {c.name}
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No contacts.
          </p>
        )}
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
