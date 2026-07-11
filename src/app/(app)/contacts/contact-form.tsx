"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
import { useEditSection } from "@/components/editable-section";
import {
  DIAL_CODES,
  DEFAULT_DIAL_CODE,
  composePhone,
  splitPhone,
} from "@/lib/dial-codes";
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
  defaultDialCode,
}: {
  action: Action;
  initial?: ContactInitial;
  submitLabel: string;
  locationId?: string;
  resetOnSuccess?: boolean;
  // Pre-selected dial code for new numbers — derived from the location's
  // region where there is one (e.g. England → 44); falls back to +1.
  defaultDialCode?: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  const ref = useRef<HTMLFormElement>(null);
  const section = useEditSection();

  const fallbackCode = defaultDialCode || DEFAULT_DIAL_CODE;
  const initialSplit = splitPhone(initial?.phone, fallbackCode);
  const [dialCode, setDialCode] = useState(initialSplit.code);
  const [phoneNumber, setPhoneNumber] = useState(initialSplit.number);
  // Until the user touches the phone fields, submit the stored value verbatim —
  // an unrelated edit must not rewrite a legacy free-text number into E.164.
  const [phoneTouched, setPhoneTouched] = useState(false);
  const composed = phoneTouched
    ? composePhone(dialCode, phoneNumber)
    : (initial?.phone ?? "");

  // An existing number may carry a dial code outside the curated list.
  const codeOptions = DIAL_CODES.some((c) => c.code === dialCode)
    ? DIAL_CODES
    : [...DIAL_CODES, { code: dialCode, label: `+${dialCode}` }];

  // Reset the controlled phone state when a new action result lands — done as a
  // render-phase adjustment (not in the effect) per react-hooks/set-state-in-effect.
  const [handledState, setHandledState] = useState(state);
  if (handledState !== state) {
    setHandledState(state);
    if (state.ok && resetOnSuccess) {
      setDialCode(fallbackCode);
      setPhoneNumber("");
      setPhoneTouched(false);
    }
  }

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
        <Label htmlFor="phoneNumber">Phone</Label>
        <input type="hidden" name="phone" value={composed} />
        <div className="flex gap-2">
          <Select
            value={dialCode}
            onValueChange={(v) => {
              setDialCode(v);
              setPhoneTouched(true);
            }}
          >
            <SelectTrigger className="w-28 shrink-0" aria-label="Country code">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {codeOptions.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id="phoneNumber"
            type="tel"
            value={phoneNumber}
            onChange={(e) => {
              setPhoneNumber(e.target.value);
              setPhoneTouched(true);
            }}
            placeholder="7911 123456"
          />
        </div>
        {phoneTouched && composed ? (
          <p className="text-xs text-muted-foreground">Saves as {composed}</p>
        ) : null}
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
