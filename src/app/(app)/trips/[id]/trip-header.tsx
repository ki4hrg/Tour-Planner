"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TemplateChip } from "../template-chip";
import { BackLink } from "@/components/back-link";

// Field and print views have their own chrome.
const BARE_SEGMENTS = ["print", "today", "days"];

export function TripHeader({
  tripId,
  name,
  isTemplate,
  lifecycleLabel,
  tripTypeId,
  tripTypeName,
  dateRange,
}: {
  tripId: string;
  name: string;
  isTemplate: boolean;
  lifecycleLabel: string;
  tripTypeId: string;
  tripTypeName: string;
  dateRange: string | null;
}) {
  const pathname = usePathname();
  const base = `/trips/${tripId}`;
  const segment = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split("/")[0]
    : "";
  if (BARE_SEGMENTS.includes(segment)) return null;

  const tabs = [
    { href: base, label: "Overview", active: segment === "" },
    { href: `${base}/itinerary`, label: "Itinerary", active: segment === "itinerary" },
    { href: `${base}/booking`, label: "Bookings", active: segment === "booking" },
  ];

  return (
    <header className="space-y-3 print:hidden">
      <BackLink href="/trips" label="All trips" />
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold text-balance sm:text-2xl">{name}</h1>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {isTemplate ? (
            <TemplateChip />
          ) : (
            <Badge variant="secondary">{lifecycleLabel}</Badge>
          )}
          <span>{tripTypeName}</span>
          {dateRange ? (
            <>
              <span aria-hidden>·</span>
              <span>{dateRange}</span>
            </>
          ) : null}
          {!isTemplate ? (
            <Link
              href={`/trips/compare?type=${tripTypeId}`}
              className="link-quiet sm:ml-auto"
            >
              Compare years
            </Link>
          ) : null}
        </div>
      </div>
      <nav
        aria-label="Trip sections"
        className="-mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0"
      >
        <ul className="flex gap-1">
          {tabs.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={t.active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-block border-b-2 px-3 py-2 text-sm whitespace-nowrap",
                  t.active
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
