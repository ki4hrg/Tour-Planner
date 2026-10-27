"use client";

import Link from "next/link";
import { Printer, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// The print page's screen-only controls (hidden in the printout via print:hidden
// on the wrapper). The Print button just invokes the browser print dialog.
export function PrintActions({ tripId }: { tripId: string }) {
  return (
    <div className="flex items-center justify-between gap-3 print:hidden">
      <Link
        href={`/trips/${tripId}`}
        className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="size-4" />
        Overview
      </Link>
      <Button size="sm" onClick={() => window.print()}>
        <Printer className="size-4" /> Print
      </Button>
    </div>
  );
}
