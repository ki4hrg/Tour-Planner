"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Theme-aligned presets — "The Pilgrim's Way" palette (verdigris, brass, claret,
// lichen, ink) plus a few harmonising tints. These colours tint category markers
// and trip-type accents, so they're chosen to read well at small sizes.
const PRESETS = [
  "#2e5e4e", // verdigris / holly green (primary)
  "#46685c", // deep teal
  "#5f8c73", // sage
  "#6b7269", // lichen grey-green
  "#8a8a53", // olive
  "#a9762f", // brass / ochre (accent)
  "#c8994f", // light brass
  "#7a4b33", // chestnut
  "#9b342b", // claret (destructive)
  "#4a5b7a", // slate blue
  "#6d5b8a", // muted plum
  "#22302e", // iron-gall ink
];

// A labelled accent-color field: a grid of theme presets by default, plus a
// native swatch + hex input for off-palette values. The text input carries the
// form `name` so the value still posts (and can be cleared to empty — categories
// and trip types treat "no color" as a valid choice).
export function ColorField({
  name,
  label,
  defaultValue,
  placeholder = "#2e5e4e",
  className,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const isHex = /^#[0-9a-fA-F]{6}$/.test(value);
  const normalized = isHex ? value.toLowerCase() : "";
  const swatch = isHex ? value : "#2e5e4e";

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={name}>{label}</Label>

      <div className="flex flex-wrap gap-1.5">
        {/* Clear / no colour. */}
        <button
          type="button"
          aria-label="No color"
          aria-pressed={value === ""}
          onClick={() => setValue("")}
          className={cn(
            "relative size-7 overflow-hidden rounded-md border bg-background focus-ring",
            value === "" &&
              "ring-2 ring-ring ring-offset-1 ring-offset-background",
          )}
        >
          <span className="absolute left-1/2 top-1/2 h-px w-9 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-destructive" />
        </button>

        {PRESETS.map((c) => {
          const active = normalized === c;
          return (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={active}
              onClick={() => setValue(c)}
              style={{ backgroundColor: c }}
              className={cn(
                "size-7 rounded-md border border-black/10 transition-transform focus-ring hover:scale-105",
                active &&
                  "ring-2 ring-ring ring-offset-1 ring-offset-background",
              )}
            />
          );
        })}
      </div>

      {/* Custom value — native picker + hex text for anything off-palette. */}
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} custom swatch`}
          value={swatch}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
        />
        <Input
          id={name}
          name={name}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </div>
  );
}
