"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useBookingWorkflows,
  type WorkflowOption,
} from "@/components/booking-workflows";
import { cn } from "@/lib/utils";
import { formatDate, toDateInput, todayUtc } from "@/lib/dates";
import { BOOKING_STATUS_CLASSES } from "@/lib/trips";
import type { VenueBookingRow, ItemBookingRow } from "@/lib/booking-dashboard";
import {
  setBookingStatus,
  setBookingStepAction,
  setBookingStepsBulk,
  setVenueBookingStatus,
  type BookingTarget,
} from "./actions";
import { WorkflowControl } from "./workflow-control";
import { coverageLine } from "./booking-row";

// Progress view of the booking dashboard: every booking on the trip, whatever
// workflow it follows, one row each with its whole step strip — so a planner
// sees at a glance where everything stands, ticks a step with one click, or
// selects several rows and marks a step done on all of them (steps are matched
// by label, since the rows may follow different workflows).

type Line = {
  key: string;
  name: string;
  detail: string;
  firstDay: number | null; // earliest itinerary day, for ordering
  target: BookingTarget;
  row: VenueBookingRow | ItemBookingRow;
  workflow: WorkflowOption | null;
};

const normalize = (label: string) => label.trim().toLowerCase();

export function BookingProgress({
  tripId,
  canEdit,
  venueRows,
  itemRows,
}: {
  tripId: string;
  canEdit: boolean;
  venueRows: VenueBookingRow[];
  itemRows: ItemBookingRow[];
}) {
  const workflows = useBookingWorkflows();
  const globalDefault = workflows.find((w) => w.isDefault)?.id ?? null;
  const workflowFor = (row: VenueBookingRow | ItemBookingRow) => {
    const id = row.progress.exists
      ? row.progress.workflowId
      : (row.progress.locationDefaultWorkflowId ?? globalDefault);
    return workflows.find((w) => w.id === id) ?? null;
  };

  const lines: Line[] = [
    ...venueRows
      .filter((r) => r.bookable)
      .map((r) => {
        const days = r.sessions.map((s) => s.dayIndex);
        return {
          key: `v:${r.locationId}`,
          name: r.locationName,
          detail: coverageLine(r),
          firstDay: days.length ? Math.min(...days) : null,
          target: { tripId, locationId: r.locationId },
          row: r,
          workflow: workflowFor(r),
        };
      }),
    ...itemRows.map((r) => ({
      key: `i:${r.bookingId}`,
      name: r.label,
      detail: `Day ${r.dayIndex}${r.date ? ` · ${formatDate(r.date)}` : ""}`,
      firstDay: r.dayIndex,
      target: { bookingId: r.bookingId },
      row: r,
      workflow: workflowFor(r),
    })),
  ].sort(
    (a, b) =>
      (a.firstDay ?? Infinity) - (b.firstDay ?? Infinity) ||
      a.name.localeCompare(b.name),
  );

  const [pending, start] = useTransition();
  // Done step ids per row, optimistically patched by clicks and bulk marks.
  const [done, patchDone] = useOptimistic(
    new Map(
      lines.map((l) => [l.key, new Set(l.row.progress.completions.map((c) => c.stepId))]),
    ),
    (prev, patch: { key: string; stepId: string; on: boolean }[]) => {
      const next = new Map(prev);
      for (const p of patch) {
        const set = new Set(next.get(p.key));
        if (p.on) set.add(p.stepId);
        else set.delete(p.stepId);
        next.set(p.key, set);
      }
      return next;
    },
  );
  const doneOn = new Map(
    lines.map((l) => [
      l.key,
      new Map(l.row.progress.completions.map((c) => [c.stepId, c.completedOn])),
    ]),
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLabel, setBulkLabel] = useState<string>("");

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to book.</p>;
  }

  const toggleStep = (line: Line, stepId: string) => {
    const on = !done.get(line.key)?.has(stepId);
    start(async () => {
      patchDone([{ key: line.key, stepId, on }]);
      const res = await setBookingStepAction(
        line.target,
        stepId,
        on,
        toDateInput(todayUtc()),
      );
      if (res.error) toast.error(res.error);
    });
  };

  // Bulk: step labels offered = the union across the selected rows' workflows.
  const chosen = lines.filter((l) => selected.has(l.key));
  const bulkLabels = [
    ...new Map(
      chosen
        .flatMap((l) => l.workflow?.steps ?? [])
        .map((s) => [normalize(s.label), s.label]),
    ).values(),
  ];
  const label = bulkLabels.find((l) => normalize(l) === normalize(bulkLabel))
    ? bulkLabel
    : "";
  const bulkEntries = (on: boolean) =>
    chosen.flatMap((l) => {
      const step = l.workflow?.steps.find(
        (s) => normalize(s.label) === normalize(label),
      );
      if (!step) return [];
      // Skip rows already in the requested state.
      if (done.get(l.key)?.has(step.id) === on) return [];
      return [{ line: l, stepId: step.id }];
    });

  const runBulk = (on: boolean) => {
    const entries = bulkEntries(on);
    const lacking = chosen.filter(
      (l) => !l.workflow?.steps.some((st) => normalize(st.label) === normalize(label)),
    ).length;
    const lackingNote = lacking
      ? ` ${lacking} ${lacking === 1 ? "has" : "have"} no "${label}" step.`
      : "";
    if (entries.length === 0) {
      toast.success(`Nothing to change.${lackingNote}`);
      return;
    }
    start(async () => {
      patchDone(entries.map((e) => ({ key: e.line.key, stepId: e.stepId, on })));
      const res = await setBookingStepsBulk(
        entries.map((e) => ({ target: e.line.target, stepId: e.stepId })),
        on,
      );
      if (res.error) toast.error(res.error);
      else {
        if (res.message) toast.success(`${res.message}${lackingNote}`);
        setSelected(new Set());
      }
    });
  };

  const markNotNeeded = () =>
    start(async () => {
      const results = await Promise.all(
        chosen.map((l) =>
          "bookingId" in l.target
            ? setBookingStatus(l.target.bookingId, "NOT_NEEDED")
            : setVenueBookingStatus(l.target.tripId, l.target.locationId, "NOT_NEEDED"),
        ),
      );
      const err = results.find((r) => r.error);
      if (err?.error) toast.error(err.error);
      else {
        toast.success(`Updated ${chosen.length} booking${chosen.length === 1 ? "" : "s"}.`);
        setSelected(new Set());
      }
    });

  const allSelected = selected.size === lines.length;
  const toggleRow = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
          <Checkbox
            checked={allSelected ? true : selected.size > 0 ? "indeterminate" : false}
            onCheckedChange={(v) =>
              setSelected(v === true ? new Set(lines.map((l) => l.key)) : new Set())
            }
            aria-label="Select all"
          />
          <span className="text-muted-foreground">
            {selected.size ? `${selected.size} selected` : "Select"}
          </span>
          {selected.size > 0 ? (
            <>
              <Select value={label} onValueChange={setBulkLabel}>
                <SelectTrigger size="sm" className="w-56" aria-label="Step">
                  <SelectValue placeholder="Step" />
                </SelectTrigger>
                <SelectContent>
                  {bulkLabels.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={pending || !label}
                onClick={() => runBulk(true)}
              >
                Mark done
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !label}
                onClick={() => runBulk(false)}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={pending}
                onClick={markNotNeeded}
              >
                Not needed
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y rounded-lg border">
        {lines.map((line) => {
          const rowDone = done.get(line.key) ?? new Set<string>();
          const notNeeded = line.row.status === "NOT_NEEDED";
          const steps = line.workflow?.steps ?? [];
          const next = steps.find((s) => !rowDone.has(s.id));
          return (
            <li
              key={line.key}
              className={cn(
                "flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center",
                notNeeded && "opacity-60",
                selected.has(line.key) && "bg-primary/5",
              )}
            >
              <div className="flex min-w-0 items-start gap-2 sm:w-64 sm:shrink-0">
                {canEdit ? (
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(line.key)}
                    onCheckedChange={(v) => toggleRow(line.key, v === true)}
                    aria-label={`Select ${line.name}`}
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">{line.name}</p>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {[line.detail, line.workflow?.name].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              <ol
                className="flex min-w-0 flex-1 flex-wrap gap-1"
                aria-label={`${line.name} steps`}
              >
                {steps.map((s) => {
                  const isDone = rowDone.has(s.id);
                  const on = doneOn.get(line.key)?.get(s.id);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={!canEdit || pending}
                        aria-pressed={isDone}
                        title={
                          isDone
                            ? `${s.label}${on ? ` · ${formatDate(on)}` : ""}`
                            : s.label
                        }
                        onClick={() => toggleStep(line, s.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-default",
                          isDone
                            ? cn("border-transparent font-medium", BOOKING_STATUS_CLASSES[s.status])
                            : s.id === next?.id && !notNeeded
                              ? "border-foreground/40 text-foreground"
                              : "border-dashed text-muted-foreground",
                          canEdit && !isDone && "hover:border-foreground/60",
                        )}
                      >
                        {isDone ? <Check className="size-3" aria-hidden /> : null}
                        {s.label}
                      </button>
                    </li>
                  );
                })}
              </ol>

              <div className="sm:shrink-0">
                <WorkflowControl
                  target={line.target}
                  progress={line.row.progress}
                  canEdit={canEdit}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
