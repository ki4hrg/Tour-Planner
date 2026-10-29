"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type PickerOption = { id: string; name: string; detail: string | null };

// Type-to-filter list for picking one row out of a long catalog (contacts,
// locations). Shows the first 8 matches once something is typed.
export function SearchPicker({
  options,
  placeholder,
  emptyText,
  onPick,
  disabled,
}: {
  options: PickerOption[];
  placeholder: string;
  emptyText: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = q
    ? options
        .filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.detail?.toLowerCase().includes(q),
        )
        .slice(0, 8)
    : [];

  return (
    <div className="space-y-2">
      <Input
        placeholder={placeholder}
        aria-label={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      {matches.length ? (
        <ul className="max-w-sm divide-y rounded-md border text-sm">
          {matches.map((o) => (
            <li key={o.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onPick(o.id)}
                className="h-auto min-h-8 w-full justify-between gap-2 rounded-none px-3 py-2 text-left font-normal"
              >
                <span className="truncate">{o.name}</span>
                {o.detail ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {o.detail}
                  </span>
                ) : null}
              </Button>
            </li>
          ))}
        </ul>
      ) : q ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : null}
    </div>
  );
}
