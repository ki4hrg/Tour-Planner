"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { BookingStatus } from "@prisma/client";
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
  type WorkflowStepOption,
} from "@/components/booking-workflows";
import { cn } from "@/lib/utils";
import { stepGate } from "@/lib/booking-workflow";
import { formatDate, toDateInput, todayUtc } from "@/lib/dates";
import {
  daysWaiting,
  upcomingStep,
  waitingFromView,
  waitingView,
  type BookingProgressView,
  type WaitingView,
} from "@/lib/booking-workflow";
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
import { ACTOR_PREFIX, OURS_CHIP_CLASSES, WaitingNote } from "./waiting-note";

// Progress view of the booking dashboard: every booking on the trip, whatever
// workflow it follows, one row each with its whole step strip — so a planner
// sees at a glance where everything stands, ticks a step with one click, or
// selects several rows and marks a step done on all of them (steps are matched
// by label, since the rows may follow different workflows).
//
// The pieces are reused elsewhere: `ProgressList` on the Location page (one
// row per trip engaging that venue), `CompactProgress` ("Next for you: …" /
// "Next (venue): …" + the status control) wherever a booking is shown in a
// single line. Owners (whose move) come from ./waiting-note.

/** The workflow a booking follows — for a not-yet-created engagement, the one its first touch will seed. */
export function useWorkflowFor() {
  const workflows = useBookingWorkflows();
  const globalDefault = workflows.find((w) => w.isDefault)?.id ?? null;
  return (progress: BookingProgressView): WorkflowOption | null => {
    const id = progress.exists
      ? progress.workflowId
      : (progress.locationDefaultWorkflowId ?? globalDefault);
    return workflows.find((w) => w.id === id) ?? null;
  };
}

/** One step chip: filled when done, outlined when it's the next one, dashed otherwise. */
function StepChip({
  step,
  done,
  doneOn,
  isNext,
  locked = false,
  canEdit,
  pending,
  onToggle,
  children,
}: {
  step: WorkflowStepOption;
  done: boolean;
  doneOn?: string;
  isNext: boolean; // the upcoming step — outlined, amber when it's ours
  // Steps go in order (stepGate): locked = can't be done yet (an earlier step
  // is open) or undone yet (a later step is done).
  locked?: boolean;
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={!canEdit || pending || locked}
      aria-pressed={done}
      title={[
        step.label,
        step.actor === "VENUE" ? "Venue" : "Us",
        done && doneOn ? formatDate(doneOn) : null,
      ]
        .filter(Boolean)
        .join(" · ")}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors focus-ring disabled:cursor-default",
        done
          ? cn("border-transparent font-medium", BOOKING_STATUS_CLASSES[step.status])
          : isNext
            ? step.actor === "VENUE"
              ? "border-foreground/30 text-muted-foreground"
              : cn("font-medium", OURS_CHIP_CLASSES)
            : "border-dashed text-muted-foreground",
        canEdit && !locked && !done && "hover:border-foreground/60",
      )}
    >
      {done ? <Check className="size-3" aria-hidden /> : null}
      {children ?? step.label}
    </button>
  );
}

/** A booking's whole step strip, one click per step. */
export function StepStrip({
  name,
  steps,
  done,
  doneOn,
  status,
  canEdit,
  pending,
  onToggle,
}: {
  name: string;
  steps: WorkflowStepOption[];
  done: Set<string>;
  doneOn: Map<string, string>;
  status: BookingStatus;
  canEdit: boolean;
  pending: boolean;
  onToggle: (stepId: string) => void;
}) {
  const next = upcomingStep(
    steps,
    [...done].map((stepId) => ({ stepId })),
    status,
  );
  const gate = stepGate(steps, done);
  return (
    <ol className="flex min-w-0 flex-1 flex-wrap gap-1" aria-label={`${name} steps`}>
      {steps.map((s) => (
        <li key={s.id}>
          <StepChip
            step={s}
            done={done.has(s.id)}
            doneOn={doneOn.get(s.id)}
            isNext={s.id === next?.id}
            locked={
              !(done.has(s.id) ? gate.get(s.id)?.canUndo : gate.get(s.id)?.canComplete)
            }
            canEdit={canEdit}
            pending={pending}
            onToggle={() => onToggle(s.id)}
          />
        </li>
      ))}
    </ol>
  );
}

