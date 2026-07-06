"use client";

import { useState, useTransition } from "react";
import type { ShareAudience } from "@prisma/client";
import { toast } from "sonner";
import { Copy, Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/dates";
import {
  SHARE_AUDIENCES,
  SHARE_AUDIENCE_LABELS,
  SHARE_AUDIENCE_BLURBS,
} from "@/lib/share";
import {
  createShareLink,
  setShareLinkEnabled,
  deleteShareLink,
} from "./actions";

export type SerializedShareLink = {
  id: string;
  token: string;
  audience: ShareAudience;
  label: string | null;
  locationName: string | null;
  enabled: boolean;
  expiresAt: string | null; // "yyyy-mm-dd"
};

type HostSite = { id: string; name: string };

// Run a FormState-returning action, surfacing the result as a toast.
function useAction() {
  const [pending, start] = useTransition();
  const run = (
    fn: () => Promise<{ error?: string; message?: string; ok?: boolean }>,
    onOk?: () => void,
  ) =>
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

function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}

export function ShareManager({
  tripId,
  canEdit,
  links,
  hostSites,
}: {
  tripId: string;
  canEdit: boolean;
  links: SerializedShareLink[];
  hostSites: HostSite[];
}) {
  return (
    <div className="space-y-4 text-sm">
      {links.length === 0 ? (
        <p className="text-muted-foreground">
          No share links yet.
          {canEdit ? " Create one below to share this itinerary." : ""}
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <LinkRow key={link.id} link={link} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit ? (
        <CreateForm tripId={tripId} hostSites={hostSites} />
      ) : null}
    </div>
  );
}

function LinkRow({
  link,
  canEdit,
}: {
  link: SerializedShareLink;
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl(link.token));
    setCopied(true);
    toast.success("Link copied.");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {SHARE_AUDIENCE_LABELS[link.audience]}
        </Badge>
        {link.locationName ? (
          <Badge variant="outline">{link.locationName}</Badge>
        ) : null}
        {!link.enabled ? <Badge variant="destructive">Disabled</Badge> : null}
        {link.label ? (
          <span className="text-muted-foreground">{link.label}</span>
        ) : null}
        {link.expiresAt ? (
          <span className="text-xs text-muted-foreground">
            expires {formatDate(link.expiresAt)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input
          readOnly
          value={shareUrl(link.token)}
          className="h-8 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={copy}
          aria-label="Copy link"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      {canEdit ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => setShareLinkEnabled(link.id, !link.enabled))}
          >
            {link.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => run(() => deleteShareLink(link.id))}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function CreateForm({
  tripId,
  hostSites,
}: {
  tripId: string;
  hostSites: HostSite[];
}) {
  const { pending, run } = useAction();
  const [audience, setAudience] = useState<ShareAudience>("PARTICIPANT");
  const [label, setLabel] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const isHostSite = audience === "HOST_SITE";
  const noHostSites = isHostSite && hostSites.length === 0;

  const submit = () =>
    run(
      () =>
        createShareLink({
          tripId,
          audience,
          label: label || null,
          locationId: isHostSite ? locationId || null : null,
          expiresAt: expiresAt || null,
        }),
      () => {
        setLabel("");
        setLocationId("");
        setExpiresAt("");
      },
    );

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="font-medium">New share link</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Audience</Label>
          <Select
            value={audience}
            onValueChange={(v) => setAudience(v as ShareAudience)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHARE_AUDIENCES.map((a) => (
                <SelectItem key={a} value={a}>
                  {SHARE_AUDIENCE_LABELS[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isHostSite ? (
          <div className="space-y-1">
            <Label>Host site</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a host site…" />
              </SelectTrigger>
              <SelectContent>
                {hostSites.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor="share-label">Label (optional)</Label>
          <Input
            id="share-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. For coach driver"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="share-expiry">Expires (optional)</Label>
          <Input
            id="share-expiry"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {SHARE_AUDIENCE_BLURBS[audience]}
      </p>
      {noHostSites ? (
        <p className="text-xs text-destructive">
          No host sites available. Mark a location as a host site first.
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        disabled={pending || noHostSites || (isHostSite && !locationId)}
        onClick={submit}
      >
        Create link
      </Button>
    </div>
  );
}
