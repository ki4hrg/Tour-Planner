"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, MapPin, Moon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { type DayLodgingSummary, type SerializedDay } from "@/lib/trips";
import { OvernightLine, TimelineGroups } from "./itinerary-timeline";

// Distinct location names visited across a day's items, in first-seen order.
function daySites(day: SerializedDay): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const item of day.items) {
    for (const site of item.sites) {
      if (!seen.has(site.location.name)) {
        seen.add(site.location.name);
        names.push(site.location.name);
      }
    }
  }
  return names;
}

// The day's distinct sites split into a shown head + an overflow remainder, so
// the header can render "Rome · Vatican · Assisi · Siena +1" with the "+1"
// carrying a tooltip of the full list.
const SITE_ROLLUP_MAX = 4;
function siteRollup(names: string[]): { head: string[]; overflow: string[] } {
  return {
    head: names.slice(0, SITE_ROLLUP_MAX),
    overflow: names.slice(SITE_ROLLUP_MAX),
  };
}

export function ItineraryOverview({
  tripId,
  canEdit,
  days,
  lodgingByDay,
  cityByDay,
  currentDayId,
}: {
  tripId: string;
  canEdit: boolean;
  days: SerializedDay[];
  lodgingByDay?: Record<string, DayLodgingSummary | null>;
  cityByDay?: Record<string, string | null>;
  // When the trip is happening now, the id of the day that falls on today — so we
  // open straight to it instead of day 1. Null/absent → default to the first day.
  currentDayId?: string | null;
}) {
  // Default: open today's day if the trip is in progress, else the first day, so
  // the panel isn't a wall of collapsed rows.
  const [open, setOpen] = useState<Set<string>>(() => {
    if (currentDayId && days.some((d) => d.id === currentDayId)) {
      return new Set([currentDayId]);
    }
    return new Set(days.length ? [days[0].id] : []);
  });

  const allOpen = days.length > 0 && open.size === days.length;
  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(days.map((d) => d.id)));
  const toggleDay = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <CardTitle>Itinerary</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {days.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={toggleAll}>
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          ) : null}
          {days.length > 0 ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/trips/${tripId}/today`}>Today</Link>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={`/trips/${tripId}/print`}>Print</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/trips/${tripId}/itinerary`}>
              {canEdit ? "Edit itinerary" : "View itinerary"}
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="text-sm">
        {days.length === 0 ? (
          <p className="text-muted-foreground">No days.</p>
        ) : (
          <ol className="divide-y">
            {days.map((day, i) => (
              <DayRow
                key={day.id}
                tripId={tripId}
                day={day}
                open={open.has(day.id)}
                onToggle={() => toggleDay(day.id)}
                lodging={lodgingByDay?.[day.id] ?? null}
                city={cityByDay?.[day.id] ?? null}
                // The last day is departure — it has no night to cover.
                hasNight={lodgingByDay != null && i < days.length - 1}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DayRow({
  tripId,
  day,
  open,
  onToggle,
  lodging,
  city,
  hasNight,
}: {
  tripId: string;
  day: SerializedDay;
  open: boolean;
  onToggle: () => void;
  lodging: DayLodgingSummary | null;
  city: string | null;
  hasNight: boolean;
}) {
  const allSites = daySites(day);
  const { head, overflow } = siteRollup(allSites);
  const count = day.items.length;

  // Rough-plan locations (GH #9) not already visited by a timed item — a loose
  // "planned" cluster distinct from the timed route. A note qualifies the name.
  const plannedNames = (day.plannedLocations ?? [])
    .filter((p) => !allSites.includes(p.name))
    .map((p) => (p.note ? `${p.name} (${p.note})` : p.name));

  return (
    <li className="py-1">
      <Collapsible open={open} onOpenChange={onToggle}>
        {/* The chevron is the real (keyboard-reachable) toggle; the rest of the
            row toggles on tap as a pointer convenience, except the day title,
            which links to the day page — an <a> can't sit inside the trigger
            <button>, so the title lives beside it, not in it.
            <sm the location roll-up drops to its own line under the title —
            sharing one flex row squeezes the title into one-word-per-line
            wrapping that collides with the location text. */}
        <div className="flex items-start gap-1 rounded-md hover:bg-muted/50">
          <CollapsibleTrigger
            className="flex min-h-10 min-w-10 shrink-0 items-center justify-center"
            aria-label={`${open ? "Collapse" : "Expand"} day ${day.dayIndex}`}
          >
            <ChevronRight
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                open && "rotate-90",
              )}
            />
          </CollapsibleTrigger>
          <div
            onClick={onToggle}
            className="min-w-0 flex-1 cursor-pointer py-1.5 sm:flex sm:items-baseline sm:justify-between sm:gap-3"
          >
            <span className="block">
              <Link
                href={`/trips/${tripId}/days/${day.id}`}
                onClick={(e) => e.stopPropagation()}
                className="link-quiet"
              >
                <span className="font-medium">Day {day.dayIndex}</span>
                {day.title ? ` — ${day.title}` : ""}
              </Link>
              {day.date ? (
                <span className="text-muted-foreground"> · {formatDate(day.date)}</span>
              ) : null}
              {city ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="size-3 shrink-0" />
                  {city}
                </span>
              ) : null}
              {/* Where the group sleeps, visible without expanding the day —
                  and a loud gap when a night has no stay. Once open, the
                  day's closing Overnight line says it, so skip it here. */}
              {lodging ? (
                open ? null : (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Moon className="size-3 shrink-0" />
                    {lodging.locationName}
                  </span>
                )
              ) : hasNight ? (
                <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                  <Moon className="size-3 shrink-0" />
                  No lodging
                </span>
              ) : null}
            </span>
            {allSites.length > 0 ? (
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate">{head.join(" · ")}</span>
                {overflow.length > 0 ? (
                  <span
                    title={allSites.join(", ")}
                    className="shrink-0 cursor-help underline decoration-dotted underline-offset-2"
                  >
                    +{overflow.length}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
        <CollapsibleContent>
          <div className="ml-[7px] space-y-3 border-l pt-1 pb-4 pl-4">
            {plannedNames.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">Planned:</span>{" "}
                {plannedNames.join(" · ")}
              </p>
            ) : null}
            {count === 0 ? (
              <>
                <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
                {lodging ? <OvernightLine lodging={lodging} /> : null}
              </>
            ) : (
              <TimelineGroups items={day.items} lodging={lodging} linkVenues showGaps />
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

