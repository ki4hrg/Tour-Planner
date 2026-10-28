import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The one URL-param filter chip (a navigating control, so a Link). In-page view
// switches over the same data use <Tabs> instead.
export function FilterChip({
  active,
  className,
  ...props
}: ComponentProps<typeof Link> & { active: boolean }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center rounded-full border px-3 py-1 text-sm focus-ring pointer-coarse:min-h-10",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
