"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
const clientOrigin = () => window.location.origin;
const clientHost = () => window.location.host;
const serverValue = () => "";

// The page's origin/host, known only in the browser. The server snapshot is ""
// and hydration uses it too, so server and client markup match (reading
// window.location during render produced a hydration mismatch on every
// share/feed link); the absolute URLs fill in right after hydration.
export function useOrigin(): { origin: string; host: string } {
  const origin = useSyncExternalStore(noop, clientOrigin, serverValue);
  const host = useSyncExternalStore(noop, clientHost, serverValue);
  return { origin, host };
}
