"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// The one confirmation step for destructive actions (entity deletes in a
// Danger zone, cascading row deletes). `description` is a single line stating
// the consequence as a fact ("Deletes all days and items."). Controlled so a
// caller can open it from any trigger; uncontrolled callers use
// <ConfirmButton>.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// A destructive button that confirms before running `onConfirm`. Pass
// `formAction` instead of `onConfirm` to submit the enclosing <form> (a
// Danger-zone Server Action form) once confirmed: the confirm button then
// becomes the real submit.
export function ConfirmButton({
  title,
  description,
  confirmLabel,
  onConfirm,
  formId,
  pending,
  children,
  ...buttonProps
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "type"> & {
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm?: () => void;
  // When set, confirming submits this form (by id) instead of calling onConfirm.
  formId?: string;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const confirm = () => {
    if (formId) {
      const form = document.getElementById(formId);
      if (form instanceof HTMLFormElement) form.requestSubmit();
    } else {
      onConfirm?.();
    }
    setOpen(false);
  };
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} {...buttonProps}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        onConfirm={confirm}
        pending={pending}
      />
    </>
  );
}
