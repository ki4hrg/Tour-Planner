"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A labelled accent-color field: a native color swatch synced with a text input.
// The text input carries the form `name` so the value still posts (and can be
// cleared to empty — a native color input alone can't represent "no color").
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
  const swatch = isHex ? value : "#2e5e4e";

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={name}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} swatch`}
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
