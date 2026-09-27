"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import type { BookingStatus } from "@prisma/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { isBookingSecured } from "@/lib/booking";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_CLASSES,
} from "@/lib/trips";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import type { SerializedDocument } from "@/lib/documents";
import type { FormState } from "@/lib/forms";
import { DocumentsPanel } from "../documents/documents-panel";
import { StatusControl } from "./status-control";
import {
  VenueDetails,
  WindowCell,
  PriceCell,
  coverageLine,
} from "./booking-row";
import { setVenueBookingStatus, setBookingStatus } from "./actions";

type ContactOption = { id: string; name: string };

type BoardCard =
  | { key: string; kind: "venue"; row: VenueBookingRow }
  | { key: string; kind: "item"; row: ItemBookingRow };

const DRAG_TYPE = "application/x-tour-booking";

// DOM id of a card ("board-v-<locationId>" / "board-i-<bookingId>").
const cardDomId = (key: string) => `board-${key.replace(":", "-")}`;

// Kanban view of the booking dashboard: one column per status, a card per
// bookable venue engagement or site-less item booking. Moving a card (drag, or
// the status control on the card for touch/keyboard) sets its status through
// the same actions as the table; the move shows immediately and settles when
// the revalidated rows arrive.
export function BookingBoard({
  tripId,
  canEdit,
  venueRows,
  itemRows,
  contacts,
  currencies,
  docsFor,
  focusLocationId,
}: {
  tripId: string;
  canEdit: boolean;
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
  contacts: ContactOption[];
  currencies: string[];
  docsFor: (bookingId: string | null) => SerializedDocument[];
  focusLocationId: string | null;
}) {
  // Walk-by stops are never booked, so they have no place on a status board.
  const walkBys = venueRows.filter((r) => !r.bookable).length;
  const cards: BoardCard[] = [
    ...venueRows
      .filter((r) => r.bookable)
      .map((row) => ({ key: `v:${row.locationId}`, kind: "venue" as const, row })),
    ...itemRows.map((row) => ({ key: `i:${row.bookingId}`, kind: "item" as const, row })),
  ];

  const [, start] = useTransition();
  const [statuses, setOptimistic] = useOptimistic(
    new Map(cards.map((c) => [c.key, c.row.status])),
    (prev, move: { key: string; status: BookingStatus }) =>
      new Map(prev).set(move.key, move.status),
  );
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<BookingStatus | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const setStatus = (card: BoardCard, status: BookingStatus): Promise<FormState> =>
    card.kind === "venue"
      ? setVenueBookingStatus(tripId, card.row.locationId, status)
      : setBookingStatus(card.row.bookingId, status);

  const move = (key: string, status: BookingStatus) => {
    const card = cards.find((c) => c.key === key);
    if (!card || !canEdit || statuses.get(key) === status) return;
    start(async () => {
      setOptimistic({ key, status });
      const res = await setStatus(card, status);
      if (res.error) toast.error(res.error);
      else if (res.message) toast.success(res.message);
    });
    // The card remounts in its new column, dropping keyboard focus with it —
    // put focus back on the card once it has moved.
    requestAnimationFrame(() => document.getElementById(cardDomId(key))?.focus());
  };

  useEffect(() => {
    if (!focusLocationId) return;
    document
      .getElementById(`board-v-${focusLocationId}`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [focusLocationId]);

  if (cards.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing to book.
      </p>
    );
  }

  const openCard = cards.find((c) => c.key === openKey) ?? null;

  return (
    <div className="space-y-2">
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:snap-none">
        {BOOKING_STATUSES.map((status) => {
          const column = cards.filter((c) => statuses.get(c.key) === status);
          return (
            <section
              key={status}
              aria-label={BOOKING_STATUS_LABELS[status]}
              className={cn(
                "flex min-w-[80%] flex-1 basis-0 snap-start flex-col rounded-lg border bg-muted/30 transition-colors sm:min-w-48",
                overColumn === status && "border-primary bg-primary/5",
              )}
              onDragOver={(e) => {
                if (!canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overColumn !== status) setOverColumn(status);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setOverColumn(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOverColumn(null);
                // The card remounts in its new column, so its own dragend may
                // never fire — clear the drag state here too.
                setDragKey(null);
                const key = e.dataTransfer.getData(DRAG_TYPE);
                if (key) move(key, status);
              }}
            >
              <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    BOOKING_STATUS_CLASSES[status],
                  )}
                >
                  {BOOKING_STATUS_LABELS[status]}
                </span>
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </header>
              <ol className="min-h-24 flex-1 space-y-2 p-2">
                {column.map((card) => (
                  <li key={card.key}>
                    <BoardCardView
                      card={card}
                      status={statuses.get(card.key) ?? card.row.status}
                      canEdit={canEdit}
                      dragging={dragKey === card.key}
                      focused={
                        card.kind === "venue" &&
                        card.row.locationId === focusLocationId
                      }
                      documentCount={docsFor(card.row.bookingId).length}
                      onOpen={() => setOpenKey(card.key)}
                      onMove={(s) => move(card.key, s)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, card.key);
                        e.dataTransfer.effectAllowed = "move";
                        setDragKey(card.key);
                      }}
                      onDragEnd={() => {
                        setDragKey(null);
                        setOverColumn(null);
                      }}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      {walkBys > 0 ? (
        <p className="text-xs text-muted-foreground">
          {walkBys} walk-by stop{walkBys === 1 ? "" : "s"} hidden.
        </p>
      ) : null}

      <Dialog open={openCard != null} onOpenChange={(o) => !o && setOpenKey(null)}>
        {openCard ? (
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader className="flex-row flex-wrap items-center gap-2">
              <DialogTitle>
                {openCard.kind === "venue"
                  ? openCard.row.locationName
                  : openCard.row.label}
              </DialogTitle>
              <StatusControl
                status={statuses.get(openCard.key) ?? openCard.row.status}
                canEdit={canEdit}
                onSet={async (s) => {
                  move(openCard.key, s);
                  return {};
                }}
              />
            </DialogHeader>
            {openCard.kind === "venue" ? (
              <VenueDetails
                row={openCard.row}
                tripId={tripId}
                canEdit={canEdit}
                contacts={contacts}
                currencies={currencies}
                documents={docsFor(openCard.row.bookingId)}
              />
            ) : (
              <DocumentsPanel
                target="booking"
                targetId={openCard.row.bookingId}
                documents={docsFor(openCard.row.bookingId)}
                canEdit={canEdit}
                emptyLabel="No documents."
                venueName={null}
              />
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function BoardCardView({
  card,
  status,
  canEdit,
  dragging,
  focused,
  documentCount,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  status: BookingStatus;
  canEdit: boolean;
  dragging: boolean;
  focused: boolean;
  documentCount: number;
  onOpen: () => void;
  onMove: (status: BookingStatus) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const venue = card.kind === "venue" ? card.row : null;
  const overdue = venue != null && venue.overdueAmount > 0;
  const files =
    documentCount > 0
      ? `${documentCount} file${documentCount === 1 ? "" : "s"}`
      : null;

  return (
    <article
      id={cardDomId(card.key)}
      tabIndex={-1}
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "space-y-1.5 rounded-md border bg-background p-2.5 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
        venue?.needsInfo && "border-amber-300 dark:border-amber-800",
        overdue && "border-red-300 dark:border-red-900",
        focused && "ring-2 ring-primary/40",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left font-medium hover:underline"
      >
        {venue ? venue.locationName : card.row.label}
      </button>

      {venue ? (
        <>
          <p className="text-xs text-muted-foreground">
            {[coverageLine(venue), venue.contactName, files]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
          <div className="text-xs">
            <PriceCell row={venue} />
          </div>
          {/* Only the unbooked care when the window opens. */}
          {status !== "NOT_NEEDED" && !isBookingSecured(status) ? (
            <div className="text-xs">
              <WindowCell row={{ ...venue, status }} />
            </div>
          ) : null}
        </>
      ) : card.kind === "item" ? (
        <p className="text-xs text-muted-foreground">
          {[
            `Day ${card.row.dayIndex}${card.row.date ? ` · ${formatDate(card.row.date)}` : ""}`,
            "one-off",
            card.row.contactName,
            files,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}

      {/* Drag is mouse-only; the status control moves a card on touch and
          keyboard too. */}
      {canEdit ? (
        <StatusControl
          status={status}
          canEdit
          onSet={async (s) => {
            onMove(s);
            return {};
          }}
        />
      ) : null}
    </article>
  );
}
