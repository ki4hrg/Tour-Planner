import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { TripFinance } from "@/lib/trip-finance";

// The overview's one money card: per currency, the estimate against what has
// been agreed, paid and is still owed, plus the payments that need attention.
// The Finance tab carries the breakdown behind every number here.
export function FinanceCard({
  tripId,
  finance,
  isTemplate,
  headcountLabel,
}: {
  tripId: string;
  finance: TripFinance;
  isTemplate: boolean;
  // "35 participants" / "Capacity 40" / null (no headcount at all).
  headcountLabel: string | null;
}) {
  const { money, due, overdueCount } = finance;
  // Templates have no dates, so nothing is ever due; show the estimate only.
  const rows = isTemplate
    ? money.filter((r) => r.estimate > 0)
    : money.filter((r) => r.estimate > 0 || r.agreed > 0 || r.paid > 0);
  const unknown = money.reduce((n, r) => n + r.unknown, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          Finance
          {overdueCount > 0 ? (
            <Badge variant="overdue">{overdueCount} overdue</Badge>
          ) : null}
        </CardTitle>
        <Link
          href={`/trips/${tripId}/finance`}
          className="text-xs text-muted-foreground link-quiet"
        >
          Breakdown
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">No costs.</p>
        ) : (
          <>
            {headcountLabel ? (
              <p className="text-muted-foreground">{headcountLabel}</p>
            ) : (
              <p className="text-muted-foreground">
                Per-group costs only (no {isTemplate ? "capacity" : "headcount"}).
              </p>
            )}
            <dl className="space-y-2">
              {rows.map((r) => (
                <div key={r.currency} className="space-y-0.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-medium">{r.currency}</dt>
                    <dd className="font-medium">
                      {formatMoney(r.estimate, r.currency)}
                      <span className="text-xs font-normal text-muted-foreground">
                        {" "}
                        estimate
                      </span>
                    </dd>
                  </div>
                  {!isTemplate && (r.agreed > 0 || r.paid > 0) ? (
                    <dd className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
                      <span>
                        {formatMoney(r.paid, r.currency)} paid of{" "}
                        {formatMoney(r.agreed, r.currency)} agreed
                      </span>
                      <span>
                        {r.outstanding > 0
                          ? `${formatMoney(r.outstanding, r.currency)} left`
                          : r.unknown > 0
                            ? "—"
                            : "settled"}
                      </span>
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>
            {unknown > 0 ? (
              <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                {unknown} per-person price{unknown === 1 ? " has" : "s have"} no
                total (no headcount).
              </p>
            ) : null}
            {finance.hasStaleCost ? (
              <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                Includes stale or unconfirmed prices.
              </p>
            ) : null}
          </>
        )}

        {!isTemplate && due.length > 0 ? (
          <div className="border-t pt-2">
            {overdueCount > 0 ? (
              <h4 className="mb-1 text-sm font-medium text-destructive">
                {overdueCount} payment{overdueCount === 1 ? "" : "s"} overdue
              </h4>
            ) : (
              <h4 className="mb-1 text-sm font-medium">Next due</h4>
            )}
            <ul className="space-y-0.5">
              {due.slice(0, 3).map((a) => (
                <li key={a.key}>
                  <div
                    className={
                      a.overdue
                        ? "font-medium text-destructive"
                        : "font-medium text-amber-700 dark:text-amber-300"
                    }
                  >
                    {formatMoney(a.amount, a.currency)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <Link href={a.href} className="link-quiet">
                      {a.name}
                    </Link>{" "}
                    · {a.overdue ? "was due" : "due"} {formatDate(a.dueDate)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
