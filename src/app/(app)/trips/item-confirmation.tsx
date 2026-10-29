"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleDashed, CircleEllipsis, Loader2 } from "lucide-react";
import type { ItemConfirmation } from "@prisma/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/dates";
import { setItemConfirmation } from "./actions";

// One item's own arrangement with its venue — whatever has to be agreed for
// this session: the lunch time, the reception slot, or that a meal the host
// includes as standard is actually being taken there — as opposed to the
// venue engagement's booking status, which covers the whole visit. A plain
// icon + word (never a pill) so it can't be mistaken for the booking's status.
// Unset is a thing we still have to raise: amber.

export const ITEM_CONFIRMATION_LABELS: Record<ItemConfirmation | "NONE", string> = {
  NONE: "Unconfirmed",
  REQUESTED: "Requested",
  CONFIRMED: "Confirmed",
};

const ICONS = {
  NONE: CircleDashed,
  REQUESTED: CircleEllipsis,
  CONFIRMED: CircleCheck,
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
  compact,
}: {
  value: ItemConfirmation | null;
  confirmedOn?: string | null;
  pending?: boolean;
  compact?: boolean;
}) {
  const key = value ?? "NONE";
  const Icon = pending ? Loader2 : ICONS[key];
  return (
    <>
      <Icon className={cn("size-3.5", pending && "animate-spin")} aria-hidden />
      {/* Compact rows keep the word only where it asks for action. */}
      {compact && value ? null : ITEM_CONFIRMATION_LABELS[key]}
      {value && confirmedOn && !compact ? (
        <span className="text-muted-foreground"> · {formatDate(confirmedOn)}</span>
      ) : null}
    </>
  );
}

function describe(value: ItemConfirmation | null, confirmedOn: string | null): string {
  const label = `${ITEM_CONFIRMATION_LABELS[value ?? "NONE"]} with the venue`;
  return value && confirmedOn ? `${label} · ${formatDate(confirmedOn)}` : label;
}

export function ItemConfirmationControl({
  itemId,
  confirmation,
  confirmedOn,
  canEdit,
  compact = false,
  className,
}: {
  itemId: string;
  confirmation: ItemConfirmation | null;
  confirmedOn: string | null;
  canEdit: boolean;
  // Icon only once raised (requested / confirmed); the full text is the title.
  compact?: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [value, setOptimistic] = useOptimistic(confirmation);
  const tone = TONES[value ?? "NONE"];

  if (!canEdit) {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-xs", tone, className)}
        title={describe(value, confirmedOn)}
        aria-label={describe(value, confirmedOn)}
      >
        <Face value={value} confirmedOn={confirmedOn} compact={compact} />
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
          title={describe(value, confirmedOn)}
          aria-label={describe(value, confirmedOn)}
        >
          <Face value={value} confirmedOn={confirmedOn} pending={pending} compact={compact} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          With the venue
        </DropdownMenuLabel>
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
