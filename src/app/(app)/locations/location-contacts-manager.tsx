"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
};

export function LocationContactsManager({
  locationId,
  linked,
  available,
  primaryContactId,
  canEdit,
}: {
  locationId: string;
  linked: LinkedContact[];
  available: { id: string; name: string }[];
  primaryContactId: string | null;
  canEdit: boolean;
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
            className="flex items-center justify-between gap-3 py-2"
          >
            <div className="min-w-0">
              <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
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
            </div>
            {canEdit ? (
              <div className="flex shrink-0 items-center gap-1">
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
            No contacts linked.
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
                  <SelectValue placeholder="Choose a contact…" />
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
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
