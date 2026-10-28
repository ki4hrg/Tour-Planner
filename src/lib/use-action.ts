"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import type { FormState } from "@/lib/forms";

// Run a FormState-returning Server Action from a direct-call editor and
// surface the result as a toast. One copy for the whole app: a save that
// never reaches the server (dead signal on the coach) rejects inside the
// transition, and an uncaught rejection there unmounts the page and loses
// the draft — so the network failure is caught here, toasted, and the form
// is left open (onOk is not called).
export function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>, onOk?: () => void) =>
    start(async () => {
      let res: FormState;
      try {
        res = await fn();
      } catch {
        toast.error("Couldn't reach the server. Try again.");
        return;
      }
      if (res.error) toast.error(res.error);
      else {
        if (res.message) toast.success(res.message);
        onOk?.();
      }
    });
  return { pending, run };
}
