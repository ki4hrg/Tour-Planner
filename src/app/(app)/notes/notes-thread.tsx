"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/dates";
import type { FormState } from "@/lib/forms";
import type { SerializedNote } from "@/lib/notes";
import {
  NOTE_METHODS,
  NOTE_METHOD_LABELS,
  type NoteInput,
  type NoteTarget,
} from "@/lib/validators/note";
import { addNote, updateNote, deleteNote } from "./actions";

const NONE = "__none__";
type ContactOption = { id: string; name: string };

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

// A reusable, target-agnostic contact log. Newest-first list + add/edit/delete.
export function NotesThread({
  target,
  targetId,
  notes,
  contacts,
  canEdit,
  today,
}: {
  target: NoteTarget;
  targetId: string;
  notes: SerializedNote[];
  contacts: ContactOption[];
  canEdit: boolean;
  today: string; // yyyy-mm-dd default for the "contacted on" field
}) {
  const { run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {notes.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : null}

      <ul className="space-y-2">
        {notes.map((note) =>
          editingId === note.id ? (
            <li key={note.id}>
              <NoteForm
                contacts={contacts}
                initial={note}
                today={today}
                submitLabel="Save note"
                onSubmit={(data, done) =>
                  run(() => updateNote(note.id, data), () => {
                    done();
                    setEditingId(null);
                  })
                }
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={note.id}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                  {NOTE_METHOD_LABELS[note.method]}
                </span>
                <span>{formatDate(note.contactedOn)}</span>
                {note.contact ? <span>· {note.contact.name}</span> : null}
                {note.followUp ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    Follow up{note.dueDate ? ` by ${formatDate(note.dueDate)}` : ""}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap">{note.body}</p>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {note.createdBy?.name ?? "Unknown"} · logged{" "}
                  {formatDate(note.createdAt.slice(0, 10))}
                </span>
                {canEdit ? (
                  <>
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => setEditingId(note.id)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-destructive hover:underline"
                      onClick={() => run(() => deleteNote(note.id))}
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ),
        )}
      </ul>

      {canEdit ? (
        adding ? (
          <NoteForm
            contacts={contacts}
            today={today}
            submitLabel="Add note"
            onSubmit={(data, done) =>
              run(() => addNote(target, targetId, data), () => {
                done();
                setAdding(false);
              })
            }
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            + Add note
          </Button>
        )
      ) : null}
    </div>
  );
}

function NoteForm({
  contacts,
  initial,
  today,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  contacts: ContactOption[];
  initial?: SerializedNote;
  today: string;
  submitLabel: string;
  onSubmit: (data: NoteInput, done: () => void) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [method, setMethod] = useState<NoteInput["method"]>(
    initial?.method ?? "CALL",
  );
  const [contactId, setContactId] = useState(initial?.contact?.id ?? NONE);
  const [contactedOn, setContactedOn] = useState(initial?.contactedOn ?? today);
  const [followUp, setFollowUp] = useState(initial?.followUp ?? false);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");

  const submit = () =>
    onSubmit(
      {
        body: body.trim(),
        method,
        contactId: contactId === NONE ? undefined : contactId,
        contactedOn,
        followUp,
        dueDate: followUp ? dueDate || undefined : undefined,
      },
      () => {
        if (!initial) {
          setBody("");
          setMethod("CALL");
          setContactId(NONE);
          setContactedOn(today);
          setFollowUp(false);
          setDueDate("");
        }
      },
    );

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Method</Label>
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as NoteInput["method"])}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTE_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {NOTE_METHOD_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Contact</Label>
          <Select value={contactId} onValueChange={setContactId}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— none —</SelectItem>
              {contacts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Contacted on</Label>
          <Input
            type="date"
            value={contactedOn}
            onChange={(e) => setContactedOn(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Note</Label>
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="e.g. Called Jane re. room block — holding 24 until Friday."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={followUp}
            onCheckedChange={(v) => setFollowUp(v === true)}
          />
          Needs follow-up
        </label>
        {followUp ? (
          <div className="flex items-center gap-2">
            <Label className="text-xs">Due</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-auto"
            />
          </div>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={submit}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
