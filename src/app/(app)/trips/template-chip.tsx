import { LayoutTemplate } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Distinct chip marking a Trip as a reusable template. Uses the ochre `accent`
 * so it reads apart from the neutral `secondary` planning-status chips.
 */
export function TemplateChip({ className }: { className?: string }) {
  return (
    <Badge variant="accent" className={cn("shrink-0", className)}>
      <LayoutTemplate data-icon="inline-start" />
      Template
    </Badge>
  );
}
