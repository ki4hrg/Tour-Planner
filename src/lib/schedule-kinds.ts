// Schedule-item kinds (pure). A category's `kind` decides which fields the
// item form offers: a meal's meal fields, a presentation's talk + presenters,
// Free time / Break only times + notes. OTHER (and an uncategorized item)
// keeps every general field. Built-in categories carry a fixed kind.

import type { ScheduleItemKind } from "@prisma/client";

export const SCHEDULE_ITEM_KINDS: ScheduleItemKind[] = [
  "VISIT",
  "MEAL",
  "PRESENTATION",
  "TRAVEL",
  "FREE",
  "OTHER",
];

export const SCHEDULE_ITEM_KIND_LABELS: Record<ScheduleItemKind, string> = {
  VISIT: "Visit",
  MEAL: "Meal",
  PRESENTATION: "Presentation",
  TRAVEL: "Travel",
  FREE: "Free time",
  OTHER: "General",
};

export type KindFields = {
  // Locations, room and the venue's standing events.
  venue: boolean;
  // Free-choice block toggle (subgroups pick among the locations).
  block: boolean;
  meal: boolean;
  talk: boolean;
};

/**
 * The item form's field set for a kind. `null` = uncategorized (everything
 * general). A meal / talk already set on the item keeps its section showing
 * whatever the category, so changing category never hides data silently.
 */
export function kindFields(
  kind: ScheduleItemKind | null,
  has: { meal?: boolean; talk?: boolean } = {},
): KindFields {
  switch (kind) {
    case "FREE":
      return { venue: false, block: false, meal: false, talk: false };
    case "MEAL":
      return { venue: true, block: false, meal: true, talk: !!has.talk };
    case "PRESENTATION":
      return { venue: true, block: false, meal: !!has.meal, talk: true };
    case "VISIT":
      return { venue: true, block: true, meal: !!has.meal, talk: !!has.talk };
    case "TRAVEL":
      return { venue: true, block: false, meal: !!has.meal, talk: false };
    default:
      return { venue: true, block: true, meal: !!has.meal, talk: true };
  }
}

/** Free time / Break: describes itself, so it needs neither title nor venue. */
export function isSelfDescribingKind(kind: ScheduleItemKind | null | undefined): boolean {
  return kind === "FREE";
}
