import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

// The one back link: chevron + "All <plural>", on its own line above the h1.
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Link
        href={href}
        className={cn(
          "inline-flex items-center gap-0.5 text-sm text-muted-foreground link-quiet",
        )}
      >
        <ChevronLeft className="size-4" />
        {label}
      </Link>
    </div>
  );
}
