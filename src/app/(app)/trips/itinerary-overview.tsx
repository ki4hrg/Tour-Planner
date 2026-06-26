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
import {
  effectivePresenters,
  type SerializedDay,
  type SerializedScheduleItem,
} from "@/lib/trips";

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

// "Rome · Vatican +2" — first two distinct sites, with an overflow count.
function siteRollup(names: string[]): string {
  if (names.length === 0) return "";
  const head = names.slice(0, 2).join(" · ");
  return names.length > 2 ? `${head} +${names.length - 2}` : head;
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
  const sites = siteRollup(daySites(day));
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
          {sites ? (
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              {sites}
            </span>
          ) : null}
          <span className="shrink-0 text-xs text-muted-foreground">
            {count} item{count === 1 ? "" : "s"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {count === 0 ? (
            <p className="py-2 pl-6 text-xs text-muted-foreground">
              Nothing scheduled.
            </p>
          ) : (
            <ul className="ml-[7px] space-y-1 border-l py-1 pl-4">
              {day.items.map((item) => (
                <TimelineItem key={item.id} item={item} />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function TimelineItem({ item }: { item: SerializedScheduleItem }) {
  const time = [item.startTime, item.endTime].filter(Boolean).join("–");
  const locationNames = item.sites.map((s) => s.location.name);
  const speakers = effectivePresenters(item);
  const primary =
    item.title ??
    (item.sites.length === 1
      ? locationNames[0]
      : item.isBlock
        ? `Choose from ${item.sites.length} locations`
        : item.sites.length > 1
          ? `${item.sites.length} locations`
          : "Untitled item");
  const locationIsPrimary =
    item.sites.length === 1 && !item.title && !item.isBlock;

  return (
    <li className="py-0.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {time ? (
          <time className="font-mono text-xs tabular-nums text-muted-foreground">
            {time}
          </time>
        ) : null}
        {item.category ? (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{
              color: item.category.color ?? "var(--muted-foreground)",
              backgroundColor: item.category.color
                ? `color-mix(in oklab, ${item.category.color} 14%, transparent)`
                : "var(--muted)",
            }}
          >
            {item.category.name}
          </span>
        ) : null}
        <span className="font-medium">{primary}</span>
      </div>
      {(!locationIsPrimary && locationNames.length > 0) ||
      speakers.length > 0 ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {!locationIsPrimary && locationNames.length > 0 ? (
            <span>{locationNames.join(" · ")}</span>
          ) : null}
          {speakers.length > 0 ? (
            <span>· {speakers.map((p) => p.name).join(", ")}</span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
