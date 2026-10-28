/**
 * Maps a trip (its dated days, schedule items, and lodging stays) into iCalendar
 * events for a subscribable feed. Pure — takes serialized data, returns IcsEvents.
 *
 * Event set per trip:
 *  - a whole-trip all-day banner across [startDate, endDate] (exclusive DTEND);
 *  - a per-day all-day event ONLY when the day carries notes (or a title alongside
 *    notes), so day-level (incl. staff logistical) notes surface without a banner
 *    on every date;
 *  - one event per schedule item — timed floating when it has a start time, else
 *    all-day;
 *  - a multi-day all-day event per lodging stay ([checkIn, checkOut), which already
 *    matches iCalendar's exclusive end).
 *
 * Date-less template trips/days (no calendar date) produce nothing — there's
 * nothing to anchor to.
 */

import { addDays, parseDateInput, toDateInput } from "./dates";
import {
  scheduleItemPrimaryLabel,
  effectivePresenters,
  travelRoute,
} from "./trips";
import type { SerializedDay } from "./trips";
import { toIcsDate, toIcsFloatingDateTime, type IcsEvent } from "./ics";

// UID namespace — stable across regenerations so subscribers update, not duplicate.
const UID_DOMAIN = "tour-planner";

export interface FeedStay {
  id: string;
  locationName: string;
  checkIn: string | null; // "YYYY-MM-DD" (dated trips only)
  checkOut: string | null; // "YYYY-MM-DD"; the departure morning (exclusive)
  notes: string | null;
}

export interface FeedTrip {
  id: string;
  name: string;
  notes: string | null;
  startDate: string | null; // "YYYY-MM-DD"
  endDate: string | null;
  days: SerializedDay[];
  stays: FeedStay[];
}

export interface BuildFeedOptions {
  /** Staff-detail feeds fold day logisticalNotes into event descriptions. */
  includeLogisticalNotes: boolean;
}

/** The day after a "YYYY-MM-DD" date, for an exclusive all-day DTEND. */
function nextDay(ymd: string): string {
  const d = parseDateInput(ymd);
  return d ? toDateInput(addDays(d, 1)) : ymd;
}

function joinLines(parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return kept.length ? kept.join("\n") : undefined;
}

function uid(kind: string, id: string): string {
  return `${kind}-${id}@${UID_DOMAIN}`;
}

/** Build all iCalendar events for one trip. */
export function buildTripEvents(
  trip: FeedTrip,
  opts: BuildFeedOptions,
): IcsEvent[] {
  const events: IcsEvent[] = [];

  // Whole-trip banner.
  if (trip.startDate && trip.endDate) {
    events.push({
      uid: uid("trip", trip.id),
      summary: trip.name,
      description: trip.notes ?? undefined,
      start: toIcsDate(trip.startDate),
      end: toIcsDate(nextDay(trip.endDate)),
      allDay: true,
    });
  }

  for (const day of trip.days) {
    if (!day.date) continue; // date-less template day — nothing to anchor

    // Day-level note event (carries staff logistical notes when requested).
    const dayNotes = joinLines([
      day.participantNotes,
      opts.includeLogisticalNotes ? day.logisticalNotes : null,
    ]);
    if (dayNotes) {
      events.push({
        uid: uid("day", day.id),
        summary: day.title ? `Day ${day.dayIndex}: ${day.title}` : `Day ${day.dayIndex}`,
        description: dayNotes,
        start: toIcsDate(day.date),
        end: toIcsDate(nextDay(day.date)),
        allDay: true,
      });
    }

    for (const item of day.items) {
      const { primary } = scheduleItemPrimaryLabel(item);
      const venues = item.sites.map((s) => s.location.name);
      const speakers = effectivePresenters(item).map((p) => p.name);
      // A travel span (GH #80) carries its route as the event location and any
      // en-route stops in the description.
      const route = item.travel ? travelRoute(item.travel) : null;
      const travelStops = item.travel?.stops
        .map((s) => s.location?.name ?? s.label)
        .filter(Boolean)
        .join(", ");
      const description = joinLines([
        travelStops ? `Via: ${travelStops}` : null,
        item.notes,
        speakers.length ? `Speaker: ${speakers.join(", ")}` : null,
      ]);
      // A room reads before its venue: "Chapel, John Wesley's New Room".
      const location =
        route ??
        (venues.length
          ? [item.room, venues.join(", ")].filter(Boolean).join(", ")
          : undefined);

      if (item.startTime) {
        // Floating timed event. End only when it's strictly after the start
        // (same-day "HH:MM" compares lexicographically); otherwise a point in time.
        const hasEnd = !!item.endTime && item.endTime > item.startTime;
        events.push({
          uid: uid("item", item.id),
          summary: primary,
          location,
          description,
          start: toIcsFloatingDateTime(day.date, item.startTime),
          end: hasEnd ? toIcsFloatingDateTime(day.date, item.endTime!) : undefined,
          allDay: false,
        });
      } else {
        // Untimed item → all-day on its date.
        events.push({
          uid: uid("item", item.id),
          summary: primary,
          location,
          description,
          start: toIcsDate(day.date),
          end: toIcsDate(nextDay(day.date)),
          allDay: true,
        });
      }
    }
  }

  // Lodging stays (dated only). checkOut is already the exclusive end date.
  for (const stay of trip.stays) {
    if (!stay.checkIn || !stay.checkOut) continue;
    if (stay.checkOut <= stay.checkIn) continue; // guard malformed spans
    events.push({
      uid: uid("stay", stay.id),
      summary: `Lodging: ${stay.locationName}`,
      description: stay.notes ?? undefined,
      start: toIcsDate(stay.checkIn),
      end: toIcsDate(stay.checkOut),
      allDay: true,
    });
  }

  return events;
}

/** Build events for many trips (trip-type / all feeds), in the given order. */
export function buildFeedEvents(
  trips: FeedTrip[],
  opts: BuildFeedOptions,
): IcsEvent[] {
  return trips.flatMap((trip) => buildTripEvents(trip, opts));
}
