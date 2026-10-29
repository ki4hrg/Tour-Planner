"use client";

import { createContext, useContext } from "react";
import { FileSignature } from "lucide-react";
import type { VenueEngagementView } from "@/lib/venue-engagements";
import { BookingStepStrip, CompactProgress } from "./booking-progress";

// A trip's venue engagements (one booking per (trip, location)), provided once
// by the itinerary / day pages so every venue mention deep in the timeline can
// show — and advance — that venue's booking workflow without prop threading.
// Outside a provider (share page, print, overview) nothing renders, and the
// data is never loaded there. A site booked via a parent venue shows (and
// advances) the PARENT's engagement, marked "via <Parent>".

type Ctx = {
  tripId: string;
  canEdit: boolean;
  engagements: Record<string, VenueEngagementView>;
};

const VenueEngagementsContext = createContext<Ctx | null>(null);

export function VenueEngagementsProvider({
  tripId,
  canEdit,
  engagements,
  children,
}: Ctx & { children: React.ReactNode }) {
  return (
    <VenueEngagementsContext.Provider value={{ tripId, canEdit, engagements }}>
      {children}
    </VenueEngagementsContext.Provider>
  );
}

/** The parent venue a site is booked via, or null (own engagement / no provider). */
export function useVenueEngagementVia(
  locationId: string,
): { id: string; name: string } | null {
  return useContext(VenueEngagementsContext)?.engagements[locationId]?.via ?? null;
}

/**
 * A booking with nothing happening on it yet: no engagement, or one still
 * PENDING with no step ticked — or one marked not needed.
 */
export function isIdleEngagement(view: VenueEngagementView): boolean {
  const p = view.progress;
  if (!p.exists || p.status === "NOT_NEEDED") return true;
  return p.status === "PENDING" && p.completions.length === 0;
}

/** The venue's engagement status control, or nothing (no provider / not bookable). */
export function VenueEngagementStatus({
  locationId,
  name,
  compact = false,
  hideIdle = false,
}: {
  locationId: string;
  // The venue's name, heading the status popover so it's clear which venue's
  // booking it is (several venues can sit on one row).
  name?: string;
  // Itinerary rows: a booking icon instead of a word, and the next-step chip
  // only when it's our move — the step-by-step detail is on the Bookings tab.
  compact?: boolean;
  // Free-choice blocks: the sites are options, usually walk-ins, so a venue
  // shows its booking only once something has actually happened on it.
  hideIdle?: boolean;
}) {
  const ctx = useContext(VenueEngagementsContext);
  const view = ctx?.engagements[locationId];
  if (!ctx || !view) return null;
  if (hideIdle && isIdleEngagement(view)) return null;
  const title = `Booking · ${view.via ? view.via.name : (name ?? "venue")}`;
  const progress = (
    <CompactProgress
      target={{ tripId: ctx.tripId, locationId }}
      progress={view.progress}
      canEdit={ctx.canEdit}
      onlyOurMove={compact}
      title={name || view.via ? title : undefined}
    />
  );
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {compact ? (
        // The icon travels with the chips it labels when the row wraps; the
        // progress beside it shrinks and wraps instead.
        <span className="inline-flex min-w-0 items-start gap-1.5">
          <FileSignature
            className="mt-1 size-3.5 shrink-0 text-muted-foreground"
            role="img"
            aria-label="Booking"
          />
          <span className="min-w-0">{progress}</span>
        </span>
      ) : (
        progress
      )}
      {view.via ? (
        <span className="text-xs text-muted-foreground">via {view.via.name}</span>
      ) : null}
    </span>
  );
}

/** The venue's engagement with its whole step strip (roomier surfaces, e.g. the item editor). */
export function VenueEngagementSteps({
  locationId,
  name,
}: {
  locationId: string;
  name: string;
}) {
  const ctx = useContext(VenueEngagementsContext);
  const view = ctx?.engagements[locationId];
  if (!ctx || !view) return null;
  return (
    <BookingStepStrip
      name={view.via ? view.via.name : name}
      target={{ tripId: ctx.tripId, locationId }}
      progress={view.progress}
      canEdit={ctx.canEdit}
    />
  );
}
