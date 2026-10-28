"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  DocumentShareContext,
  SerializedDocument,
} from "@/lib/documents";
import type { DocumentTarget } from "@/lib/validators/document";
import { uploadDocument, uploadVenueEngagementDocument } from "./actions";
import {
  DocumentList,
  DocumentRow,
  DocumentUploadForm,
  useDocumentAction,
} from "./documents-panel";

/** One target's files on the hub. `attachValue` keys its "Attach to…" option. */
export type HubGroup = {
  key: string;
  heading: string;
  sublabel: string;
  href: string | null;
  shareContext: DocumentShareContext;
  documents: SerializedDocument[];
  attachValue: string;
};

/**
 * An "Attach to…" choice. `venue` uploads create the `(trip, location)`
 * engagement first; `document` uploads file straight onto an existing target.
 */
export type HubAttachOption = {
  value: string;
  label: string;
  section: string;
  shareContext: DocumentShareContext;
  upload:
    | { kind: "document"; target: DocumentTarget; targetId: string }
    | { kind: "venue"; tripId: string; locationId: string };
  note?: string;
};

export type HubLibraryVenue = {
  locationId: string;
  name: string;
  href: string;
  documents: SerializedDocument[];
};

/** Client half of `<TripDocumentsHub>` — see that component for the data. */
export function TripDocumentsHubView({
  groups,
  attachOptions,
  library,
  canEdit,
}: {
  groups: HubGroup[];
  attachOptions: HubAttachOption[];
  library: HubLibraryVenue[];
  canEdit: boolean;
}) {
  const { pending, run } = useDocumentAction();
  const [adding, setAdding] = useState(false);
  const [attachTo, setAttachTo] = useState(attachOptions[0]?.value ?? "trip");
  const formRef = useRef<HTMLDivElement>(null);

  const selected =
    attachOptions.find((o) => o.value === attachTo) ?? attachOptions[0];
  const filled = groups.filter((g) => g.documents.length > 0);
  const empty = groups.filter((g) => g.documents.length === 0);
  const total = filled.reduce((n, g) => n + g.documents.length, 0);
  const libraryTotal = library.reduce((n, v) => n + v.documents.length, 0);

  // Open the upload form aimed at a group (its "Upload here" link).
  const uploadTo = (value: string) => {
    setAttachTo(value);
    setAdding(true);
    formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const sections = [...new Set(attachOptions.map((o) => o.section))];

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div ref={formRef}>
          {adding && selected ? (
            <DocumentUploadForm
              pending={pending}
              shareContext={selected.shareContext}
              header={
                <div className="space-y-1">
                  <Label className="text-xs">Attach to…</Label>
                  <Select value={selected.value} onValueChange={setAttachTo}>
                    <SelectTrigger size="sm" className="w-full sm:w-auto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sections.map((section) => (
                        <SelectGroup key={section}>
                          <SelectLabel>{section}</SelectLabel>
                          {attachOptions
                            .filter((o) => o.section === section)
                            .map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                  {selected.note ? (
                    <p className="text-xs text-muted-foreground">
                      {selected.note}
                    </p>
                  ) : null}
                </div>
              }
              onSubmit={(formData, done) => {
                const u = selected.upload;
                run(
                  () =>
                    u.kind === "venue"
                      ? uploadVenueEngagementDocument(u.tripId, u.locationId, formData)
                      : uploadDocument(u.target, u.targetId, formData),
                  () => {
                    done();
                    setAdding(false);
                  },
                );
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              + Upload
            </Button>
          )}
        </div>
      ) : null}

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No documents.
        </p>
      ) : (
        filled.map((g) => (
          <section key={g.key} className="space-y-2">
            <GroupHeading
              group={g}
              canEdit={canEdit}
              onUpload={() => uploadTo(g.attachValue)}
            />
            <DocumentList
              documents={g.documents}
              canEdit={canEdit}
              shareContext={g.shareContext}
            />
          </section>
        ))
      )}

      {empty.length > 0 ? (
        <div className="space-y-1 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            No files
          </p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {empty.map((g) => (
              <li key={g.key}>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs font-normal text-muted-foreground link-quiet hover:text-foreground"
                    onClick={() => uploadTo(g.attachValue)}
                    title={`Upload to ${g.heading}`}
                  >
                    {g.heading}
                  </Button>
                ) : (
                  g.heading
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {library.length > 0 ? (
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            Venue library{" "}
            <span className="font-normal text-muted-foreground">
              ({libraryTotal} file{libraryTotal === 1 ? "" : "s"})
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            {library.map((v) => (
              <section key={v.locationId} className="space-y-2">
                <h4 className="text-sm font-medium">
                  <Link href={v.href} className="link-quiet">
                    {v.name}
                  </Link>{" "}
                  <span className="font-normal text-muted-foreground">
                    · {v.documents.length}
                  </span>
                </h4>
                <ul className="space-y-2">
                  {v.documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      shareContext={{ target: "location", venueName: v.name }}
                      canEdit={false}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function GroupHeading({
  group,
  canEdit,
  onUpload,
}: {
  group: HubGroup;
  canEdit: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h4 className="text-sm font-medium">
        {group.href ? (
          <Link href={group.href} className="link-quiet">
            {group.heading}
          </Link>
        ) : (
          group.heading
        )}{" "}
        <span className="font-normal text-muted-foreground">
          · {group.documents.length}
          {group.sublabel ? ` · ${group.sublabel}` : null}
        </span>
      </h4>
      {canEdit ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs font-normal text-muted-foreground link-quiet hover:text-foreground"
          onClick={onUpload}
        >
          Upload here
        </Button>
      ) : null}
    </div>
  );
}
