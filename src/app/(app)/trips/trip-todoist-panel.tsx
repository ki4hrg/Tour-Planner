"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/lib/use-action";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listMyTodoistProjects } from "../settings/actions";
import { linkTripTodoistProject, createTripTodoistProject } from "./actions";

const NONE = "__none__";

// The trip page's Todoist row: which project this trip's follow-ups go to for
// the current user. Project options load lazily when the picker is opened.
export function TripTodoistPanel({
  tripId,
  linkedProjectId,
  linkedProjectName,
}: {
  tripId: string;
  linkedProjectId: string | null;
  // Denormalized on the link row (GH #50); null on links made before the
  // column existed, until the picker self-heals it below.
  linkedProjectName?: string | null;
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
      if (p) {
        setProjects(p);
        // Backfill the stored name on pre-#50 links once the real name is known.
        const current = linkedProjectId
          ? p.find((o) => o.id === linkedProjectId)
          : null;
        if (current && linkedProjectName !== current.name) {
          void linkTripTodoistProject(tripId, current.id, current.name);
        }
      } else setUnreachable(true);
    });
  };

  const linkedName =
    projects?.find((p) => p.id === linkedProjectId)?.name ??
    linkedProjectName ??
    null;

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={linkedProjectId ?? NONE}
          onOpenChange={(open) => {
            if (open) loadProjects();
          }}
          onValueChange={(v) =>
            run(() =>
              linkTripTodoistProject(
                tripId,
                v === NONE ? null : v,
                v === NONE
                  ? null
                  : (projects?.find((p) => p.id === v)?.name ?? undefined),
              ),
            )
          }
          disabled={pending}
        >
          <SelectTrigger size="sm" className="w-52">
            <SelectValue
              placeholder={
                linkedProjectId
                  ? (linkedName ?? "Linked project")
                  : "Link project…"
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No link</SelectItem>
            {projects == null ? (
              <SelectItem value="__loading__" disabled>
                {unreachable ? "Todoist unreachable" : "Loading…"}
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
              <SelectItem value={linkedProjectId}>
                {linkedName ?? "Linked project"}
              </SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => createTripTodoistProject(tripId))}
        >
          Create project
        </Button>
      </div>
    </div>
  );
}
