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

/** The venue's engagement status control, or nothing (no provider / not bookable). */
export function VenueEngagementStatus({
  locationId,
  labelled = false,
}: {
  locationId: string;
  // Lead with "Booking" where the row also shows an item's own status, so the
  // venue's booking progress isn't mistaken for it.
  labelled?: boolean;
}) {
  const ctx = useContext(VenueEngagementsContext);
  const view = ctx?.engagements[locationId];
  if (!ctx || !view) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {labelled ? (
        // The label travels with the chip it names when the row wraps.
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
            <FileSignature className="size-3.5" aria-hidden />
            Booking
          </span>
          <CompactProgress
            target={{ tripId: ctx.tripId, locationId }}
            progress={view.progress}
            canEdit={ctx.canEdit}
          />
        </span>
      ) : (
        <CompactProgress
          target={{ tripId: ctx.tripId, locationId }}
          progress={view.progress}
          canEdit={ctx.canEdit}
        />
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
