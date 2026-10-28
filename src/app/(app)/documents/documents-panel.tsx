"use client";

import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Download, FileText, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useAction } from "@/lib/use-action";
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
import { cn } from "@/lib/utils";
import {
  defaultKindForTarget,
  documentHref,
  formatFileSize,
  isInlineViewable,
  shareAudienceOptions,
  shareBadgeLabel,
  type DocumentShareContext,
  type SerializedDocument,
  type ShareAudienceOption,
} from "@/lib/documents";
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  MAX_DOCUMENT_BYTES,
  type DocumentKindValue,
  type DocumentMetaInput,
  type DocumentShareAudience,
  type DocumentTarget,
} from "@/lib/validators/document";
import { deleteDocument, updateDocument, uploadDocument } from "./actions";

// The shared direct-call action runner, re-exported under the name the trip
// documents hub imports so its uploads run the same way.
export const useDocumentAction = useAction;

/**
 * A reusable, target-agnostic file list — the documents counterpart to
 * `<NotesThread>`. Mounted on the location page, each booking row and each
 * stay; the target decides only where an upload is filed (and which share
 * releases mean anything), never how it looks.
 *
 * `venueName` sharpens the share wording: pass the venue for an engagement or a
 * stay, `null` for a site-less item booking (host-site links can't reach it).
 * Left out, the copy stays true of every booking.
 */
