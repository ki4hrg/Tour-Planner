"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useAction } from "@/lib/use-action";
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
import {
  STEP_DUE_UNITS,
  type StepActor,
  type StepStatus,
} from "@/lib/booking-workflow";
import type { PaymentOffsetUnit } from "@prisma/client";
import { cn } from "@/lib/utils";
import { createWorkflow, saveWorkflow, deleteWorkflow } from "./actions";

type Step = {
  id?: string;
  key: string;
  label: string;
  status: StepStatus;
  actor: StepActor;
  // Due this many units before/after the trip's start; "" = due whenever
  // it's next. Stored as one signed offset (negative = after start).
  dueValue: string;
  dueUnit: PaymentOffsetUnit;
  dueDir: DueDir;
};

type DueDir = "BEFORE" | "AFTER";

const DUE_DIR_LABELS: Record<DueDir, string> = {
  BEFORE: "before start",
  AFTER: "after start",
};

export type WorkflowRow = {
  id: string;
  name: string;
  isDefault: boolean;
  bookingCount: number;
  locationCount: number;
  steps: {
    id: string;
    label: string;
    status: StepStatus;
    actor: StepActor;
    dueOffsetValue: number | null;
    dueOffsetUnit: PaymentOffsetUnit | null;
  }[];
};

const DUE_UNIT_LABELS: Record<PaymentOffsetUnit, string> = {
  DAY: "days",
  WEEK: "weeks",
  MONTH: "months",
};

const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  IN_PROGRESS: "In progress",
  CONFIRMED: "Confirmed",
  FINALIZED: "Finalized",
};

// Whose move the step is once a booking reaches it.
const STEP_ACTOR_LABELS: Record<StepActor, string> = {
  US: "Us",
  VENUE: "Venue",
};

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
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending || !name.trim()}
        >
          + Add workflow
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
    workflow.steps.map((s) => ({
      id: s.id,
      key: s.id,
      label: s.label,
      status: s.status,
      actor: s.actor,
      dueValue: s.dueOffsetValue == null ? "" : String(Math.abs(s.dueOffsetValue)),
      dueUnit: s.dueOffsetUnit ?? "MONTH",
      dueDir: (s.dueOffsetValue ?? 0) < 0 ? "AFTER" : "BEFORE",
    })),
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
        steps: steps.map(({ id, label, status, actor, dueValue, dueUnit, dueDir }) => ({
          id,
          label,
          status,
          actor,
          dueOffsetValue:
            dueValue.trim() === ""
              ? null
              : Math.abs(Number(dueValue)) * (dueDir === "AFTER" ? -1 : 1),
          dueOffsetUnit: dueValue.trim() === "" ? null : dueUnit,
        })),
      }),
    );
  };

  // The consequence line for the delete confirm.
  const removeUses = [
    workflow.bookingCount
      ? `${workflow.bookingCount} booking${workflow.bookingCount === 1 ? "" : "s"} keep their status without a workflow`
      : null,
    workflow.locationCount
      ? `${workflow.locationCount} location${workflow.locationCount === 1 ? "" : "s"} lose it as their default`
      : null,
  ].filter(Boolean);
  const remove = () => run(() => deleteWorkflow(workflow.id));

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
              {workflow.bookingCount} booking
              {workflow.bookingCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
          {workflow.locationCount ? (
            <Badge variant="secondary">
              {workflow.locationCount} location
              {workflow.locationCount === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </span>
      </div>

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
          >
            <span className="w-5 text-right text-sm text-muted-foreground">
              {i + 1}.
            </span>
            <Input
              value={s.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              aria-label={`Step ${i + 1} label`}
              className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] sm:basis-0"
            />
            <div
              role="radiogroup"
              aria-label={`Step ${i + 1} owner`}
              className="ml-7 inline-flex shrink-0 rounded-md border p-0.5 text-xs sm:ml-0"
            >
              {(Object.keys(STEP_ACTOR_LABELS) as StepActor[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={s.actor === a}
                  onClick={() => patch(i, { actor: a })}
                  className={cn(
                    "rounded px-2 py-1 focus-ring",
                    s.actor === a
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {STEP_ACTOR_LABELS[a]}
                </button>
              ))}
            </div>
            <Select
              value={s.status}
              onValueChange={(v) => patch(i, { status: v as StepStatus })}
            >
              <SelectTrigger
                className="w-36"
                aria-label={`Step ${i + 1} reaches`}
              >
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
            {/* When the step falls due: N units before or after the trip
                starts (after = a balance invoiced once the trip is over).
                Blank = due as soon as it is the next step. Until the date,
                the step reads muted ("from 12 Mar") and is nobody's move. */}
            <span className="ml-7 flex items-center gap-1 sm:ml-0">
              <Label htmlFor={`${workflow.id}-due-${s.key}`} className="text-xs text-muted-foreground">
                Due
              </Label>
              <Input
                id={`${workflow.id}-due-${s.key}`}
                type="number"
                min={0}
                inputMode="numeric"
                value={s.dueValue}
                onChange={(e) => patch(i, { dueValue: e.target.value })}
                className="w-16"
                aria-label={`Step ${i + 1} due offset`}
              />
              <Select
                value={s.dueUnit}
                onValueChange={(v) => patch(i, { dueUnit: v as PaymentOffsetUnit })}
              >
                <SelectTrigger
                  className="w-28"
                  aria-label={`Step ${i + 1} due unit`}
                  disabled={s.dueValue.trim() === ""}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEP_DUE_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {DUE_UNIT_LABELS[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={s.dueDir}
                onValueChange={(v) => patch(i, { dueDir: v as DueDir })}
              >
                <SelectTrigger
                  className="w-32"
                  aria-label={`Step ${i + 1} due before or after start`}
                  disabled={s.dueValue.trim() === ""}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DUE_DIR_LABELS) as DueDir[]).map((d) => (
                    <SelectItem key={d} value={d}>
                      {DUE_DIR_LABELS[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </span>
            {/* Below sm the row wraps: label, then owner + status, then these. */}
            <span className="ml-auto flex sm:ml-0">
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
                onClick={() =>
                  setSteps((prev) => prev.filter((_, j) => j !== i))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </span>
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
              {
                key: newKey(),
                label: "",
                status: "IN_PROGRESS",
                actor: "US",
                dueValue: "",
                dueDir: "BEFORE",
                dueUnit: "MONTH",
              },
            ])
          }
        >
          + Add step
        </Button>
        <Button size="sm" disabled={pending} onClick={save}>
          Save
        </Button>
        <ConfirmButton
          variant="ghost"
          size="sm"
          className="ml-auto text-destructive"
          disabled={pending}
          pending={pending}
          title={`Delete ${workflow.name}`}
          description={
            removeUses.length
              ? `${removeUses.join("; ")}.`
              : "Permanently deletes."
          }
          confirmLabel="Delete workflow"
          onConfirm={remove}
        >
          Delete
        </ConfirmButton>
      </div>
    </section>
  );
}
