"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { regionOptions, type RegionNode } from "@/lib/regions";
import { RegionForm } from "./region-form";
import { updateRegion, deleteRegion } from "./actions";

export type RegionRow = RegionNode & {
  dialCode: string | null;
  tripTypes: { id: string; name: string }[];
  locationCount: number;
  childCount: number;
};

export function RegionsManager({
  regions,
  tripTypes,
}: {
  regions: RegionRow[];
  tripTypes: { id: string; name: string }[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (regions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No regions yet — add one above (e.g. England, then London under it).
      </p>
    );
  }

  // Order by hierarchy path so children read beneath their parents.
  const order = new Map(regionOptions(regions).map((o, i) => [o.id, i]));
  const labelOf = new Map(regionOptions(regions).map((o) => [o.id, o.label]));
  const sorted = [...regions].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
  );

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {sorted.map((r) => (
        <li key={r.id} className="p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="font-medium">{labelOf.get(r.id) ?? r.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {r.locationCount} location{r.locationCount === 1 ? "" : "s"}
                {r.childCount > 0
                  ? ` · ${r.childCount} sub-region${r.childCount === 1 ? "" : "s"}`
                  : ""}
                {r.dialCode ? ` · +${r.dialCode}` : ""}
              </span>
              {r.tripTypes.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.tripTypes.map((t) => (
                    <Badge key={t.id} variant="secondary">
                      {t.name}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setEditingId((id) => (id === r.id ? null : r.id))
                }
              >
                {editingId === r.id ? "Close" : "Edit"}
              </Button>
              <form action={deleteRegion}>
                <input type="hidden" name="id" value={r.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                >
                  Delete
                </Button>
              </form>
            </div>
          </div>
          {editingId === r.id ? (
            <div className="mt-3">
              <RegionForm
                action={updateRegion}
                submitLabel="Save"
                regions={regions}
                tripTypes={tripTypes}
                initial={{
                  id: r.id,
                  name: r.name,
                  parentId: r.parentId,
                  tripTypeIds: r.tripTypes.map((t) => t.id),
                  dialCode: r.dialCode,
                }}
                onSaved={() => setEditingId(null)}
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