export function DocumentsPanel({
  target,
  targetId,
  documents,
  canEdit,
  emptyLabel = "No documents.",
  uploadLabel = "+ Upload file",
  venueName,
}: {
  target: DocumentTarget;
  targetId: string;
  documents: SerializedDocument[];
  canEdit: boolean;
  emptyLabel?: string;
  uploadLabel?: string;
  venueName?: string | null;
}) {
  const { pending, run } = useDocumentAction();
  const [adding, setAdding] = useState(false);
  const shareContext = toShareContext(target, venueName);

  return (
    <div className="space-y-3">
      {documents.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : null}

      <DocumentList
        documents={documents}
        canEdit={canEdit}
        shareContext={shareContext}
      />

      {canEdit ? (
        adding ? (
          <DocumentUploadForm
            pending={pending}
            shareContext={shareContext}
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

function toShareContext(
  target: DocumentTarget,
  venueName: string | null | undefined,
): DocumentShareContext {
  switch (target) {
    case "trip":
      return { target };
    case "booking":
      return { target, venueName };
    case "location":
    case "stay":
      return { target, venueName: venueName ?? undefined };
  }
}

/**
 * The file rows for one target, with inline metadata editing. Shared by
 * `<DocumentsPanel>` and the trip documents hub's per-target groups.
 */
export function DocumentList({
  documents,
  canEdit,
  shareContext,
}: {
  documents: SerializedDocument[];
  canEdit: boolean;
  shareContext: DocumentShareContext;
}) {
  const { pending, run } = useDocumentAction();
  const [editingId, setEditingId] = useState<string | null>(null);

  if (documents.length === 0) return null;
  return (
    <ul className="space-y-2">
      {documents.map((doc) =>
        editingId === doc.id ? (
          <li key={doc.id}>
            <DocumentMetaForm
              initial={doc}
              shareContext={shareContext}
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
          <DocumentRow
            key={doc.id}
            doc={doc}
            shareContext={shareContext}
            canEdit={canEdit}
            pending={pending}
            onEdit={() => setEditingId(doc.id)}
            // Hard delete — there is no archive or undo for a file; the row
            // confirms before calling this.
            onDelete={() => run(() => deleteDocument(doc.id))}
          />
        ),
      )}
    </ul>
  );
}

/** One file: title link, kind/size/uploader line, share badge, optional actions. */
export function DocumentRow({
  doc,
  shareContext,
  canEdit,
  pending = false,
  onEdit,
  onDelete,
}: {
  doc: SerializedDocument;
  shareContext: DocumentShareContext;
  canEdit: boolean;
  pending?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const badge = shareBadgeLabel(doc.shareAudiences, shareContext);
  const staffOnly = badge === "Staff only";
  return (
    <li className="rounded-md border px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={documentHref(doc.id, isInlineViewable(doc.contentType))}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 font-medium link-quiet"
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
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                staffOnly
                  ? "border text-muted-foreground"
                  : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
              )}
            >
              {badge}
            </span>
            <span>{formatFileSize(doc.size)}</span>
            <span className="truncate">· {doc.filename}</span>
            <span>
              · {doc.uploadedBy?.name ?? "Unknown"},{" "}
              {formatDate(doc.createdAt.slice(0, 10))}
            </span>
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
      {canEdit && (onEdit || onDelete) ? (
        <div className="mt-1 flex items-center gap-1">
          {onEdit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onEdit}
              disabled={pending}
            >
              Edit
            </Button>
          ) : null}
          {onDelete ? (
            <ConfirmButton
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={pending}
              pending={pending}
              title={`Delete ${doc.title}`}
              description="Permanently deletes the file."
              confirmLabel="Delete file"
              onConfirm={onDelete}
            >
              Delete
            </ConfirmButton>
          ) : null}
        </div>
      ) : null}
    </li>
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
  shareContext,
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
  shareContext: DocumentShareContext;
  titlePlaceholder?: string;
}) {
  const options = shareAudienceOptions(shareContext);
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
          placeholder="e.g. Countersigned copy, 12 March"
        />
      </div>

      <ShareReleaseFields
        options={options}
        audiences={audiences}
        toggleAudience={toggleAudience}
        venueFile={shareContext.target === "location"}
      />
    </>
  );
}

// The release checkboxes, offering only the audiences that can actually reach a
// file on this target and saying exactly who each one reaches.
function ShareReleaseFields({
  options,
  audiences,
  toggleAudience,
  venueFile,
}: {
  options: ShareAudienceOption[];
  audiences: DocumentShareAudience[];
  toggleAudience: (a: DocumentShareAudience, on: boolean) => void;
  venueFile: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Release to share links</Label>
      <div className="space-y-1.5">
        {options.map((o) => (
          <label key={o.audience} className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={audiences.includes(o.audience)}
              onCheckedChange={(v) => toggleAudience(o.audience, v === true)}
            />
            <span>
              {o.label}
              <span className="block text-xs text-muted-foreground">
                {o.hint}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {venueFile
          ? "Staff always see this file. Trip-wide links never do."
          : "Staff always see this file."}
      </p>
    </div>
  );
}

// Keep only releases that mean something for the target — a stale tick on an
// audience that can't reach the file is dropped on the next save.
function reachable(
  audiences: DocumentShareAudience[],
  ctx: DocumentShareContext,
): DocumentShareAudience[] {
  const allowed = new Set(shareAudienceOptions(ctx).map((o) => o.audience));
  return audiences.filter((a) => allowed.has(a));
}

/**
 * The upload form (file + metadata + release). `shareContext` picks the release
 * options and the starting kind; the trip documents hub swaps it as the
 * "Attach to…" target changes, and an explicit kind choice survives that.
 * `header` renders above the file picker (the hub's target select).
 */
export function DocumentUploadForm({
  pending,
  shareContext,
  onSubmit,
  onCancel,
  header,
}: {
  pending: boolean;
  shareContext: DocumentShareContext;
  onSubmit: (formData: FormData, done: () => void) => void;
  onCancel: () => void;
  header?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [title, setTitle] = useState("");
  // null = follow the target's default kind; set once the planner picks one.
  const [kindChoice, setKindChoice] = useState<DocumentKindValue | null>(null);
  const kind = kindChoice ?? defaultKindForTarget(shareContext.target);
  const [description, setDescription] = useState("");
  const [audiences, setAudiences] = useState<DocumentShareAudience[]>([]);

  const submit = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("No file chosen.");
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      // Caught server-side too; failing here saves a pointless 25MB round trip.
      toast.error(
        `File too large (${formatFileSize(file.size)}; max ${formatFileSize(MAX_DOCUMENT_BYTES)}).`,
      );
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    formData.set("title", title.trim());
    formData.set("description", description.trim());
    formData.set("kind", kind);
    for (const a of reachable(audiences, shareContext)) {
      formData.append("shareAudiences", a);
    }

    onSubmit(formData, () => {
      if (fileRef.current) fileRef.current.value = "";
      setFilename("");
      setTitle("");
      setKindChoice(null);
      setDescription("");
      setAudiences([]);
    });
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      {header}
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
          PDF, image, Office or text · max {formatFileSize(MAX_DOCUMENT_BYTES)}
        </p>
      </div>

      <MetaFields
        title={title}
        setTitle={setTitle}
        kind={kind}
        setKind={setKindChoice}
        description={description}
        setDescription={setDescription}
        audiences={audiences}
        toggleAudience={(a, on) =>
          setAudiences((prev) =>
            on ? [...prev, a] : prev.filter((x) => x !== a),
          )
        }
        shareContext={shareContext}
        titlePlaceholder={filename || "Filename"}
      />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={submit} disabled={pending}>
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
  shareContext,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: SerializedDocument;
  shareContext: DocumentShareContext;
  submitLabel: string;
  pending: boolean;
  onSubmit: (data: DocumentMetaInput) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [kind, setKind] = useState<DocumentKindValue>(initial.kind);
  const [description, setDescription] = useState(initial.description ?? "");
  const [audiences, setAudiences] = useState<DocumentShareAudience[]>(() =>
    reachable(initial.shareAudiences, shareContext),
  );

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        {initial.filename} · {formatFileSize(initial.size)}
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
        shareContext={shareContext}
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
              shareAudiences: reachable(audiences, shareContext),
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
