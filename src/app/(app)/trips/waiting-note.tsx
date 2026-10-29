import { cn } from "@/lib/utils";
import {
  waitingAgeText,
  waitingAgeTitle,
  type StepActor,
  type WaitingView,
} from "@/lib/booking-workflow";

// Whose move a booking is. Each workflow step has an owner
// (BookingWorkflowStep.actor); the booking's upcoming step decides who holds
// the ball. Ours reads prominent (amber), the venue's muted. The time half
// counts down to the step's due date when it has one, else says how long it
// has waited (`waitingAgeText`). Plain presentational pieces — no hooks, so both Server
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
 * agreement · due in 3d" / "Next (venue): Confirm availability · waiting 12d".
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
  const age = waitingAgeText(waiting);
  return (
    <span
      className={cn(
        "text-xs",
        ours
          ? "font-medium text-amber-800 dark:text-amber-300"
          : "text-muted-foreground",
        className,
      )}
      title={waitingAgeTitle(waiting)}
    >
      {ACTOR_PREFIX[waiting.actor]}: {waiting.stepLabel}
      {age ? ` · ${age}` : ""}
    </span>
  );
}
