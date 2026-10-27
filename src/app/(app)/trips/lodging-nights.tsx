import type { BookingStatus } from "@prisma/client";
import { Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { isBookingSecured } from "@/lib/booking";
import { BOOKING_STATUS_CLASSES, bookingStageText } from "@/lib/trips";

// Short night label — the year is noise in a strip of consecutive nights.
const NIGHT_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function nightLabel(date: Date | null, dayIndex: number): string {
  return date ? NIGHT_FMT.format(date) : `Night ${dayIndex}`;
}

export type NightCell = {
  dayId: string;
  // "Mon 6 Jul" on a dated trip, "Night 1" on a template.
  label: string;
  stayId: string | null;
  venue: string | null;
  // The venue engagement's status; null (shown as Planned) when the stay's
  // venue has no engagement yet.
  status: BookingStatus | null;
  stageLabel: string | null; // the engagement's workflow stage, when it has one
  // Stays covering this night (>1 = an overlap worth a second look).
  covering: number;
};

// Night-by-night lodging coverage at the top of the Lodging card: where the
// group sleeps each night, how firm that booking is, and which nights have no
// bed at all. Server-rendered; each covered cell jumps to its stay row.
export function LodgingNights({ nights }: { nights: NightCell[] }) {
  if (nights.length === 0) return null;

  const covered = nights.filter((n) => n.stayId).length;
  const unconfirmed = nights.filter(
    (n) => n.stayId && !(n.status && isBookingSecured(n.status)),
  ).length;

  return (
    <div className="space-y-2">
      <p className="text-sm">
        <span
          className={cn(
            "font-medium",
            covered < nights.length && "text-red-700 dark:text-red-400",
          )}
        >
          {covered} of {nights.length} night{nights.length === 1 ? "" : "s"}{" "}
          covered
        </span>
        {unconfirmed > 0 ? (
          <span className="text-muted-foreground">
            {" "}
            · {unconfirmed} unconfirmed
          </span>
        ) : null}
      </p>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-1.5">
        {nights.map((n) => {
          const body = (
            <>
              <span className="block text-[11px] text-muted-foreground">
                {n.label}
              </span>
              {n.venue ? (
                <>
                  <span className="block truncate text-xs font-medium">
                    {n.venue}
                  </span>
                  <span
                    className={cn(
                      "mt-1 inline-block rounded-full px-1.5 text-[10px] font-medium",
                      BOOKING_STATUS_CLASSES[n.status ?? "PLANNED"],
                    )}
                  >
                    {bookingStageText({
                      status: n.status ?? "PLANNED",
                      stageLabel: n.stageLabel,
                    })}
                  </span>
                  {n.covering > 1 ? (
                    <span className="block text-[10px] text-muted-foreground">
                      +{n.covering - 1} overlapping stay
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-red-700 dark:text-red-400">
                  <Moon className="size-3 shrink-0" />
                  No lodging
                </span>
              )}
            </>
          );
          return (
            <li key={n.dayId}>
              {n.stayId ? (
                <a
                  href={`#stay-${n.stayId}`}
                  className="block h-full rounded-md border p-2 hover:bg-muted/50"
                >
                  {body}
                </a>
              ) : (
                <div className="h-full rounded-md border border-dashed border-red-300 bg-red-50/60 p-2 dark:border-red-900 dark:bg-red-950/30">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
