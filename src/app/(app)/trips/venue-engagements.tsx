"use client";

import { createContext, useContext } from "react";
import type { BookingProgressView } from "@/lib/booking-workflow";
import { BookingStepStrip, CompactProgress } from "./booking-progress";

// A trip's venue engagements (one booking per (trip, location)), provided once
// by the itinerary / day pages so every venue mention deep in the timeline can
// show — and advance — that venue's booking workflow without prop threading.
// Outside a provider (share page, print, overview) nothing renders, and the
// data is never loaded there.

type Ctx = {
  tripId: string;
  canEdit: boolean;
  engagements: Record<string, BookingProgressView>;
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

/** The venue's engagement status control, or nothing (no provider / not bookable). */
export function VenueEngagementStatus({ locationId }: { locationId: string }) {
  const ctx = useContext(VenueEngagementsContext);
  const progress = ctx?.engagements[locationId];
  if (!ctx || !progress) return null;
  return (
    <CompactProgress
      target={{ tripId: ctx.tripId, locationId }}
      progress={progress}
      canEdit={ctx.canEdit}
    />
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
  const progress = ctx?.engagements[locationId];
  if (!ctx || !progress) return null;
  return (
    <BookingStepStrip
      name={name}
      target={{ tripId: ctx.tripId, locationId }}
      progress={progress}
      canEdit={ctx.canEdit}
    />
  );
}
