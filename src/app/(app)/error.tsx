"use client";

import { Button } from "@/components/ui/button";

// Backstop for an uncaught error in any authenticated page: keep the shell,
// offer a reload. Direct-call editors catch their own network failures
// (src/lib/use-action.ts); this catches everything else.
export default function AppError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        The page could not load. Unsaved edits were not kept.
      </p>
      <div className="flex justify-center gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
