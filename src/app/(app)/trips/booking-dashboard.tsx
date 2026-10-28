"use client";

import { Fragment, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ListChecks, SquareKanban, Table2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BookingStatus } from "@prisma/client";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUSES,
  countByStatus,
  parseBookingStatuses,
} from "@/lib/trips";
import { BookingStatusChips } from "@/components/booking-status-chips";
import type { SerializedDocument } from "@/lib/documents";
import { isBookingOff, isBookingSecured } from "@/lib/booking";
import { isYourMove } from "@/lib/cross-trip-bookings";
import { VenueRow, ItemRow, VenueCard, ItemCard } from "./booking-row";
import { BookingBoard } from "./booking-board";
import { BookingProgress } from "./booking-progress";

export type DashboardView = "table" | "board" | "progress";

// Table order + grouping, both kept in the URL (`?sort=`, `?group=`) like the
// view. Rows come from the server in booking-window order (earliest-bookable
// first, no window last), which stays the default. The master-status filter
// (`?status=IN_PROGRESS,CONFIRMED`) narrows the table and the Progress view
// to those statuses whatever workflow stage each booking is at.
export type DashboardSort = "window" | "name" | "day";
export type DashboardGroup = "none" | "status" | "type" | "region";

const SORT_LABELS: Record<DashboardSort, string> = {
  window: "Booking window",
  name: "Venue",
  day: "First visit",
};
const GROUP_LABELS: Record<DashboardGroup, string> = {
  none: "No grouping",
  status: "Status",
  type: "Visit type",
  region: "Region",
};

function sortVenues(rows: VenueBookingRow[], sort: DashboardSort): VenueBookingRow[] {
  if (sort === "window") return rows; // server order
  const copy = [...rows];
  if (sort === "name")
    return copy.sort((a, b) => a.locationName.localeCompare(b.locationName));
  return copy.sort(
    (a, b) =>
      (a.firstDayIndex ?? Infinity) - (b.firstDayIndex ?? Infinity) ||
      a.locationName.localeCompare(b.locationName),
  );
}

// Group label per row; statuses follow the ladder (walk-bys, which have none,
// last), "Lodging" leads a type grouping, regions sort A–Z with unregioned
// venues last.
const WALK_BY = "Walk-by";
function groupOf(row: VenueBookingRow, group: DashboardGroup): string {
  if (group === "status")
    return row.bookable ? BOOKING_STATUS_LABELS[row.status] : WALK_BY;
  if (group === "region") return row.regionName ?? "No region";
  return row.visitType;
}
const STATUS_GROUP_ORDER = [
  ...BOOKING_STATUSES.map((st) => BOOKING_STATUS_LABELS[st]),
  WALK_BY,
];
function groupVenues(
  rows: VenueBookingRow[],
  group: DashboardGroup,
): { label: string; rows: VenueBookingRow[] }[] {
  if (group === "none") return [{ label: "", rows }];
  const map = new Map<string, VenueBookingRow[]>();
  for (const r of rows) {
    const key = groupOf(r, group);
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const rank = (label: string) =>
    group === "status"
      ? STATUS_GROUP_ORDER.indexOf(label)
      : group === "type"
      ? label === "Lodging"
        ? 0
        : label === "Planned"
          ? 2
          : 1
      : label === "No region"
        ? 1
        : 0;
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([label, rows]) => ({ label, rows }));
}

type ContactOption = { id: string; name: string };

type Filters = {
  windowOpen: boolean;
  missingPrice: boolean;
  unconfirmed: boolean;
  paymentOverdue: boolean;
  yourMove: boolean;
};

const NO_FILTERS: Filters = {
  windowOpen: false,
  missingPrice: false,
  unconfirmed: false,
  paymentOverdue: false,
  yourMove: false,
};

const FILTER_LABELS: { key: keyof Filters; label: string }[] = [
  { key: "windowOpen", label: "Window open" },
  { key: "missingPrice", label: "Missing price" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "paymentOverdue", label: "Payment overdue" },
  { key: "yourMove", label: "Your move" },
];

function venueMatches(row: VenueBookingRow, f: Filters): boolean {
  // Not-bookable sites and cancelled / not-needed ones are never actionable.
  if (!row.bookable || isBookingOff(row.status)) return false;
  return (
    (f.windowOpen && row.open && !isBookingSecured(row.status)) ||
    (f.missingPrice && row.isMissingCost) ||
    (f.unconfirmed && !isBookingSecured(row.status)) ||
    (f.paymentOverdue && row.overdueAmount > 0) ||
    (f.yourMove && isYourMove(row))
  );
}

