"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContactChannels } from "@/components/contact-channels";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactForm } from "../contacts/contact-form";
import { createContact } from "../contacts/actions";
import {
  linkContactToLocation,
  unlinkContactFromLocation,
  setPrimaryContact,
} from "./actions";

type LinkedContact = {
  id: string;
  name: string;
  role: string | null;
  organization: string | null;
  phone: string | null;
  email: string | null;
};

export function LocationContactsManager({
  locationId,
  linked,
  available,
  primaryContactId,
  canEdit,
  defaultDialCode,
}: {
  locationId: string;
  linked: LinkedContact[];
  available: { id: string; name: string }[];
  primaryContactId: string | null;
  canEdit: boolean;
  defaultDialCode?: string | null;
}) {
  const [mode, setMode] = useState<"none" | "existing" | "new">("none");

  return (
    <div className="space-y-4">
      <div className="divide-y">
        {linked.map((c) => {
          const isPrimary = c.id === primaryContactId;
          return (
          <div
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"
          >
            {/* The actions drop below the contact when the column is too narrow
                for both, so the email keeps a readable line. */}
            <div className="min-w-0 flex-1 basis-56">
              <Link href={`/contacts/${c.id}`} className="font-medium link-quiet">
                {c.name}
              </Link>
              {isPrimary ? (
                <Badge variant="secondary" className="ml-2 align-middle">
                  Primary
                </Badge>
              ) : null}
              <span className="text-sm text-muted-foreground">
                {[c.role, c.organization].filter(Boolean).length
                  ? ` — ${[c.role, c.organization].filter(Boolean).join(", ")}`
                  : ""}
              </span>
              {c.phone || c.email ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="link-quiet">
                      {c.phone}
                    </a>
                  ) : null}
                  {c.email ? (
                    <a
                      href={`mailto:${c.email}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-quiet break-all"
                    >
                      {c.email}
                    </a>
                  ) : null}
                  <ContactChannels phone={c.phone} email={c.email} />
                </div>
              ) : null}
            </div>
            {canEdit ? (
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <form action={setPrimaryContact}>
                  <input type="hidden" name="locationId" value={locationId} />
                  <input
                    type="hidden"
                    name="contactId"
                    value={isPrimary ? "" : c.id}
                  />
                  <Button variant="ghost" size="sm">
                    {isPrimary ? "Clear primary" : "Make primary"}
                  </Button>
                </form>
                <form action={unlinkContactFromLocation}>
                  <input type="hidden" name="locationId" value={locationId} />
                  <input type="hidden" name="contactId" value={c.id} />
                  <Button variant="ghost" size="sm" className="text-destructive">
                    Unlink
                  </Button>
                </form>
              </div>
            ) : null}
          </div>
          );
        })}
        {linked.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No contacts.
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={mode === "existing" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode(mode === "existing" ? "none" : "existing")}
              disabled={available.length === 0}
            >
              Link existing
            </Button>
            <Button
              variant={mode === "new" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode(mode === "new" ? "none" : "new")}
            >
              Create new
            </Button>
          </div>

          {mode === "existing" ? (
            <form action={linkContactToLocation} className="flex items-end gap-2">
              <input type="hidden" name="locationId" value={locationId} />
              <Select name="contactId">
                <SelectTrigger className="w-64" size="sm">
                  <SelectValue placeholder="Choose contact…" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" size="sm">
                Link
              </Button>
            </form>
          ) : null}

          {mode === "new" ? (
            <div className="rounded-md border border-dashed p-3">
              <ContactForm
                action={createContact}
                submitLabel="Create & link"
                locationId={locationId}
                resetOnSuccess
                defaultDialCode={defaultDialCode}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
