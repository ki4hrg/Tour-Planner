import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import type { StepActor, WaitingView } from "@/lib/booking-workflow";

// Whose move a booking is. Each workflow step has an owner
// (BookingWorkflowStep.actor); the booking's upcoming step decides who holds
// the ball. Ours reads prominent (amber), the venue's muted with how long
// we've been waiting. Plain presentational pieces — no hooks, so both Server
// and Client Components render them. The prefix says "next", not "done":
// step labels are past-tense milestones ("Menu chosen"), so "Your move: Menu
// chosen" would read as finished.

export const ACTOR_PREFIX: Record<StepActor, string> = {
  US: "Next for you",
  VENUE: "Next (venue)",
};

/** Chip colouring for a step that's ours. */
export const OURS_CHIP_CLASSES =
  "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200";

/**
 * Read-only owner line from a resolved `WaitingView` — "Next for you: Sign
 * agreement · 3d" / "Next (venue): Confirm availability · 12d".
 */
export function WaitingNote({
  waiting,
  className,
}: {
  waiting: WaitingView | null;
  className?: string;
}) {
  if (!waiting) return null;
  // Ours AND due reads as the to-do it is; a step with a future due date is
  // just information until then, so it stays muted and says when.
  const ours = waiting.actor === "US" && waiting.due;
  const notYet = !waiting.due && waiting.dueOn;
  return (
    <span
      className={cn(
        "text-xs",
        ours
          ? "font-medium text-amber-800 dark:text-amber-300"
          : "text-muted-foreground",
        className,
      )}
      title={
        notYet
          ? `Due ${formatDate(waiting.dueOn)}`
          : waiting.since
            ? `Since ${formatDate(waiting.since)}`
            : undefined
      }
    >
      {ACTOR_PREFIX[waiting.actor]}: {waiting.stepLabel}
      {notYet
        ? ` · from ${formatDate(waiting.dueOn)}`
        : waiting.days
          ? ` · ${waiting.days}d`
          : ""}
    </span>
  );
}
