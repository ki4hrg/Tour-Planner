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
import { WorkflowControl } from "./workflow-control";
import { useBookingWorkflows } from "@/components/booking-workflows";
import { BOOKING_STATUS_RANK } from "@/lib/booking-workflow";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  VenueDetails,
  WindowCell,
  PriceCell,
  coverageLine,
} from "./booking-row";
import {
  setVenueBookingStatus,
  setBookingStatus,
  setBookingStageAction,
  type BookingTarget,
} from "./actions";

type ContactOption = { id: string; name: string };

type BoardCard =
  | { key: string; kind: "venue"; row: VenueBookingRow }
  | { key: string; kind: "item"; row: ItemBookingRow };

const DRAG_TYPE = "application/x-tour-booking";

// DOM id of a card ("board-v-<locationId>" / "board-i-<bookingId>").
const cardDomId = (key: string) => `board-${key.replace(":", "-")}`;

// Kanban view of the booking dashboard: a card per bookable venue engagement or
// site-less item booking. Two layouts:
// - "Status": one column per coarse status. Dragging sets the status of a
//   booking without a workflow; a workflow booking only moves in and out of
//   "Not needed" this way (its steps own the rest).
// - one workflow: a column per step of that workflow (a card sits under the
//   latest step it has done), plus "Not started" and "Not needed". Dragging to
//   a step column ticks that step and clears later ones. Cards on other
//   workflows are hidden.
// The status control on each card does the same on touch and keyboard. Moves
// show immediately and settle when the revalidated rows arrive.
const STATUS_VIEW = "__status__";

type Column = {
  key: string; // "status:<S>" | "step:<id>" | "start" | "skip"
  label: string;
  status: BookingStatus; // colours the header pill
};

