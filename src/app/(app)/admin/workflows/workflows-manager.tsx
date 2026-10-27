"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormState } from "@/lib/forms";
import type { StepStatus } from "@/lib/booking-workflow";
import { createWorkflow, saveWorkflow, deleteWorkflow } from "./actions";

type Step = { id?: string; key: string; label: string; status: StepStatus };

export type WorkflowRow = {
  id: string;
  name: string;
  isDefault: boolean;
  bookingCount: number;
  locationCount: number;
  steps: { id: string; label: string; status: StepStatus }[];
};

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  IN_PROGRESS: "In progress",
  CONFIRMED: "Confirmed",
};

function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) =>
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else if (res.message) toast.success(res.message);
    });
  return { pending, run };
}

export function WorkflowsManager({ workflows }: { workflows: WorkflowRow[] }) {
  const { pending, run } = useAction();
  const [name, setName] = useState("");

  return (
    <div className="space-y-4">
      {workflows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No workflows.</p>
      ) : null}
      {workflows.map((w) => (
        // Keyed on the saved shape so a save/refresh resets the local draft.
        <WorkflowEditor key={`${w.id}:${JSON.stringify(w)}`} workflow={w} />
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const res = await createWorkflow(name);
            if (res.ok) setName("");
            return res;
          });
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New workflow"
          aria-label="New workflow name"
          className="max-w-xs"
        />
        <Button type="submit" variant="outline" disabled={pending || !name.trim()}>
          Add workflow
        </Button>
      </form>
    </div>
  );
}

let keySeq = 0;
const newKey = () => `new-${++keySeq}`;

function WorkflowEditor({ workflow }: { workflow: WorkflowRow }) {
  const { pending, run } = useAction();
  const [name, setName] = useState(workflow.name);
  const [isDefault, setIsDefault] = useState(workflow.isDefault);
  const [steps, setSteps] = useState<Step[]>(
    workflow.steps.map((s) => ({ ...s, key: s.id })),
  );

  const patch = (i: number, p: Partial<Step>) =>
    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const t = i + dir;
      if (t < 0 || t >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[t]] = [next[t], next[i]];
      return next;
    });

  const save = () => {
    const dropped = workflow.steps.filter(
      (s) => !steps.some((n) => n.id === s.id),
    );
    if (
      dropped.length > 0 &&
      workflow.bookingCount > 0 &&
      !window.confirm(
        `Removing ${dropped.map((s) => `"${s.label}"`).join(", ")} clears it on every booking that ticked it.`,
      )
    ) {
      return;
    }
    run(() =>
      saveWorkflow(workflow.id, {
        name,
        isDefault,
        steps: steps.map(({ id, label, status }) => ({ id, label, status })),
      }),
    );
  };

  const remove = () => {
    const uses = [
      workflow.bookingCount
        ? `${workflow.bookingCount} booking${workflow.bookingCount === 1 ? "" : "s"} will keep their status without a workflow`
        : null,
      workflow.locationCount
        ? `${workflow.locationCount} location${workflow.locationCount === 1 ? "" : "s"} will lose it as their default`
        : null,
    ].filter(Boolean);
    if (
      !window.confirm(
        `Delete ${workflow.name}?${uses.length ? ` ${uses.join("; ")}.` : ""}`,
      )
    ) {
      return;
    }
    run(() => deleteWorkflow(workflow.id));
  };

  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label={workflow.name}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Workflow name"
          className="max-w-xs font-medium"
        />
        <div className="flex items-center gap-2">
          <Checkbox
            id={`default-${workflow.id}`}
            checked={isDefault}
            onCheckedChange={(v) => setIsDefault(v === true)}
          />
          <Label htmlFor={`default-${workflow.id}`}>Default</Label>
        </div>
        <span className="ml-auto flex gap-1">
          {workflow.bookingCount ? (
            <Badge variant="secondary">
              {workflow.bookingCount} booking{workflow.bookingCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {workflow.locationCount ? (
            <Badge variant="secondary">
              {workflow.locationCount} location{workflow.locationCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </span>
      </div>

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="w-5 text-right text-sm text-muted-foreground">
              {i + 1}.
            </span>
            <Input
              value={s.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              aria-label={`Step ${i + 1} label`}
              className="min-w-0 flex-1"
            />
            <Select
              value={s.status}
              onValueChange={(v) => patch(i, { status: v as StepStatus })}
            >
              <SelectTrigger className="w-36" aria-label={`Step ${i + 1} reaches`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STEP_STATUS_LABELS) as StepStatus[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {STEP_STATUS_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move up"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move down"
              disabled={i === steps.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Remove step"
              onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setSteps((prev) => [
              ...prev,
              { key: newKey(), label: "", status: "IN_PROGRESS" },
            ])
          }
        >
          + Add step
        </Button>
        <Button size="sm" disabled={pending} onClick={save}>
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive"
          disabled={pending}
          onClick={remove}
        >
          Delete
        </Button>
      </div>
    </section>
  );
}
