"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLocationBookedVia } from "./actions";

const NONE = "__none__";

type Ref = { id: string; name: string };

// "Booked via": the parent venue whose single engagement covers this site
// (a museum booking covering several of its sites). Single level — a site
// that covers others lists them instead and can't take a parent itself.
// Picking a parent when this site already holds bookings asks first: they
// move to the parent's engagement.
export function LocationBookedVia({
  locationId,
  bookedVia,
  coveredSites,
  candidates,
  foldTrips,
  canEdit,
}: {
  locationId: string;
  bookedVia: Ref | null;
  coveredSites: Ref[];
  candidates: Ref[]; // eligible parents (bookable, not themselves children)
  foldTrips: string[]; // trips where this site has its own engagement
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<Ref | null>(null);

  const save = (parentId: string | null) =>
    start(async () => {
      const res = await setLocationBookedVia(locationId, parentId);
      setConfirming(null);
      if (res.error) toast.error(res.error);
      else if (res.message) toast.success(res.message);
    });

  if (coveredSites.length > 0) {
    return (
      <div className="text-sm">
        <ul className="space-y-0.5">
          {coveredSites.map((c) => (
            <li key={c.id}>
              <Link href={`/locations/${c.id}`} className="link-quiet">
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!canEdit) {
    return bookedVia ? (
      <Link href={`/locations/${bookedVia.id}`} className="text-sm link-quiet">
        {bookedVia.name}
      </Link>
    ) : (
      <p className="text-sm">—</p>
    );
  }

  if (confirming) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          Moves {foldTrips.length} booking{foldTrips.length === 1 ? "" : "s"} (
          {foldTrips.join(", ")}) to {confirming.name}.
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => save(confirming.id)}>
            Move
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirming(null)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={bookedVia?.id ?? NONE}
        disabled={pending}
        onValueChange={(v) => {
          if (v === NONE) return save(null);
          const parent = candidates.find((c) => c.id === v);
          if (!parent) return;
          if (foldTrips.length > 0) setConfirming(parent);
          else save(parent.id);
        }}
      >
        <SelectTrigger className="w-full sm:w-72" aria-label="Booked via">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>—</SelectItem>
          {candidates.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {bookedVia ? (
        <Link
          href={`/locations/${bookedVia.id}`}
          className="text-xs text-muted-foreground link-quiet"
        >
          Open {bookedVia.name}
        </Link>
      ) : null}
    </div>
  );
}
