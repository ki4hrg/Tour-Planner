"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { googlePlaceHref } from "@/lib/maps";
import type { PlaceDetails } from "@/lib/google-places";
import type { FormState } from "@/lib/forms";
import {
  acceptPlaceCandidate,
  dismissPlaceReview,
  findPlaceCandidates,
  refreshPlaceIdsNow,
} from "./actions";

type Row = {
  id: string;
  name: string;
  address: string | null;
  region: string | null;
  hasCoords: boolean;
  needsReview: boolean;
};

function report(res: FormState) {
  if (res.error) toast.error(res.error);
  if (res.message) (res.ok ? toast.success : toast.info)(res.message);
}

export function PlacesBackfill({
  enabled,
  linkedCount,
  dueCount,
  locations,
}: {
  enabled: boolean;
  linkedCount: number;
  dueCount: number;
  locations: Row[];
}) {
  const [refreshing, startRefresh] = useTransition();

  if (!enabled) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Google Places not configured: set <code>GOOGLE_MAPS_API_KEY</code>{" "}
          (server key with <em>Places API (New)</em> enabled) and restart.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Place ID refresh</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {linkedCount} linked · {dueCount} due for refresh.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => startRefresh(async () => report(await refreshPlaceIdsNow()))}
          >
            {refreshing ? "Refreshing…" : "Refresh now"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Unlinked locations ({locations.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {locations.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">
              All active locations linked.
            </p>
          ) : (
            locations.map((l) => <BackfillRow key={l.id} row={l} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BackfillRow({ row }: { row: Row }) {
  const [candidates, setCandidates] = useState<PlaceDetails[] | null>(null);
  const [pending, start] = useTransition();

  function search() {
    start(async () => {
      const res = await findPlaceCandidates(row.id);
      if (res.error) toast.error(res.error);
      setCandidates(res.candidates ?? []);
    });
  }

  function accept(c: PlaceDetails, fillAddress: boolean) {
    start(async () => {
      const res = await acceptPlaceCandidate({
        locationId: row.id,
        placeId: c.placeId,
        lat: c.lat,
        lng: c.lng,
        address: c.address,
        fillAddress,
      });
      report(res);
      // On success the row drops out of the list when the page revalidates.
    });
  }

  return (
    <div className="space-y-3 px-6 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-sm">
          <a href={`/locations/${row.id}`} className="font-medium link-quiet">
            {row.name}
          </a>
          {row.needsReview ? (
            <Badge variant="destructive" className="ml-2">
              Dropped by Google
            </Badge>
          ) : null}
          <div className="text-xs text-muted-foreground">
            {[row.address, row.region].filter(Boolean).join(" · ") || "No address"}
            {row.hasCoords ? " · has coordinates" : ""}
          </div>
        </div>
        <div className="flex gap-2">
          {row.needsReview ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => start(async () => report(await dismissPlaceReview(row.id)))}
            >
              Dismiss
            </Button>
          ) : null}
          <Button variant="outline" size="sm" disabled={pending} onClick={search}>
            {pending && !candidates ? "Searching…" : candidates ? "Search again" : "Find matches"}
          </Button>
        </div>
      </div>

      {candidates ? (
        candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No matches.{" "}
            <a href={`/locations/${row.id}`} className="link-quiet">
              Link by hand
            </a>
          </p>
        ) : (
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li
                key={c.placeId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">{c.name ?? "(unnamed place)"}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.address ?? "No address"}
                    <a
                      href={googlePlaceHref(c.name ?? row.name, c.placeId)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center gap-0.5 link-quiet hover:text-foreground"
                    >
                      Open in Maps <ExternalLink className="size-3" />
                    </a>
                  </div>
                </div>
                <div className="flex gap-2">
                  {!row.address && c.address ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => accept(c, true)}
                    >
                      Accept + use address
                    </Button>
                  ) : null}
                  <Button size="sm" disabled={pending} onClick={() => accept(c, false)}>
                    Accept
                  </Button>
                </div>
              </li>
            ))}
            <li>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => setCandidates(null)}
              >
                None of these
              </Button>
            </li>
          </ul>
        )
      ) : null}
    </div>
  );
}
