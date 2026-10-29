"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAction } from "@/lib/use-action";
import { SearchPicker, type PickerOption } from "./search-picker";
import { linkLocationToContact, unlinkLocationFromContact } from "./actions";

type LinkedLocation = { id: string; name: string; region: string | null };

// The Contact page side of the Location ⇄ Contact links. Mirrors
// LocationContactsManager: unlinking a venue's primary contact clears it.
export function ContactLocationsManager({
  contactId,
  linked,
  available,
  primaryForIds,
  canEdit,
}: {
  contactId: string;
  linked: LinkedLocation[];
  available: PickerOption[];
  primaryForIds: string[];
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const primary = new Set(primaryForIds);

  const link = (locationId: string) => {
    setBusyId(locationId);
    run(() => linkLocationToContact(contactId, locationId), () => setAdding(false));
  };
  const unlink = (locationId: string) => {
    setBusyId(locationId);
    run(() => unlinkLocationFromContact(contactId, locationId));
  };

  return (
    <div className="space-y-3 text-sm">
      {linked.length ? (
        <ul className="divide-y">
          {linked.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5"
            >
              <div className="min-w-0">
                <Link href={`/locations/${l.id}`} className="link-quiet">
                  {l.name}
                </Link>
                {l.region ? (
                  <span className="text-muted-foreground"> · {l.region}</span>
                ) : null}
                {primary.has(l.id) ? (
                  <Badge variant="secondary" className="ml-2 align-middle">
                    Primary
                  </Badge>
                ) : null}
              </div>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => unlink(l.id)}
                >
                  {pending && busyId === l.id ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  Unlink
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">No locations.</p>
      )}

      {canEdit ? (
        adding ? (
          <div className="space-y-2">
            <SearchPicker
              options={available}
              placeholder="Location to link…"
              emptyText="No matching locations."
              onPick={link}
              disabled={pending}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              {pending ? (
                <Loader2
                  className="size-4 animate-spin text-muted-foreground"
                  aria-label="Saving"
                />
              ) : null}
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={available.length === 0}
            onClick={() => setAdding(true)}
          >
            + Add location
          </Button>
        )
      ) : null}
    </div>
  );
}
