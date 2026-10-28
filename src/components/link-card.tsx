import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// An entity card in a list: the whole card is the link. Secondary actions
// (Duplicate, badges with their own links) go OUTSIDE it — nested anchors are
// invalid HTML — in a sibling row inside the same grid cell.
export function LinkCard({
  href,
  className,
  cardClassName,
  children,
}: {
  href: string;
  className?: string;
  cardClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn("block rounded-xl focus-ring", className)}>
      <Card
        className={cn(
          "h-full transition-shadow hover:ring-foreground/25",
          cardClassName,
        )}
      >
        {children}
      </Card>
    </Link>
  );
}