export function BookingDashboard({
  tripId,
  canEdit,
  venueRows,
  itemRows,
  contacts,
  currencies,
  documentsByBooking,
  focusLocationId = null,
}: {
  tripId: string;
  canEdit: boolean;
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
  contacts: ContactOption[];
  // The trip's currency vocabulary (GH #11) — price/payment pickers offer these.
  currencies: string[];
  // Files filed against each booking, keyed by booking id. A venue with no
  // engagement yet has no id and so no files — it gets an empty list.
  documentsByBooking: Record<string, SerializedDocument[]>;
  // Deep link (`?venue=<locationId>`) from the trip page: start with every row
  // visible and that venue expanded + scrolled into view.
  focusLocationId?: string | null;
}) {
  // The view lives in the URL (`?view=board|progress`) so a reload or shared link opens
  // the same one. history.replaceState keeps useSearchParams in sync without a
  // server round trip (router.replace would re-run the whole page's queries).
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const param = searchParams.get("view");
  const view: DashboardView =
    param === "board" || param === "progress" ? param : "table";
  const sortParam = searchParams.get("sort");
  const sort: DashboardSort =
    sortParam === "name" || sortParam === "day" ? sortParam : "window";
  const groupParam = searchParams.get("group");
  const group: DashboardGroup =
    groupParam === "status" || groupParam === "type" || groupParam === "region"
      ? groupParam
      : "none";
  const statuses = parseBookingStatuses(searchParams.get("status"));
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value == null) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };
  const switchView = (next: DashboardView) =>
    setParam("view", next === "table" ? null : next);
  const docsFor = (bookingId: string | null) =>
    (bookingId && documentsByBooking[bookingId]) || [];
  const focused = focusLocationId != null &&
    venueRows.some((r) => r.locationId === focusLocationId);
  // A deep link to one venue or to a status starts with the attention filters
  // off, so every row it names shows.
  const attentionOn = !focused && statuses.length === 0;
  const [filters, setFilters] = useState<Filters>({
    windowOpen: attentionOn,
    missingPrice: attentionOn,
    unconfirmed: attentionOn,
    paymentOverdue: attentionOn,
    yourMove: attentionOn,
  });
  const setStatuses = (next: BookingStatus[]) => {
    setParam("status", next.length ? next.join(",") : null);
    // Picking a status means "show me those": the attention filters would
    // hide most of them (a finalized booking needs nothing), so clear them.
    if (next.length) setFilters(NO_FILTERS);
  };

  useEffect(() => {
    if (!focused) return;
    // Table on desktop, card below sm — scroll whichever one is visible.
    const el = [
      document.getElementById(`venue-${focusLocationId}`),
      document.getElementById(`venue-card-${focusLocationId}`),
    ].find((e) => e && e.offsetParent !== null);
    el?.scrollIntoView({ block: "start" });
  }, [focused, focusLocationId]);
  const anyFilter = Object.values(filters).some(Boolean);

  // Master-status counts over everything that has a status (walk-bys don't).
  const statusCounts = countByStatus([
    ...venueRows.filter((r) => r.bookable),
    ...itemRows,
  ]);
  const statusOk = (r: { status: BookingStatus }) =>
    statuses.length === 0 || statuses.includes(r.status);
  const statusVenues =
    statuses.length === 0
      ? venueRows
      : venueRows.filter((r) => r.bookable && statusOk(r));
  const statusItems = itemRows.filter(statusOk);

  // No filter checked = show everything; otherwise show rows matching any filter.
  const shownVenues = anyFilter
    ? statusVenues.filter((r) => venueMatches(r, filters))
    : statusVenues;
  const shownItems = anyFilter
    ? statusItems.filter(
        (r) =>
          (filters.unconfirmed && !isBookingOff(r.status) && !isBookingSecured(r.status)) ||
          (filters.yourMove && isYourMove(r)),
      )
    : statusItems;

  const total = venueRows.length + itemRows.length;
  const shown = shownVenues.length + shownItems.length;
  const groups = groupVenues(sortVenues(shownVenues, sort), group);
  const grouped = group !== "none";

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No venues.
      </p>
    );
  }

  const viewToggle = (
    <Tabs
      value={view}
      onValueChange={(v) => switchView(v as DashboardView)}
    >
      <TabsList variant="line" aria-label="View">
        {(
          [
            ["table", "Table", Table2],
            ["board", "Board", SquareKanban],
            ["progress", "Progress", ListChecks],
          ] as const
        ).map(([value, label, Icon]) => (
          <TabsTrigger key={value} value={value} className="px-2">
            <Icon />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  const statusChips = (
    <BookingStatusChips
      counts={statusCounts}
      selected={statuses}
      onChange={setStatuses}
    />
  );

  if (view === "progress") {
    return (
      <div className="space-y-3">
        <div className="flex">{viewToggle}</div>
        {statusChips}
        <BookingProgress
          tripId={tripId}
          canEdit={canEdit}
          venueRows={statusVenues}
          itemRows={statusItems}
        />
      </div>
    );
  }

  if (view === "board") {
    return (
      <div className="space-y-3">
        <div className="flex">{viewToggle}</div>
        <BookingBoard
          tripId={tripId}
          canEdit={canEdit}
          venueRows={venueRows}
          itemRows={itemRows}
          contacts={contacts}
          currencies={currencies}
          docsFor={docsFor}
          focusLocationId={focused ? focusLocationId : null}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {viewToggle}
        <span className="text-muted-foreground">Show:</span>
        {FILTER_LABELS.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-1.5">
            <Checkbox
              checked={filters[key]}
              onCheckedChange={(v) =>
                setFilters((prev) => ({ ...prev, [key]: v === true }))
              }
            />
            {label}
          </label>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {anyFilter || statuses.length
            ? `${shown} of ${total} shown`
            : `All ${total} venues`}
        </span>
      </div>
      {statusChips}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Sort</span>
          <Select value={sort} onValueChange={(v) => setParam("sort", v === "window" ? null : v)}>
            <SelectTrigger size="sm" className="w-40" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as DashboardSort[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Group</span>
          <Select value={group} onValueChange={(v) => setParam("group", v === "none" ? null : v)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Group by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GROUP_LABELS) as DashboardGroup[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {GROUP_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {shown === 0 ? (
        <p className="text-sm text-muted-foreground">
          No matches.
        </p>
      ) : (
        <>
          {/* Desktop: the table. Below sm it doesn't stack, so cards take over. */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Venue</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Point of contact</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((g) => (
                  <Fragment key={g.label}>
                    {grouped ? (
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={5} className="py-1.5">
                          <h4 className="text-sm font-medium">
                            {g.label}
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              {g.rows.length}
                            </span>
                          </h4>
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {g.rows.map((row) => (
                      <VenueRow
                        key={row.locationId}
                        row={row}
                        tripId={tripId}
                        canEdit={canEdit}
                        contacts={contacts}
                        currencies={currencies}
                        documents={docsFor(row.bookingId)}
                        defaultOpen={row.locationId === focusLocationId}
                      />
                    ))}
                  </Fragment>
                ))}
                {grouped && shownItems.length > 0 ? (
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={5} className="py-1.5">
                      <h4 className="text-sm font-medium">
                        Item bookings
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {shownItems.length}
                        </span>
                      </h4>
                    </TableCell>
                  </TableRow>
                ) : null}
                {shownItems.map((row) => (
                  <ItemRow
                    key={row.bookingId}
                    row={row}
                    canEdit={canEdit}
                    documents={docsFor(row.bookingId)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-2 sm:hidden">
            {groups.map((g) => (
              <Fragment key={g.label}>
                {grouped ? (
                  <h4 className="pt-2 text-sm font-medium">
                    {g.label}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {g.rows.length}
                    </span>
                  </h4>
                ) : null}
                {g.rows.map((row) => (
                  <VenueCard
                    key={row.locationId}
                    row={row}
                    tripId={tripId}
                    canEdit={canEdit}
                    contacts={contacts}
                    currencies={currencies}
                    documents={docsFor(row.bookingId)}
                    defaultOpen={row.locationId === focusLocationId}
                  />
                ))}
              </Fragment>
            ))}
            {grouped && shownItems.length > 0 ? (
              <h4 className="pt-2 text-sm font-medium">Item bookings</h4>
            ) : null}
            {shownItems.map((row) => (
              <ItemCard
                key={row.bookingId}
                row={row}
                canEdit={canEdit}
                documents={docsFor(row.bookingId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
