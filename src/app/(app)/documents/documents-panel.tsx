"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Download, FileText, Paperclip } from "lucide-react";
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
import {
  documentHref,
  formatFileSize,
  isInlineViewable,
  type SerializedDocument,
} from "@/lib/documents";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  DOCUMENT_SHARE_AUDIENCES,
  MAX_DOCUMENT_BYTES,
  type DocumentKindValue,
  type DocumentMetaInput,
  type DocumentShareAudience,
  type DocumentTarget,
} from "@/lib/validators/document";
import { SHARE_AUDIENCE_LABELS } from "@/lib/share";
import { deleteDocument, updateDocument, uploadDocument } from "./actions";

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

/**
 * A reusable, target-agnostic file list — the documents counterpart to
 * `<NotesThread>`. Mounted on the trip page, the location page and each booking
 * row; the target decides only where an upload is filed, never how it looks.
 */
export function DocumentsPanel({
  target,
  targetId,
  documents,
  canEdit,
  emptyLabel = "No documents yet.",
  uploadLabel = "+ Upload file",
}: {
  target: DocumentTarget;
  targetId: string;
  documents: SerializedDocument[];
  canEdit: boolean;
  emptyLabel?: string;
  uploadLabel?: string;
}) {
  const { pending, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {documents.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : null}

      <ul className="space-y-2">
        {documents.map((doc) =>
          editingId === doc.id ? (
            <li key={doc.id}>
              <DocumentMetaForm
                initial={doc}
                submitLabel="Save"
                pending={pending}
                onSubmit={(data) =>
                  run(() => updateDocument(doc.id, data), () =>
                    setEditingId(null),
                  )
                }
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={doc.id} className="rounded-md border px-3 py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={documentHref(doc.id, isInlineViewable(doc.contentType))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 font-medium hover:underline"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{doc.title}</span>
                  </a>
                  {doc.description ? (
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                      {doc.description}
                    </p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                      {DOCUMENT_KIND_LABELS[doc.kind]}
                    </span>
                    <span>{formatFileSize(doc.size)}</span>
                    <span className="truncate">· {doc.filename}</span>
                    <span>
                      · {doc.uploadedBy?.name ?? "Unknown"},{" "}
                      {formatDate(doc.createdAt.slice(0, 10))}
                    </span>
                    {doc.shareAudiences.map((a) => (
                      <span
                        key={a}
                        className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                      >
                        Shared: {SHARE_AUDIENCE_LABELS[a]}
                      </span>
                    ))}
                  </div>
                </div>
                <a
                  href={documentHref(doc.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label={`Download ${doc.title}`}
                  title="Download"
                >
                  <Download className="size-4" />
                </a>
              </div>
              {canEdit ? (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => setEditingId(doc.id)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="text-destructive hover:underline"
                    onClick={() => run(() => deleteDocument(doc.id))}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          ),
        )}
      </ul>

      {canEdit ? (
        adding ? (
          <UploadForm
            pending={pending}
            onSubmit={(formData, done) =>
              run(() => uploadDocument(target, targetId, formData), () => {
                done();
                setAdding(false);
              })
            }
            onCancel={() => setAdding(false)}
          />
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            {uploadLabel}
          </Button>
        )
      ) : null}
    </div>
  );
}

// The metadata fields shared by upload and edit. Kept as one component so the
// two forms can never drift on what a document is allowed to say about itself.
function MetaFields({
  title,
  setTitle,
  kind,
  setKind,
  description,
  setDescription,
  audiences,
  toggleAudience,
  titlePlaceholder,
}: {
  title: string;
  setTitle: (v: string) => void;
  kind: DocumentKindValue;
  setKind: (v: DocumentKindValue) => void;
  description: string;
  setDescription: (v: string) => void;
  audiences: DocumentShareAudience[];
  toggleAudience: (a: DocumentShareAudience, on: boolean) => void;
  titlePlaceholder?: string;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={titlePlaceholder}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as DocumentKindValue)}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {DOCUMENT_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional — e.g. countersigned copy returned 12 March."
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Release to share links</Label>
        <div className="flex flex-wrap items-center gap-4">
          {DOCUMENT_SHARE_AUDIENCES.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={audiences.includes(a)}
                onCheckedChange={(v) => toggleAudience(a, v === true)}
              />
              {SHARE_AUDIENCE_LABELS[a]}
            </label>
          ))}
          <span className="text-xs text-muted-foreground">
            Unticked = staff only. Staff share links always see every file.
          </span>
        </div>
      </div>
    </>
  );
}

function UploadForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (formData: FormData, done: () => void) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<DocumentKindValue>("OTHER");
  const [description, setDescription] = useState("");
  const [audiences, setAudiences] = useState<DocumentShareAudience[]>([]);

  const submit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      // Caught server-side too; failing here saves a pointless 25MB round trip.
      toast.error(
        `That file is ${formatFileSize(file.size)} — the limit is ${formatFileSize(MAX_DOCUMENT_BYTES)}.`,
      );
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", title.trim());
    formData.set("description", description.trim());
    formData.set("kind", kind);
    for (const a of audiences) formData.append("shareAudiences", a);

    onSubmit(formData, () => {
      if (fileRef.current) fileRef.current.value = "";
      setFilename("");
      setTitle("");
      setKind("OTHER");
      setDescription("");
      setAudiences([]);
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="space-y-1">
        <Label className="text-xs">File</Label>
        <Input
          ref={fileRef}
          type="file"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            setFilename(picked?.name ?? "");
            // Pre-fill the title from the filename until the planner types one.
            if (picked && !title.trim()) setTitle(picked.name);
          }}
        />
        <p className="text-xs text-muted-foreground">
          PDFs, images, office documents and text files up to{" "}
          {formatFileSize(MAX_DOCUMENT_BYTES)}.
        </p>
      </div>

      <MetaFields
        title={title}
        setTitle={setTitle}
        kind={kind}
        setKind={setKind}
        description={description}
        setDescription={setDescription}
        audiences={audiences}
        toggleAudience={(a, on) =>
          setAudiences((prev) =>
            on ? [...prev, a] : prev.filter((x) => x !== a),
          )
        }
        titlePlaceholder={filename || "Defaults to the filename"}
      />

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={pending}>
          <Paperclip className="size-4" />
          {pending ? "Uploading…" : "Upload"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DocumentMetaForm({
  initial,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: SerializedDocument;
  submitLabel: string;
  pending: boolean;
  onSubmit: (data: DocumentMetaInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState<DocumentKindValue>(initial.kind);
  const [description, setDescription] = useState(initial.description ?? "");
  const [audiences, setAudiences] = useState<DocumentShareAudience[]>(
    initial.shareAudiences,
  );

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        {initial.filename} · {formatFileSize(initial.size)} — the file itself
        can&apos;t be edited; upload a new one to replace it.
      </p>

      <MetaFields
        title={title}
        setTitle={setTitle}
        kind={kind}
        setKind={setKind}
        description={description}
        setDescription={setDescription}
        audiences={audiences}
        toggleAudience={(a, on) =>
          setAudiences((prev) =>
            on ? [...prev, a] : prev.filter((x) => x !== a),
          )
        }
      />

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            onSubmit({
              title: title.trim(),
              description: description.trim() || undefined,
              kind,
              shareAudiences: audiences,
            })
          }
        >
          {submitLabel}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