type CardState = { status: BookingStatus; completions: string[] };

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
  const workflows = useBookingWorkflows();
  const globalDefault = workflows.find((w) => w.isDefault)?.id ?? null;
  // Walk-by stops are never booked, so they have no place on a status board.
  const walkBys = venueRows.filter((r) => !r.bookable).length;
  const cards: BoardCard[] = [
    ...venueRows
      .filter((r) => r.bookable)
      .map((row) => ({ key: `v:${row.locationId}`, kind: "venue" as const, row })),
    ...itemRows.map((row) => ({ key: `i:${row.bookingId}`, kind: "item" as const, row })),
  ];
  // The workflow each card follows (a venue not engaged yet: the one its first
  // touch will seed).
  const workflowOf = (c: BoardCard): string | null =>
    c.row.progress.exists
      ? c.row.progress.workflowId
      : (c.row.progress.locationDefaultWorkflowId ?? globalDefault);
  const usedWorkflows = workflows.filter((w) =>
    cards.some((c) => workflowOf(c) === w.id),
  );
  const allOnOne =
    usedWorkflows.length === 1 && cards.every((c) => workflowOf(c) === usedWorkflows[0].id);
  const [view, setView] = useState<string>(
    allOnOne ? usedWorkflows[0].id : STATUS_VIEW,
  );
  const workflow = workflows.find((w) => w.id === view) ?? null;

  const [, start] = useTransition();
  const [states, setOptimistic] = useOptimistic(
    new Map<string, CardState>(
      cards.map((c) => [
        c.key,
        {
          status: c.row.status,
          completions: c.row.progress.completions.map((x) => x.stepId),
        },
      ]),
    ),
    (prev, move: { key: string; state: CardState }) =>
      new Map(prev).set(move.key, move.state),
  );
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const targetOf = (card: BoardCard): BookingTarget =>
    card.kind === "venue"
      ? { tripId, locationId: card.row.locationId }
      : { bookingId: card.row.bookingId };

  const columns: Column[] = workflow
    ? [
        { key: "start", label: "Not started", status: "PLANNED" },
        ...workflow.steps.map((s) => ({
          key: `step:${s.id}`,
          label: s.label,
          status: s.status,
        })),
        { key: "skip", label: BOOKING_STATUS_LABELS.NOT_NEEDED, status: "NOT_NEEDED" },
      ]
    : BOOKING_STATUSES.map((s) => ({
        key: `status:${s}`,
        label: BOOKING_STATUS_LABELS[s],
        status: s,
      }));

  const columnOf = (card: BoardCard): string => {
    const st = states.get(card.key) ?? { status: card.row.status, completions: [] };
    if (!workflow) return `status:${st.status}`;
    if (st.status === "NOT_NEEDED") return "skip";
    // The latest step done, in workflow order.
    const done = new Set(st.completions);
    const last = [...workflow.steps].reverse().find((s) => done.has(s.id));
    return last ? `step:${last.id}` : "start";
  };

  const shown = workflow ? cards.filter((c) => workflowOf(c) === workflow.id) : cards;
  const hidden = cards.length - shown.length;

  const move = (key: string, columnKey: string) => {
    const card = cards.find((c) => c.key === key);
    if (!card || !canEdit || columnOf(card) === columnKey) return;
    const prev = states.get(key) ?? { status: card.row.status, completions: [] };
    const target = targetOf(card);
    let next: CardState;
    let call: () => Promise<FormState>;
    if (columnKey === "skip" || columnKey === "status:NOT_NEEDED") {
      next = { ...prev, status: "NOT_NEEDED" };
      call = () => setBookingStatusFor(target, "NOT_NEEDED");
    } else if (workflow && (columnKey === "start" || columnKey.startsWith("step:"))) {
      const stepId = columnKey === "start" ? null : columnKey.slice(5);
      const at = stepId ? workflow.steps.findIndex((s) => s.id === stepId) : -1;
      // Reaching a stage means every step up to it is done.
      next = {
        status: "PLANNED", // re-derived from the steps on the server
        completions: workflow.steps.slice(0, at + 1).map((s) => s.id),
      };
      const reached = workflow.steps
        .filter((s) => next.completions.includes(s.id))
        .reduce<BookingStatus>(
          (acc, s) => (BOOKING_STATUS_RANK[s.status] > BOOKING_STATUS_RANK[acc] ? s.status : acc),
          "PLANNED",
        );
      next.status = reached;
      call = () => setBookingStageAction(target, stepId);
    } else {
      const status = columnKey.slice(7) as BookingStatus;
      if (workflowOf(card) && prev.status !== "NOT_NEEDED") {
        toast.error("Set by workflow steps.");
        return;
      }
      // Leaving "Not needed" on a workflow booking re-derives from its steps.
      next = { ...prev, status };
      call = () => setBookingStatusFor(target, status);
    }
    start(async () => {
      setOptimistic({ key, state: next });
      const res = await call();
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
      {usedWorkflows.length > 0 ? (
        <Select value={view} onValueChange={setView}>
          <SelectTrigger size="sm" className="w-auto" aria-label="Board columns">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STATUS_VIEW}>Status</SelectItem>
            {usedWorkflows.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:snap-none">
        {columns.map((col) => {
          const column = shown.filter((c) => columnOf(c) === col.key);
          return (
            <section
              key={col.key}
              aria-label={col.label}
              className={cn(
                "flex min-w-[80%] flex-1 basis-0 snap-start flex-col rounded-lg border bg-muted/30 transition-colors sm:min-w-48",
                overColumn === col.key && "border-primary bg-primary/5",
              )}
              onDragOver={(e) => {
                if (!canEdit || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overColumn !== col.key) setOverColumn(col.key);
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
                if (key) move(key, col.key);
              }}
            >
              <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    BOOKING_STATUS_CLASSES[col.status],
                  )}
                >
                  {col.label}
                </span>
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </header>
              <ol className="min-h-24 flex-1 space-y-2 p-2">
                {column.map((card) => (
                  <li key={card.key}>
                    <BoardCardView
                      card={card}
                      target={targetOf(card)}
                      status={states.get(card.key)?.status ?? card.row.status}
                      canEdit={canEdit}
                      dragging={dragKey === card.key}
                      focused={
                        card.kind === "venue" &&
                        card.row.locationId === focusLocationId
                      }
                      documentCount={docsFor(card.row.bookingId).length}
                      onOpen={() => setOpenKey(card.key)}
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
      {walkBys > 0 || hidden > 0 ? (
        <p className="text-xs text-muted-foreground">
          {[
            walkBys > 0
              ? `${walkBys} walk-by stop${walkBys === 1 ? "" : "s"} hidden.`
              : null,
            hidden > 0
              ? `${hidden} on other workflows hidden.`
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
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
              <WorkflowControl
                target={targetOf(openCard)}
                progress={openCard.row.progress}
                canEdit={canEdit}
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

function setBookingStatusFor(target: BookingTarget, status: BookingStatus) {
  return "bookingId" in target
    ? setBookingStatus(target.bookingId, status)
    : setVenueBookingStatus(target.tripId, target.locationId, status);
}

function BoardCardView({
  card,
  target,
  status,
  canEdit,
  dragging,
  focused,
  documentCount,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  target: BookingTarget;
  status: BookingStatus;
  canEdit: boolean;
  dragging: boolean;
  focused: boolean;
  documentCount: number;
  onOpen: () => void;
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
      <WorkflowControl target={target} progress={card.row.progress} canEdit={canEdit} />
    </article>
  );
}
