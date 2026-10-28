"use client";

import { useActionState, useEffect, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormState } from "@/lib/forms";
import {
  connectTodoist,
  disconnectTodoist,
  setDefaultTodoistProject,
  setTripTypeTodoistProject,
} from "./actions";

const NONE = "__none__";

function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>, onOk?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else {
        if (res.message) toast.success(res.message);
        onOk?.();
      }
    });
  return { pending, run };
}

export type ProjectOption = { id: string; name: string };

export function TodoistConnectForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    connectTodoist,
    {},
  );

  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="token">API token</Label>
        <Input
          id="token"
          name="token"
          type="password"
          autoComplete="off"
          required
        />
        <a
          href="https://app.todoist.com/app/settings/integrations/developer"
          target="_blank"
          rel="noopener noreferrer"
          className="block w-fit text-xs text-muted-foreground underline hover:text-foreground"
        >
          Get token
        </a>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Verifying…" : "Connect Todoist"}
      </Button>
    </form>
  );
}

export function TodoistManager({
  tokenHint,
  projects,
  defaultProjectId,
  tripTypes,
}: {
  tokenHint: string; // e.g. "…cdef" — never the token itself
  // null = connected but Todoist unreachable right now (selects disabled)
  projects: ProjectOption[] | null;
  defaultProjectId: string | null;
  tripTypes: { id: string; name: string; todoistProjectId: string | null }[];
}) {
  const { pending, run } = useAction();

  const projectSelect = (
    value: string | null,
    onChange: (projectId: string | null) => void,
  ) => (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : v)}
      disabled={pending || projects == null}
    >
      <SelectTrigger size="sm" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Inbox</SelectItem>
        {(projects ?? []).map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium text-emerald-700 dark:text-emerald-300">
            Connected
          </span>{" "}
          <span className="text-muted-foreground">· token {tokenHint}</span>
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => disconnectTodoist())}
        >
          Disconnect
        </Button>
      </div>

      {projects == null ? (
        <p className="text-sm text-muted-foreground">
          Todoist unreachable.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs">Default project for follow-ups</Label>
        {projectSelect(defaultProjectId, (projectId) =>
          run(() => setDefaultTodoistProject(projectId)),
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Projects by trip type</Label>
        <ul className="space-y-2">
          {tripTypes.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3">
              <span className="text-sm">{t.name}</span>
              {projectSelect(t.todoistProjectId, (projectId) =>
                run(() => setTripTypeTodoistProject(t.id, projectId)),
              )}
            </li>
          ))}
          {tripTypes.length === 0 ? (
            <li className="text-sm text-muted-foreground">No trip types.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
