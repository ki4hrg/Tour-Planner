import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import {
  MEAL_KIND_LABELS,
  MEAL_PROVISION_LABELS,
  type MealEntry,
  type MealPlan,
} from "@/lib/meals";
import { cn } from "@/lib/utils";
import type { MealKind } from "@prisma/client";

// The grid's columns; refreshments only count toward the venue totals.
const GRID_KINDS: MealKind[] = ["BREAKFAST", "LUNCH", "DINNER"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// One meal in a grid cell: how it's provided, and by whom when a venue does.
// Links to the item in the itinerary editor. An unset provision is a decision
// still to make — amber.
function MealCell({ tripId, meal }: { tripId: string; meal: MealEntry }) {
  return (
    <Link
      href={`/trips/${tripId}/itinerary#item-${meal.itemId}`}
      className={cn(
        "block link-quiet",
        !meal.provision && "text-amber-700 dark:text-amber-400",
      )}
    >
      {meal.provision ? MEAL_PROVISION_LABELS[meal.provision] : "Not set"}
      {meal.venue && (meal.provision === "VENUE" || meal.provision === "TAKEAWAY") ? (
        <span className="block truncate text-xs text-muted-foreground">
          {meal.venue.name}
        </span>
      ) : null}
      {/* Eaten somewhere else: a takeaway's next site, a coach stop. */}
      {meal.at ? (
        <span className="block truncate text-xs text-muted-foreground">
          at {meal.at}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * The trip's meals at a glance: breakfast / lunch / dinner per day with how
 * each is provided, then what each venue provides (the counts its final
 * numbers need). Rendered only when the itinerary has meal items.
 */
export function MealPlanCard({ tripId, plan }: { tripId: string; plan: MealPlan }) {
  if (plan.total === 0) return null;
  return (
    <Card id="meals">
      <CardHeader>
        <CardTitle>Meals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Day</th>
                {GRID_KINDS.map((k) => (
                  <th key={k} className="py-1.5 pr-3 font-medium">
                    {MEAL_KIND_LABELS[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.days.map((d) => (
                <tr key={d.dayId} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    Day {d.dayIndex}
                    {d.date ? (
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(d.date)}
                      </span>
                    ) : null}
                  </td>
                  {GRID_KINDS.map((k) => {
                    const meals = d.meals.filter((m) => m.kind === k);
                    return (
                      <td key={k} className="max-w-40 py-1.5 pr-3">
                        {meals.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          meals.map((m) => (
                            <MealCell key={m.stopId ?? m.itemId} tripId={tripId} meal={m} />
                          ))
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {plan.byVenue.length > 0 ? (
          <div>
            <h4 className="mb-1 text-sm font-medium">Provided by venue</h4>
            <ul className="space-y-0.5 text-sm">
              {plan.byVenue.map((v) => (
                <li key={v.venue.id}>
                  <span className="font-medium">{v.venue.name}</span>
                  <span className="text-muted-foreground">
                    {" — "}
                    {(Object.keys(v.counts) as MealKind[])
                      .filter((k) => v.counts[k] > 0)
                      .map((k) => plural(v.counts[k], MEAL_KIND_LABELS[k].toLowerCase()))
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {[
            plan.byProvision.ON_OWN ? `${plural(plan.byProvision.ON_OWN, "meal")} on own` : null,
            plan.byProvision.RESTAURANT
              ? `${plural(plan.byProvision.RESTAURANT, "restaurant meal")}`
              : null,
            plan.byProvision.TAKEAWAY ? `${plan.byProvision.TAKEAWAY} takeaway` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          {plan.unset > 0 ? (
            <span className="text-amber-700 dark:text-amber-400">
              {plan.byProvision.ON_OWN || plan.byProvision.RESTAURANT || plan.byProvision.TAKEAWAY
                ? " · "
                : ""}
              {plural(plan.unset, "meal")} not set
            </span>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}
