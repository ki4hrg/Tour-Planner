import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import type { StepActor, WaitingView } from "@/lib/booking-workflow";

// Whose move a booking is. Each workflow step has an owner
// (BookingWorkflowStep.actor); the booking's upcoming step decides who holds
// the ball. Ours reads prominent (amber), the venue's muted with how long
// we've been waiting. Plain presentational pieces — no hooks, so both Server
// and Client Components render them.

export const ACTOR_PREFIX: Record<StepActor, string> = {
  US: "Your move",
  VENUE: "Waiting on venue",
};

/** Chip colouring for a step that's ours. */
export const OURS_CHIP_CLASSES =
  "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200";

/**
 * Read-only owner line from a resolved `WaitingView` — "Your move: Sign
 * agreement · 3d" / "Waiting on venue: Confirm availability · 12d".
 */
export function WaitingNote({
  waiting,
  className,
}: {
  waiting: WaitingView | null;
  className?: string;
}) {
  if (!waiting) return null;
  const ours = waiting.actor === "US";
  return (
    <span
      className={cn(
        "text-xs",
        ours
          ? "font-medium text-amber-800 dark:text-amber-300"
          : "text-muted-foreground",
        className,
      )}
      title={waiting.since ? `Since ${formatDate(waiting.since)}` : undefined}
    >
      {ACTOR_PREFIX[waiting.actor]}: {waiting.stepLabel}
      {waiting.days ? ` · ${waiting.days}d` : ""}
    </span>
  );
}
