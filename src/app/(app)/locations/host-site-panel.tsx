"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormState } from "@/lib/forms";
import { markAsHostSite, updateHostSite, unmarkHostSite } from "./actions";

type HostSiteData = {
  id: string;
  providesLodging: boolean;
  providesMeals: boolean;
  providesMeetingSpace: boolean;
  staffNotes: string | null;
  logisticsNotes: string | null;
};

// Run a FormState-returning action, surfacing the result as a toast (no effects —
// this codebase forbids setState inside useEffect).
function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>, onOk?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        if (res.message) toast.success(res.message);
        onOk?.();
      }
    });
  return { pending, run };
}

export function HostSitePanel({
  locationId,
  hostSite,
  canEdit,
}: {
  locationId: string;
  hostSite: HostSiteData | null;
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const [isEditing, setIsEditing] = useState(false);

  const [providesLodging, setProvidesLodging] = useState(
    hostSite?.providesLodging ?? false,
  );
  const [providesMeals, setProvidesMeals] = useState(
    hostSite?.providesMeals ?? false,
  );
  const [providesMeetingSpace, setProvidesMeetingSpace] = useState(
    hostSite?.providesMeetingSpace ?? false,
  );
  const [staffNotes, setStaffNotes] = useState(hostSite?.staffNotes ?? "");
  const [logisticsNotes, setLogisticsNotes] = useState(
    hostSite?.logisticsNotes ?? "",
  );

  // Hidden from non-editors when there's nothing to show.
  if (!hostSite && !canEdit) return null;

  if (!hostSite) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Not a host site. Mark it as one to record lodging/meals capability and
          staff logistics.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => markAsHostSite(locationId))}
        >
          Mark as host site
        </Button>
      </div>
    );
  }

  if (isEditing && canEdit) {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={providesLodging}
              onCheckedChange={(v) => setProvidesLodging(v === true)}
            />
            Provides lodging
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={providesMeals}
              onCheckedChange={(v) => setProvidesMeals(v === true)}
            />
            Provides meals
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox
              checked={providesMeetingSpace}
              onCheckedChange={(v) => setProvidesMeetingSpace(v === true)}
            />
            Provides meeting space
          </label>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Staff notes</Label>
          <Textarea
            rows={3}
            value={staffNotes}
            onChange={(e) => setStaffNotes(e.target.value)}
            placeholder="Internal notes for staff…"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Logistics notes</Label>
          <Textarea
            rows={3}
            value={logisticsNotes}
            onChange={(e) => setLogisticsNotes(e.target.value)}
            placeholder="Special requirements, access info, etc…"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  updateHostSite(locationId, {
                    providesLodging,
                    providesMeals,
                    providesMeetingSpace,
                    staffNotes,
                    logisticsNotes,
                  }),
                () => setIsEditing(false),
              )
            }
          >
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => setIsEditing(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Lodging</dt>
          <dd className="font-medium">
            {hostSite.providesLodging ? "Yes" : "No"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Meals</dt>
          <dd className="font-medium">
            {hostSite.providesMeals ? "Yes" : "No"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Meeting space</dt>
          <dd className="font-medium">
            {hostSite.providesMeetingSpace ? "Yes" : "No"}
          </dd>
        </div>
      </div>

      {hostSite.staffNotes ? (
        <div className="text-sm">
          <dt className="text-muted-foreground">Staff notes</dt>
          <dd className="mt-1 whitespace-pre-wrap">{hostSite.staffNotes}</dd>
        </div>
      ) : null}

      {hostSite.logisticsNotes ? (
        <div className="text-sm">
          <dt className="text-muted-foreground">Logistics notes</dt>
          <dd className="mt-1 whitespace-pre-wrap">{hostSite.logisticsNotes}</dd>
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={pending}
            onClick={() => run(() => unmarkHostSite(locationId))}
          >
            Remove host-site status
          </Button>
        </div>
      ) : null}
    </div>
  );
}