// Optimistic done-step sets per booking key, patched by clicks and bulk marks.
function useDoneSteps(lines: { key: string; progress: BookingProgressView }[]) {
  return useOptimistic(
    new Map(
      lines.map((l) => [l.key, new Set(l.progress.completions.map((c) => c.stepId))]),
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
}

/**
 * Compact single-line progress: the upcoming step as a one-click chip led by
 * its owner ("Next for you: Sign agreement", "Next (venue): Confirm
 * availability · 12d" — clicking ticks it), then the status control (whole
 * ladder in its popover). A venue not engaged yet reads "Next: …". Read-only
 * chip for viewers.
 */
export function CompactProgress({
  target,
  progress,
  canEdit,
  showAge = false,
}: {
  target: BookingTarget;
  progress: BookingProgressView;
  canEdit: boolean;
  showAge?: boolean;
}) {
  const workflow = useWorkflowFor()(progress);
  const [pending, start] = useTransition();
  const [done, patchDone] = useDoneSteps([{ key: "b", progress }]);
  const doneSet = done.get("b") ?? new Set<string>();
  // todayUtc() isolates "now" in lib (react-hooks/purity), like daysSince.
  const today = todayUtc();
  const waiting = workflow
    ? waitingFromView(workflow.steps, progress, today, doneSet)
    : null;
  const next = waiting?.step ?? null;
  const days = waiting?.since ? daysWaiting(waiting.since, today) : 0;
  // Owner-led once the booking exists; an untouched venue just shows "Next".
  const owned = progress.exists && waiting != null;

  const tick = (stepId: string) =>
    start(async () => {
      patchDone([{ key: "b", stepId, on: true }]);
      const res = await setBookingStepAction(target, stepId, true, toDateInput(todayUtc()));
      if (res.error) toast.error(res.error);
    });

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {next ? (
        <StepChip
          step={next}
          done={false}
          isNext
          canEdit={canEdit}
          pending={pending}
          onToggle={() => tick(next.id)}
        >
          {owned ? (
            <>
              <span className={cn(waiting.actor === "US" && "font-semibold")}>
                {ACTOR_PREFIX[waiting.actor]}:
              </span>{" "}
              {next.label}
              {days > 0 ? <span className="opacity-70"> · {days}d</span> : null}
            </>
          ) : (
            <>
              <span className="text-muted-foreground">Next:</span> {next.label}
            </>
          )}
        </StepChip>
      ) : null}
      <WorkflowControl
        target={target}
        progress={progress}
        canEdit={canEdit}
        // The owner chip already says how long it's been waiting.
        showAge={showAge && !owned}
      />
    </span>
  );
}

/** One booking's full step strip (one click per step) + its status control. */
export function BookingStepStrip({
  name,
  target,
  progress,
  canEdit,
}: {
  name: string;
  target: BookingTarget;
  progress: BookingProgressView;
  canEdit: boolean;
}) {
  const workflow = useWorkflowFor()(progress);
  const [pending, start] = useTransition();
  const [done, patchDone] = useDoneSteps([{ key: "b", progress }]);
  const doneSet = done.get("b") ?? new Set<string>();

  const toggle = (stepId: string) => {
    const on = !doneSet.has(stepId);
    start(async () => {
      patchDone([{ key: "b", stepId, on }]);
      const res = await setBookingStepAction(target, stepId, on, toDateInput(todayUtc()));
      if (res.error) toast.error(res.error);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {workflow ? (
        <StepStrip
          name={name}
          steps={workflow.steps}
          done={doneSet}
          doneOn={new Map(progress.completions.map((c) => [c.stepId, c.completedOn]))}
          status={progress.status}
          canEdit={canEdit}
          pending={pending}
          onToggle={toggle}
        />
      ) : null}
      <WorkflowControl target={target} progress={progress} canEdit={canEdit} showAge={false} />
    </div>
  );
}

const normalize = (label: string) => label.trim().toLowerCase();

/** Client-resolved `WaitingView` (optimistic done set) for `WaitingNote`. */
function waitingNoteFor(
  steps: WorkflowStepOption[],
  progress: BookingProgressView,
  doneIds?: Set<string>,
): WaitingView | null {
  const today = todayUtc();
  return waitingView(waitingFromView(steps, progress, today, doneIds), today);
}

export type ProgressLine = {
  key: string;
  name: string;
  href?: string;
  detail: string;
  target: BookingTarget;
  progress: BookingProgressView;
};

/** Rows of bookings with their step strips, plus multi-select bulk marking by step label. */
export function ProgressList({
  lines,
  canEdit,
}: {
  lines: ProgressLine[];
  canEdit: boolean;
}) {
  const workflowFor = useWorkflowFor();
  const workflowByKey = new Map(lines.map((l) => [l.key, workflowFor(l.progress)]));

  const [pending, start] = useTransition();
  const [done, patchDone] = useDoneSteps(lines);
  const doneOn = new Map(
    lines.map((l) => [
      l.key,
      new Map(l.progress.completions.map((c) => [c.stepId, c.completedOn])),
    ]),
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLabel, setBulkLabel] = useState<string>("");

  const toggleStep = (line: ProgressLine, stepId: string) => {
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
        .flatMap((l) => workflowByKey.get(l.key)?.steps ?? [])
        .map((s) => [normalize(s.label), s.label]),
    ).values(),
  ];
  const label = bulkLabels.find((l) => normalize(l) === normalize(bulkLabel))
    ? bulkLabel
    : "";
  const runBulk = (on: boolean) => {
    const entries: { line: ProgressLine; stepId: string }[] = [];
    let lacking = 0;
    let blocked = 0;
    for (const l of chosen) {
      const steps = workflowByKey.get(l.key)?.steps ?? [];
      const step = steps.find((s) => normalize(s.label) === normalize(label));
      if (!step) {
        lacking++;
        continue;
      }
      const rowDone = done.get(l.key) ?? new Set<string>();
      if (rowDone.has(step.id) === on) continue; // already there
      // Steps go in order: skip rows whose earlier steps are open (done) or
      // whose later steps are done (clear).
      const g = stepGate(steps, rowDone).get(step.id);
      if (!(on ? g?.canComplete : g?.canUndo)) {
        blocked++;
        continue;
      }
      entries.push({ line: l, stepId: step.id });
    }
    const notes = [
      lacking ? `${lacking} ${lacking === 1 ? "has" : "have"} no "${label}" step.` : "",
      blocked
        ? `${blocked} skipped: ${on ? "earlier steps not done" : "later steps done"}.`
        : "",
    ];
    const lackingNote = notes.filter(Boolean).map((n) => ` ${n}`).join("");
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
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Mark done
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !label}
                onClick={() => runBulk(false)}
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Clear
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={pending}
                onClick={markNotNeeded}
              >
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                Not needed
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <ul className="divide-y rounded-lg border">
        {lines.map((line) => {
          const workflow = workflowByKey.get(line.key) ?? null;
          const notNeeded = line.progress.status === "NOT_NEEDED";
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
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {line.href ? (
                      <Link href={line.href} className="link-quiet">
                        {line.name}
                      </Link>
                    ) : (
                      line.name
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {[line.detail, workflow?.name].filter(Boolean).join(" · ")}
                  </p>
                  {line.progress.exists && workflow ? (
                    <WaitingNote
                      className="block"
                      waiting={waitingNoteFor(
                        workflow.steps,
                        line.progress,
                        done.get(line.key),
                      )}
                    />
                  ) : null}
                </div>
              </div>

              <StepStrip
                name={line.name}
                steps={workflow?.steps ?? []}
                done={done.get(line.key) ?? new Set<string>()}
                doneOn={doneOn.get(line.key) ?? new Map()}
                status={line.progress.status}
                canEdit={canEdit}
                pending={pending}
                onToggle={(stepId) => toggleStep(line, stepId)}
              />

              <div className="sm:shrink-0">
                <WorkflowControl
                  target={line.target}
                  progress={line.progress}
                  canEdit={canEdit}
                  // The owner note beside the name already says how long.
                  showAge={!(line.progress.exists && workflow)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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
  const lines: (ProgressLine & { firstDay: number | null })[] = [
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
          progress: r.progress,
        };
      }),
    ...itemRows.map((r) => ({
      key: `i:${r.bookingId}`,
      name: r.label,
      detail: `Day ${r.dayIndex}${r.date ? ` · ${formatDate(r.date)}` : ""}`,
      firstDay: r.dayIndex,
      target: { bookingId: r.bookingId },
      progress: r.progress,
    })),
  ].sort(
    (a, b) =>
      (a.firstDay ?? Infinity) - (b.firstDay ?? Infinity) ||
      a.name.localeCompare(b.name),
  );

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to book.</p>;
  }
  return <ProgressList lines={lines} canEdit={canEdit} />;
}
