"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
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
import { type SerializedDay } from "@/lib/trips";
import { TimelineGroups } from "./itinerary-timeline";

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
}: {
  tripId: string;
  canEdit: boolean;
  days: SerializedDay[];
}) {
  // Default: open the first day so the panel isn't a wall of collapsed rows.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(days.length ? [days[0].id] : []),
  );

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
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Itinerary</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {days.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={toggleAll}>
              {allOpen ? "Collapse all" : "Expand all"}
            </Button>
          ) : null}
          <Button asChild size="sm" variant="outline">
            <Link href={`/trips/${tripId}/booking`}>Booking</Link>
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
          <p className="text-muted-foreground">
            No days yet.{" "}
            {canEdit ? "Open the itinerary editor to add days." : ""}
          </p>
        ) : (
          <ol className="divide-y">
            {days.map((day) => (
              <DayRow
                key={day.id}
                day={day}
                open={open.has(day.id)}
                onToggle={() => toggleDay(day.id)}
              />
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DayRow({
  day,
  open,
  onToggle,
}: {
  day: SerializedDay;
  open: boolean;
  onToggle: () => void;
}) {
  const allSites = daySites(day);
  const { head, overflow } = siteRollup(allSites);
  const count = day.items.length;

  return (
    <li className="py-1">
      <Collapsible open={open} onOpenChange={onToggle}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md py-1.5 text-left hover:bg-muted/50">
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="font-medium">Day {day.dayIndex}</span>
            {day.title ? ` — ${day.title}` : ""}
            {day.date ? (
              <span className="text-muted-foreground"> · {formatDate(day.date)}</span>
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
        </CollapsibleTrigger>
        <CollapsibleContent>
          {count === 0 ? (
            <p className="py-2 pl-6 text-xs text-muted-foreground">
              Nothing scheduled.
            </p>
          ) : (
            <div className="ml-[7px] border-l pt-1 pb-4 pl-4">
              <TimelineGroups items={day.items} />
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

