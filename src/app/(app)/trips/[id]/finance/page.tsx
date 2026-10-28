import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { tripHeadcount } from "@/lib/costs";
import { loadTripFinance } from "@/lib/trip-finance.server";
import type { EstimateSource } from "@/lib/trip-finance";
import { BookingStagePill } from "../../workflow-control";

export const dynamic = "force-dynamic";

// Where each estimate line's number comes from.
const SOURCE_LABELS: Record<EstimateSource, string> = {
  agreed: "Agreed price",
  list: "Venue price",
  stay: "Nightly rate",
};

export default async function TripFinancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const trip = await prisma.trip.findUnique({
    where: { id },
    select: {
      id: true,
      isTemplate: true,
      startDate: true,
      participantCount: true,
      capacity: true,
    },
  });
  if (!trip) notFound();

  const finance = await loadTripFinance(trip);
  const headcount = tripHeadcount(trip);
  const headcountLabel =
    headcount == null
      ? null
      : trip.participantCount != null
        ? `${headcount} participant${headcount === 1 ? "" : "s"}`
        : `Capacity ${headcount}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {headcountLabel ? (
            <p className="text-muted-foreground">
              {headcountLabel} · per-person prices × headcount + per-group prices
            </p>
          ) : (
            <p className="text-muted-foreground">
              Per-group costs only (no {trip.isTemplate ? "capacity" : "headcount"}).
            </p>
          )}
          {finance.money.length === 0 ? (
            <p className="text-muted-foreground">No costs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Currency</TableHead>
                  <TableHead className="text-right">Estimate</TableHead>
                  {!trip.isTemplate ? (
                    <>
                      <TableHead className="text-right">Agreed</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Left</TableHead>
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {finance.money.map((r) => (
                  <TableRow key={r.currency}>
                    <TableCell className="font-medium">{r.currency}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(r.estimate, r.currency)}
                    </TableCell>
                    {!trip.isTemplate ? (
                      <>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.agreed, r.currency)}
                          {r.unknown > 0 ? (
                            <span className="block text-xs text-amber-700 dark:text-amber-300">
                              +{r.unknown} with no total
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.paid, r.currency)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {r.outstanding > 0
                            ? formatMoney(r.outstanding, r.currency)
                            : r.agreed > 0 && r.unknown === 0
                              ? "settled"
                              : "—"}
                        </TableCell>
                      </>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Estimate
            {finance.hasStaleCost ? (
              <Badge variant="attention">
                <TriangleAlert aria-hidden />
                stale prices
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {finance.estimate.length === 0 ? (
            <p className="text-muted-foreground">No costs.</p>
          ) : (
            finance.estimate.map((e) => (
              <div key={e.currency} className="space-y-1">
                <h4 className="text-sm font-medium">{e.currency}</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Basis</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.lines.map((l) => (
                      <TableRow key={l.key}>
                        <TableCell className="whitespace-normal">
                          <Link href={l.href} className="font-medium link-quiet">
                            {l.name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {l.kind === "lodging" ? "Lodging · " : ""}
                            {SOURCE_LABELS[l.source]}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs text-muted-foreground">
                          {l.detail}
                          {l.stale ? (
                            <Badge variant="attention" className="ml-1.5">
                              stale
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {l.unknown ? (
                            <span
                              className="text-amber-700 dark:text-amber-300"
                              title="Per-person price with no headcount"
                            >
                              —
                            </span>
                          ) : (
                            formatMoney(l.amount, l.currency)
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell colSpan={2} className="font-medium">
                        Total
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatMoney(e.total, e.currency)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ))
          )}
          {finance.unpriced.length > 0 ? (
            <div>
              <h4 className="mb-1 text-sm font-medium">No price</h4>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {finance.unpriced.map((u) => (
                  <li key={u.id}>
                    <Link href={u.href} className="link-quiet">
                      {u.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!trip.isTemplate ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Commitments
              {finance.overdueCount > 0 ? (
                <Badge variant="overdue">{finance.overdueCount} overdue</Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {finance.commitments.length === 0 ? (
              <p className="text-muted-foreground">No agreed prices.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Booking</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Agreed</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Left</TableHead>
                    <TableHead>Next payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finance.commitments.map((c) => (
                    <TableRow key={c.key}>
                      <TableCell className="whitespace-normal">
                        <Link href={c.href} className="font-medium link-quiet">
                          {c.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <BookingStagePill
                          status={c.status}
                          stageLabel={c.stageLabel}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.agreedTotal != null
                          ? formatMoney(c.agreedTotal, c.currency)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(c.paid, c.currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.outstanding == null
                          ? "—"
                          : c.settled
                            ? "settled"
                            : formatMoney(c.outstanding, c.currency)}
                      </TableCell>
                      <TableCell className="whitespace-normal text-xs">
                        {c.overdueAmount > 0 ? (
                          <span className="font-medium text-destructive">
                            {formatMoney(c.overdueAmount, c.currency)} overdue
                          </span>
                        ) : c.nextDue ? (
                          <span className="text-amber-700 dark:text-amber-300">
                            {formatMoney(c.nextDue.amount, c.currency)} due{" "}
                            {formatDate(c.nextDue.dueDate)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
