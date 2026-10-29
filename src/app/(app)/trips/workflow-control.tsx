"use client";

import { BookingStatusPill } from "@/components/booking-status-pill";
import { useId, useOptimistic, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import type { BookingStatus } from "@prisma/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBookingWorkflows } from "@/components/booking-workflows";
import { cn } from "@/lib/utils";
import { daysSince, formatDate, toDateInput, todayUtc } from "@/lib/dates";
import {
  resolveBookingProgress,
  stepGate,
  type BookingProgressView,
} from "@/lib/booking-workflow";
import {
  BOOKING_STATUS_FLOW,
  BOOKING_STATUS_LABELS,
  bookingStageText,
} from "@/lib/trips";
import { isBookingOff } from "@/lib/booking";
import type { FormState } from "@/lib/forms";
import {
  setBookingStatus,
  setBookingStepAction,
  setBookingWorkflowAction,
  setVenueBookingStatus,
  type BookingTarget,
} from "./actions";

const NONE = "__none__";

type ProgressState = Omit<BookingProgressView, "exists" | "locationDefaultWorkflowId">;

/** Read-only status: the master status pill, then its workflow stage. */
export const BookingStagePill = BookingStatusPill;

// "· 12d" — how long a booking has sat at its current stage while still being
// chased (underway, not yet secured).
function StageAge({ status, stageOn }: { status: BookingStatus; stageOn: string | null }) {
  const days = status === "IN_PROGRESS" ? daysSince(stageOn) : null;
  if (days == null || days < 1) return null;
  return (
    <span
      className="text-xs text-muted-foreground"
      title={`At this stage since ${formatDate(stageOn)}`}
    >
      {days}d at stage
    </span>
  );
}

/**
 * The one booking status control, shared by every surface that shows a booking
 * (dashboard rows, board cards, lodging, location page, cross-trip views). A
 * pill showing the stage opens a popover to tick workflow steps (dated, back-
 * datable), switch the booking's workflow, or mark it not needed. A booking
 * with no workflow gets a plain status select instead of steps.
 */
export function WorkflowControl({
  target,
  progress,
  canEdit,
  showAge = true,
}: {
  target: BookingTarget;
  progress: BookingProgressView;
  canEdit: boolean;
  showAge?: boolean;
}) {
  const workflows = useBookingWorkflows();
  const uid = useId();
  const [pending, start] = useTransition();
  const globalDefault = workflows.find((w) => w.isDefault)?.id ?? null;
  // A venue not engaged yet shows the workflow its first touch will seed.
  const workflowId = progress.exists
    ? progress.workflowId
    : (progress.locationDefaultWorkflowId ?? globalDefault);
  const workflow = workflows.find((w) => w.id === workflowId) ?? null;

  const [state, apply] = useOptimistic<ProgressState, Partial<ProgressState>>(
    {
      status: progress.status,
      stageLabel: progress.stageLabel,
      stageOn: progress.stageOn,
      workflowId,
      completions: progress.completions,
    },
    (prev, patch) => {
      const next = { ...prev, ...patch };
      const wf = workflows.find((w) => w.id === next.workflowId);
      if (!wf) return next;
      const p = resolveBookingProgress(
        wf.steps,
        next.completions.map((c) => ({
          stepId: c.stepId,
          completedOn: new Date(`${c.completedOn}T00:00:00.000Z`),
        })),
        next.status,
      );
      return {
        ...next,
        status: p.status,
        stageLabel: p.stageLabel,
        stageOn: p.stageOn ? toDateInput(p.stageOn) : null,
      };
    },
  );

  const pill = (
    <BookingStagePill
      status={state.status}
      stageLabel={state.stageLabel}
      stageOn={state.stageOn}
    />
  );

  if (!canEdit) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {pill}
        {showAge ? <StageAge status={state.status} stageOn={state.stageOn} /> : null}
      </span>
    );
  }

  const run = (patch: Partial<ProgressState>, fn: () => Promise<FormState>) =>
    start(async () => {
      apply(patch);
      const res = await fn();
      if (res.error) toast.error(res.error);
      else if (res.message) toast.success(res.message);
    });

  const setStatus = (status: BookingStatus) =>
    run({ status }, () =>
      "bookingId" in target
        ? setBookingStatus(target.bookingId, status)
        : setVenueBookingStatus(target.tripId, target.locationId, status),
    );

  const setStep = (stepId: string, done: boolean, on?: string) => {
    const completedOn = on ?? toDateInput(todayUtc());
    run(
      {
        completions: done
          ? [
              ...state.completions.filter((c) => c.stepId !== stepId),
              { stepId, completedOn },
            ]
          : state.completions.filter((c) => c.stepId !== stepId),
      },
      () => setBookingStepAction(target, stepId, done, completedOn),
    );
  };

  const setWorkflow = (id: string) => {
    const next = id === NONE ? null : id;
    if (next === state.workflowId) return;
    if (
      state.completions.length > 0 &&
      !window.confirm("Switch workflow? Ticked steps will be cleared.")
    ) {
      return;
    }
    run(
      {
        workflowId: next,
        completions: [],
        stageLabel: null,
        stageOn: null,
        ...(next && !isBookingOff(state.status) ? { status: "PENDING" } : {}),
      },
      () => setBookingWorkflowAction(target, next),
    );
  };

  const doneOn = new Map(state.completions.map((c) => [c.stepId, c.completedOn]));
  const gate = stepGate(workflow?.steps ?? [], new Set(doneOn.keys()));
  const off = isBookingOff(state.status);

  return (
    <span className="inline-flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full",
            pending && "opacity-60",
          )}
          aria-label={`Booking status: ${bookingStageText(state)}`}
        >
          {pill}
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        </PopoverTrigger>
        <PopoverContent className="w-80 space-y-3">
          <Select
            value={state.workflowId ?? NONE}
            onValueChange={setWorkflow}
            disabled={pending}
          >
            <SelectTrigger size="sm" className="w-full" aria-label="Workflow">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
              <SelectItem value={NONE}>No workflow</SelectItem>
            </SelectContent>
          </Select>

          {workflow && state.workflowId === workflow.id ? (
            workflow.steps.length ? (
              <ol className="space-y-1.5">
                {workflow.steps.map((s) => {
                  const on = doneOn.get(s.id);
                  const id = `${uid}-${s.id}`;
                  const g = gate.get(s.id);
                  const locked = on != null ? !g?.canUndo : !g?.canComplete;
                  return (
                    <li key={s.id} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={on != null}
                        disabled={pending || locked}
                        onCheckedChange={(v) => setStep(s.id, v === true)}
                      />
                      <Label
                        htmlFor={id}
                        className={cn(
                          "flex-1 text-sm font-normal",
                          (s.status === "CONFIRMED" || s.status === "FINALIZED") &&
                            "font-medium",
                          on == null && locked && "text-muted-foreground",
                        )}
                      >
                        {s.label}
                      </Label>
                      {on ? (
                        <input
                          type="date"
                          value={on}
                          aria-label={`${s.label} date`}
                          className="rounded border bg-transparent px-1 text-xs text-muted-foreground"
                          disabled={pending}
                          onChange={(e) => {
                            if (e.target.value) setStep(s.id, true, e.target.value);
                          }}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No steps.</p>
            )
          ) : (
            <Select
              value={off ? "PENDING" : state.status}
              onValueChange={(v) => setStatus(v as BookingStatus)}
              disabled={pending || off}
            >
              <SelectTrigger size="sm" className="w-full" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOOKING_STATUS_FLOW.map((s) => (
                  <SelectItem key={s} value={s}>
                    {BOOKING_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* The off-ladder overrides: either one, or neither (back in play —
              a workflow booking re-derives its status from its steps). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-2">
            {(["CANCELLED", "NOT_NEEDED"] as const).map((s) => (
              <div key={s} className="flex items-center gap-2">
                <Checkbox
                  id={`${uid}-${s}`}
                  checked={state.status === s}
                  disabled={pending}
                  onCheckedChange={(v) => setStatus(v === true ? s : "PENDING")}
                />
                <Label htmlFor={`${uid}-${s}`} className="text-sm font-normal">
                  {BOOKING_STATUS_LABELS[s]}
                </Label>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {showAge ? <StageAge status={state.status} stageOn={state.stageOn} /> : null}
    </span>
  );
}
