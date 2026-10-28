"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LocationMergePreview } from "@/lib/location-merge";
import { mergeLocation, previewMergeLocation } from "./actions";

type Candidate = { id: string; name: string; region: string | null };

// "Merge into…": pick the location to KEEP, review what moves, confirm. This
// location (the duplicate) is deleted and the page moves to the kept one.
export function MergeLocationPanel({
  locationId,
  locationName,
  candidates,
}: {
  locationId: string;
  locationName: string;
  candidates: Candidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<LocationMergePreview | null>(null);

  const q = query.trim().toLowerCase();
  const matches = q
    ? candidates
        .filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.region?.toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  const pick = (targetId: string) =>
    start(async () => {
      const res = await previewMergeLocation(locationId, targetId);
      if (res.error) toast.error(res.error);
      else setPreview(res.preview ?? null);
    });

  const confirm = () =>
    start(async () => {
      if (!preview) return;
      const res = await mergeLocation(locationId, preview.target.id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/locations/${preview.target.id}`);
    });

  if (preview) {
    const p = preview;
    const lines = [
      [p.scheduleItems, "itinerary item visit"],
      [p.plannedDays, "rough-plan day"],
      [p.bookings, "booking"],
      [p.stays, "stay"],
      [p.notes, "note"],
      [p.documents, "document"],
      [p.costs, "cost"],
      [p.events, "venue event"],
      [p.contacts, "new contact link"],
      [p.travelReferences, "travel / day reference"],
      [p.shareLinks, "host-site share link"],
      [p.coveredSites, "covered site"],
    ] as const;
    const moving = lines.filter(([n]) => n > 0);
    return (
      <div className="space-y-3 text-sm">
        <p>
          Merge <strong>{p.source.name}</strong> into{" "}
          <strong>{p.target.name}</strong>? Deletes {p.source.name}.
        </p>
        {moving.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {moving.map(([n, label]) => (
              <li key={label}>
                {n} {label}
                {n === 1 ? "" : "s"}
              </li>
            ))}
            {p.hostSite === "moved" ? <li>host-site details</li> : null}
            {p.hostSite === "merged" ? <li>host-site details (combined)</li> : null}
            {p.paymentTerms === "moved" ? <li>standing payment terms</li> : null}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nothing else references it.</p>
        )}
        {p.bookingConflicts.length ? (
          <p className="text-amber-700 dark:text-amber-300">
            Combines bookings on{" "}
            {p.bookingConflicts.map((c) => c.tripName).join(", ")}.
          </p>
        ) : null}
        {p.paymentTerms === "dropped" ? (
          <p className="text-amber-700 dark:text-amber-300">
            Discards {p.source.name}&rsquo;s payment terms.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="destructive" disabled={pending} onClick={confirm}>
            Merge and delete
          </Button>
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
      <p className="text-sm font-medium">Merge {locationName} into…</p>
      <Input
        placeholder="Location to keep…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      {matches.length ? (
        <ul className="max-w-sm divide-y rounded-md border text-sm">
          {matches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(c.id)}
                className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left hover:bg-muted focus-ring disabled:opacity-50"
              >
                <span>{c.name}</span>
                {c.region ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {c.region}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : q ? (
        <p className="text-sm text-muted-foreground">No matching locations.</p>
      ) : null}
    </div>
  );
}
