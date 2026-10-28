"use client";

import { Badge } from "@/components/ui/badge";
import { useId } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, COST_UNIT_LABELS } from "@/lib/money";
import {
  agreedTotal,
  formatPriceBreakdown,
  listPriceLines,
  priceLineSums,
  type CostLike,
  type PriceLine,
} from "@/lib/costs";

// The itemized agreed price (BookingPriceLine), shared by the venue-engagement
// editor on the booking dashboard and the site-less item booking form in the
// itinerary. Lines mirror the venue's Cost lines, so the total follows the trip
// headcount (`agreedTotal` in costs.ts).


// Compact read view: a lone per-group line is just its amount; anything else
// shows its working — "Admission £12 + Lunch £20 /person × 40 + Group £90 =
// £1,370". Per-person lines with no headcount get the amber chip (the total —
// and so the balance — is then unknown).
export function AgreedPrice({
  lines,
  currency,
  headcount,
}: {
  lines: PriceLine[];
  currency: string;
  headcount: number | null;
}) {
  if (lines.length === 0) return null;
  const unknown = agreedTotal(lines, headcount) == null;
  return (
    <>
      <span>{formatPriceBreakdown(lines, currency, headcount)}</span>
      {unknown ? <Badge variant="attention">no headcount</Badge> : null}
    </>
  );
}

// One editable line's local form state (amount kept as typed). `stale` marks
// a line copied from a list price unconfirmed for 1+ year; it clears once the
// amount is edited (the planner has then checked it) and never reaches the save.
export type PriceLineDraft = {
  key: number;
  label: string;
  amount: string;
  unit: PriceLine["unit"];
  stale?: boolean;
};

export function draftsFromLines(lines: PriceLine[]): PriceLineDraft[] {
  return lines.map((l, i) => ({
    key: i,
    label: l.label,
    amount: String(l.amount),
    unit: l.unit,
  }));
}

const isBlank = (d: PriceLineDraft) => !d.label.trim() && !d.amount.trim();

// What the save sends: untouched blank rows are dropped; a labelled row with
// no amount reaches the validator and comes back as an error.
export function draftsToInput(drafts: PriceLineDraft[]) {
  return drafts
    .filter((d) => !isBlank(d))
    .map((d) => ({ label: d.label.trim(), amount: d.amount.trim(), unit: d.unit }));
}

// Parseable drafts as PriceLines, for the live total.
function draftsToLines(drafts: PriceLineDraft[]): PriceLine[] {
  return drafts
    .filter((d) => d.amount.trim() !== "" && Number.isFinite(Number(d.amount)))
    .map((d) => ({ label: d.label.trim(), amount: Number(d.amount), unit: d.unit }));
}

export function PriceLinesEditor({
  drafts,
  onDraftsChange,
  currency,
  onCurrencyChange,
  currencyChoices,
  headcount,
  listCosts,
  disabled,
}: {
  drafts: PriceLineDraft[];
  onDraftsChange: (next: PriceLineDraft[]) => void;
  currency: string;
  onCurrencyChange: (c: string) => void;
  currencyChoices: string[];
  headcount: number | null;
  // The venue's list prices (Cost catalog); omit for a site-less booking.
  listCosts?: (CostLike & { label: string })[];
  disabled?: boolean;
}) {
  const uid = useId();
  const nextKey = () => (drafts[drafts.length - 1]?.key ?? -1) + 1;
  const patch = (key: number, part: Partial<PriceLineDraft>) =>
    onDraftsChange(drafts.map((d) => (d.key === key ? { ...d, ...part } : d)));
  const addLine = () =>
    onDraftsChange([
      ...drafts,
      { key: nextKey(), label: "", amount: "", unit: "PER_PERSON" },
    ]);

  const list = listCosts?.length ? listPriceLines(listCosts, currency) : null;
  const useListPrice = () => {
    if (!list) return;
    if (
      drafts.some((d) => !isBlank(d)) &&
      !window.confirm("Replace price lines with the venue's list prices?")
    )
      return;
    onDraftsChange(
      list.lines.map((l, i) => ({
        key: i,
        label: l.label,
        amount: String(l.amount),
        unit: l.unit,
        stale: l.stale,
      })),
    );
    onCurrencyChange(list.currency);
  };

  const lines = draftsToLines(drafts);
  const { perPerson, perGroup, hasPerPerson } = priceLineSums(lines);
  const total = agreedTotal(lines, headcount);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label htmlFor={`${uid}-currency`} className="text-xs">
          Agreed price
        </Label>
        <Select value={currency} onValueChange={onCurrencyChange} disabled={disabled}>
          <SelectTrigger
            id={`${uid}-currency`}
            size="sm"
            className="h-7 w-20"
            aria-label="Currency"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencyChoices.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {list ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={disabled}
            onClick={useListPrice}
            className="ml-auto h-auto p-0 text-xs font-normal text-muted-foreground link-quiet"
          >
            Use list price
          </Button>
        ) : null}
      </div>

      {/* Each line wraps on a phone: the label keeps a readable width and the
          amount, basis and remove controls take the next line. */}
      {drafts.map((d) => (
        <div key={d.key} className="flex flex-wrap items-center gap-1.5">
          <Input
            value={d.label}
            onChange={(e) => patch(d.key, { label: e.target.value })}
            placeholder="e.g. Admission"
            aria-label="Line label"
            className="min-w-32 flex-1"
            disabled={disabled}
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={d.amount}
            onChange={(e) => patch(d.key, { amount: e.target.value, stale: false })}
            aria-label="Amount"
            className="w-24"
            disabled={disabled}
          />
          {d.stale ? (
            <Badge
              variant="attention"
              className="shrink-0"
              title="List price unconfirmed for 1+ year"
            >
              stale
            </Badge>
          ) : null}
          <Select
            value={d.unit}
            onValueChange={(unit) => patch(d.key, { unit: unit as PriceLine["unit"] })}
            disabled={disabled}
          >
            <SelectTrigger size="sm" className="w-28" aria-label="Basis">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PER_PERSON">{COST_UNIT_LABELS.PER_PERSON}</SelectItem>
              <SelectItem value="PER_GROUP">{COST_UNIT_LABELS.PER_GROUP}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground"
            aria-label="Remove line"
            disabled={disabled}
            onClick={() => onDraftsChange(drafts.filter((x) => x.key !== d.key))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={disabled}
          onClick={addLine}
        >
          + Add line
        </Button>
        {lines.length > 0 ? (
          total != null ? (
            <span>
              <span className="text-muted-foreground">
                {hasPerPerson
                  ? `${formatMoney(perPerson, currency)} /person × ${headcount}${
                      perGroup ? ` + ${formatMoney(perGroup, currency)}` : ""
                    } = `
                  : "Total "}
              </span>
              <span className="font-medium">{formatMoney(total, currency)}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">
                {formatMoney(perPerson, currency)} /person
                {perGroup ? ` + ${formatMoney(perGroup, currency)}` : ""}
              </span>
              <Badge variant="attention">no headcount</Badge>
            </span>
          )
        ) : null}
        {list?.skipped ? (
          <span className="text-muted-foreground">
            {list.skipped} list price{list.skipped === 1 ? "" : "s"} in other
            currencies
          </span>
        ) : null}
      </div>
    </div>
  );
}
