"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/forms";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export type ContactInitial = {
  id?: string;
  name: string;
  organization: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export function ContactForm({
  action,
  initial,
  submitLabel,
  locationId,
  resetOnSuccess,
}: {
  action: Action;
  initial?: ContactInitial;
  submitLabel: string;
  locationId?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok && state.message) {
      toast.success(state.message);
      if (resetOnSuccess) ref.current?.reset();
    } else if (state.error) {
      toast.error(state.error);
    }
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      action={formAction}
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
    >
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {locationId ? <input type="hidden" name="locationId" value={locationId} /> : null}
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={initial?.name} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="organization">Organization</Label>
        <Input
          id="organization"
          name="organization"
          defaultValue={initial?.organization ?? ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="role">Role</Label>
        <Input id="role" name="role" defaultValue={initial?.role ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={initial?.email ?? ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" name="phone" defaultValue={initial?.phone ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
        />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
