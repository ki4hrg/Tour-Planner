"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormState } from "@/lib/forms";
import { listMyTodoistProjects } from "../settings/actions";
import { linkTripTodoistProject, createTripTodoistProject } from "./actions";

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

// The trip page's Todoist row: which project this trip's follow-ups go to for
// the current user. Project options load lazily when the picker is opened.
export function TripTodoistPanel({
  tripId,
  linkedProjectId,
}: {
  tripId: string;
  linkedProjectId: string | null;
}) {
  const { pending, run } = useAction();
  const [projects, setProjects] = useState<
    { id: string; name: string }[] | null
  >(null);
  const [loaded, setLoaded] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  const loadProjects = () => {
    if (loaded) return;
    setLoaded(true);
    listMyTodoistProjects().then((p) => {
      if (p) setProjects(p);
      else setUnreachable(true);
    });
  };

  const linkedName =
    projects?.find((p) => p.id === linkedProjectId)?.name ?? null;

  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        {linkedProjectId
          ? `Follow-ups on this trip go to ${linkedName ? `“${linkedName}”` : "a linked Todoist project"}.`
          : "No project linked — follow-ups fall back to the trip type's project, then your default."}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={linkedProjectId ?? NONE}
          onOpenChange={(open) => {
            if (open) loadProjects();
          }}
          onValueChange={(v) =>
            run(() => linkTripTodoistProject(tripId, v === NONE ? null : v))
          }
          disabled={pending}
        >
          <SelectTrigger size="sm" className="w-52">
            <SelectValue
              placeholder={linkedProjectId ? "Linked project" : "Link a project…"}
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— no link —</SelectItem>
            {projects == null ? (
              <SelectItem value="__loading__" disabled>
                {unreachable ? "Todoist unreachable" : "Loading projects…"}
              </SelectItem>
            ) : (
              projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))
            )}
            {/* Keep the current link selectable before options load. */}
            {projects == null && linkedProjectId ? (
              <SelectItem value={linkedProjectId}>Linked project</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => createTripTodoistProject(tripId))}
        >
          Create project for this trip
        </Button>
      </div>
    </div>
  );
}
