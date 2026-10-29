"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck, CalendarClock, CalendarX, Loader2 } from "lucide-react";
import type { ItemConfirmation } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { setItemConfirmation } from "./actions";

// One item's own arrangement with its venue — the lunch time agreed, the
// reception slot — as opposed to the venue engagement's booking status, which
// covers the whole visit. Reads as a calendar icon + "Time …" so it can't be
// mistaken for the booking's status pill beside the venue. Unset is a thing we
// still have to raise: amber.

export const ITEM_CONFIRMATION_LABELS: Record<ItemConfirmation | "NONE", string> = {
  NONE: "Time unconfirmed",
  REQUESTED: "Time requested",
  CONFIRMED: "Time confirmed",
};

const ICONS = {
  NONE: CalendarX,
  REQUESTED: CalendarClock,
  CONFIRMED: CalendarCheck,
} as const;

const TONES = {
  NONE: "text-amber-800 dark:text-amber-300",
  REQUESTED: "text-muted-foreground",
  CONFIRMED: "text-emerald-700 dark:text-emerald-400",
} as const;

function Face({
  value,
  confirmedOn,
  pending,
}: {
  value: ItemConfirmation | null;
  confirmedOn?: string | null;
  pending?: boolean;
}) {
  const key = value ?? "NONE";
  const Icon = pending ? Loader2 : ICONS[key];
  return (
    <>
      <Icon className={cn("size-3.5", pending && "animate-spin")} aria-hidden />
      {ITEM_CONFIRMATION_LABELS[key]}
      {value && confirmedOn ? (
        <span className="text-muted-foreground"> · {formatDate(confirmedOn)}</span>
      ) : null}
    </>
  );
}

export function ItemConfirmationControl({
  itemId,
  confirmation,
  confirmedOn,
  canEdit,
  className,
}: {
  itemId: string;
  confirmation: ItemConfirmation | null;
  confirmedOn: string | null;
  canEdit: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [value, setOptimistic] = useOptimistic(confirmation);
  const tone = TONES[value ?? "NONE"];

  if (!canEdit) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs", tone, className)}>
        <Face value={value} confirmedOn={confirmedOn} />
      </span>
    );
  }

  const pick = (v: string) =>
    start(async () => {
      const next = v === "NONE" ? null : (v as ItemConfirmation);
      setOptimistic(next);
      const res = await setItemConfirmation(itemId, next);
      if (res.error) toast.error(res.error);
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          // The tone is the state: keep it through hover / open.
          className={cn(
            "-my-1 h-6 gap-1 px-1.5 text-xs",
            tone,
            value === "CONFIRMED"
              ? "hover:text-emerald-800 aria-expanded:text-emerald-800 dark:hover:text-emerald-300"
              : value === "REQUESTED"
                ? "hover:text-foreground"
                : "hover:text-amber-900 aria-expanded:text-amber-900 dark:hover:text-amber-200",
            className,
          )}
          aria-label={`${ITEM_CONFIRMATION_LABELS[value ?? "NONE"]} with the venue`}
        >
          <Face value={value} confirmedOn={confirmedOn} pending={pending} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto">
        <DropdownMenuRadioGroup value={value ?? "NONE"} onValueChange={pick}>
          {(["NONE", "REQUESTED", "CONFIRMED"] as const).map((k) => (
            <DropdownMenuRadioItem key={k} value={k}>
              {ITEM_CONFIRMATION_LABELS[k]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
