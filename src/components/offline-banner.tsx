"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// Sticky offline notice for the authenticated shell. Serwist serves cached
// reads offline, so pages still render — this flags that what you're seeing
// may be stale and that edits won't reach the server.
export function OfflineBanner() {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true, // SSR: assume online
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-center text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <WifiOff className="size-4 shrink-0" />
      Offline — changes won&apos;t save.
    </div>
  );
}
