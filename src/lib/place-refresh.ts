// Keeps stored Google place IDs fresh. Google recommends re-resolving IDs older
// than 12 months: the id-only Place Details call is free and returns the current
// ID (IDs can change), or NOT_FOUND once the place is gone. A dropped place is
// cleared and flagged for a human to re-link (the admin Google places page) —
// never re-guessed. No revalidatePath here, so it's safe from the background
// scheduler and MCP alike.

import { prisma } from "@/lib/db";
import { placesEnabled, refreshPlaceId } from "@/lib/google-places";

export const PLACE_ID_MAX_AGE_DAYS = 365;

export type PlaceRefreshSummary = {
  checked: number;
  changed: number;
  notFound: number;
  failed: number;
};

export function placeIdStaleBefore(now: Date): Date {
  return new Date(now.getTime() - PLACE_ID_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
}

export async function refreshStalePlaceIds({
  limit = 100,
  now = new Date(),
}: { limit?: number; now?: Date } = {}): Promise<PlaceRefreshSummary> {
  const summary: PlaceRefreshSummary = { checked: 0, changed: 0, notFound: 0, failed: 0 };
  if (!placesEnabled()) return summary;

  const stale = await prisma.location.findMany({
    where: {
      googlePlaceId: { not: null },
      OR: [
        { placeIdCheckedAt: null },
        { placeIdCheckedAt: { lt: placeIdStaleBefore(now) } },
      ],
    },
    orderBy: { placeIdCheckedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true, googlePlaceId: true },
  });

  for (const loc of stale) {
    const placeId = loc.googlePlaceId!;
    try {
      const result = await refreshPlaceId(placeId);
      summary.checked++;
      if (result.status === "not_found") {
        summary.notFound++;
        // Clear only the ID — coordinates are still a usable map pin — and
        // leave the rest to a human.
        await prisma.location.update({
          where: { id: loc.id },
          data: { googlePlaceId: null, placeIdCheckedAt: now, placeIdNeedsReview: true },
        });
      } else {
        if (result.placeId !== placeId) summary.changed++;
        await prisma.location.update({
          where: { id: loc.id },
          data: { googlePlaceId: result.placeId, placeIdCheckedAt: now },
        });
      }
    } catch (err) {
      // Quota / network / auth: leave the row as-is so the next run retries it.
      summary.failed++;
      console.error(`[place-refresh] ${loc.id}:`, err);
    }
  }
  return summary;
}

// In-process daily scheduler, started from src/instrumentation.ts. The app runs
// as a single long-lived container, so a timer is enough — no external cron.
// Guarded on globalThis so dev hot reloads don't stack intervals.
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

export function startPlaceRefreshScheduler(): void {
  if (!placesEnabled()) return;
  const g = globalThis as unknown as { __placeRefreshTimer?: NodeJS.Timeout };
  if (g.__placeRefreshTimer) return;

  const run = () => {
    refreshStalePlaceIds()
      .then((s) => {
        if (s.checked || s.failed) console.log("[place-refresh]", s);
      })
      .catch((err) => console.error("[place-refresh] run failed:", err));
  };
  setTimeout(run, FIRST_RUN_DELAY_MS).unref();
  g.__placeRefreshTimer = setInterval(run, DAY_MS);
  g.__placeRefreshTimer.unref();
}
