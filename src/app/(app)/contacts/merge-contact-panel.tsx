"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useAction } from "@/lib/use-action";
import type { ContactMergePreview } from "@/lib/contact-merge";
import { SearchPicker, type PickerOption } from "./search-picker";
import { mergeContact, previewMergeContact } from "./actions";

// "Merge into…": pick the contact to KEEP, review what moves, confirm. This
// contact (the duplicate) is deleted and the page moves to the kept one.
export function MergeContactPanel({
  contactId,
  contactName,
  candidates,
}: {
  contactId: string;
  contactName: string;
  candidates: PickerOption[];
}) {
  const router = useRouter();
  const [previewing, startPreview] = useTransition();
  const { pending: merging, run } = useAction();
  const [preview, setPreview] = useState<ContactMergePreview | null>(null);
  const pending = previewing || merging;

  const pick = (targetId: string) =>
    startPreview(async () => {
      try {
        const res = await previewMergeContact(contactId, targetId);
        if (res.error) toast.error(res.error);
        else setPreview(res.preview ?? null);
      } catch {
        toast.error("Couldn't reach the server. Try again.");
      }
    });

  const confirm = () => {
    if (!preview) return;
    const targetId = preview.target.id;
    run(
      () => mergeContact(contactId, targetId),
      () => router.push(`/contacts/${targetId}`),
    );
  };

  if (preview) {
    const p = preview;
    const lines = [
      [p.locations, "location link"],
      [p.primaryFor, "primary-contact designation"],
      [p.bookings, "booking"],
      [p.notes, "note"],
      [p.presentedItems, "presenter slot"],
      [p.presentationDefaults, "default-presenter link"],
    ] as const;
    const moving = lines.filter(([n]) => n > 0);
    return (
      <div className="space-y-3 text-sm">
        <h4 className="text-sm font-medium">
          Merge {p.source.name} into {p.target.name}
        </h4>
        {moving.length ? (
          <p className="text-muted-foreground">
            Moves{" "}
            {moving
              .map(([n, label]) => `${n} ${label}${n === 1 ? "" : "s"}`)
              .join(", ")}
            .
          </p>
        ) : (
          <p className="text-muted-foreground">Nothing else references it.</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <ConfirmButton
            variant="destructive"
            disabled={pending}
            pending={pending}
            title="Merge contact"
            description={`Deletes ${p.source.name}. Its links, bookings and notes move to ${p.target.name}.`}
            confirmLabel="Merge and delete"
            onConfirm={confirm}
          >
            {merging ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Merge and delete
          </ConfirmButton>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setPreview(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        Merge {contactName} into…
        {previewing ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label="Loading"
          />
        ) : null}
      </h4>
      <SearchPicker
        options={candidates}
        placeholder="Contact to keep…"
        emptyText="No matching contacts."
        onPick={pick}
        disabled={pending}
      />
    </div>
  );
}
