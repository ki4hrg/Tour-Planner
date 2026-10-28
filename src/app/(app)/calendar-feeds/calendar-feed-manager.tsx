"use client";

import { useState } from "react";
import type { CalendarFeedScope } from "@prisma/client";
import { toast } from "sonner";
import { Copy, Check, Trash2, CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/lib/use-action";
import { useOrigin } from "@/lib/use-origin";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  createCalendarFeed,
  setCalendarFeedEnabled,
  deleteCalendarFeed,
} from "./actions";

export type SerializedCalendarFeed = {
  id: string;
  token: string;
  label: string | null;
  enabled: boolean;
};


function feedPath(token: string): string {
  return `/api/feed/${token}.ics`;
}

// https URL for pasting into Google Calendar ("From URL"); webcal:// for one-tap
// subscribe on iOS/macOS (and Google honours it too).
function httpsUrl(token: string, origin: string): string {
  return `${origin}${feedPath(token)}`;
}
function webcalUrl(token: string, host: string): string {
  return host ? `webcal://${host}${feedPath(token)}` : feedPath(token);
}

export function CalendarFeedManager({
  scope,
  tripId,
  tripTypeId,
  feeds,
  canEdit,
}: {
  scope: CalendarFeedScope;
  tripId?: string;
  tripTypeId?: string;
  feeds: SerializedCalendarFeed[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4 text-sm">
      {feeds.length === 0 ? (
        <p className="text-muted-foreground">No calendar feeds.</p>
      ) : (
        <ul className="space-y-2">
          {feeds.map((feed) => (
            <FeedRow key={feed.id} feed={feed} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit ? (
        <CreateForm scope={scope} tripId={tripId} tripTypeId={tripTypeId} />
      ) : null}
    </div>
  );
}

function FeedRow({
  feed,
  canEdit,
}: {
  feed: SerializedCalendarFeed;
  canEdit: boolean;
}) {
  const { pending, run } = useAction();
  const { origin, host } = useOrigin();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(httpsUrl(feed.token, origin));
    setCopied(true);
    toast.success("Copied.");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {!feed.enabled ? <Badge variant="destructive">Disabled</Badge> : null}
        {feed.label ? (
          <span className="text-muted-foreground">{feed.label}</span>
        ) : (
          <span className="text-muted-foreground">Calendar feed</span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input
          readOnly
          value={httpsUrl(feed.token, origin)}
          className="h-8 font-mono text-base md:text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={copy}
          aria-label="Copy feed URL"
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        {feed.enabled ? (
          <Button asChild size="sm" variant="outline">
            <a href={webcalUrl(feed.token, host)}>
              <CalendarPlus className="size-4" /> Subscribe
            </a>
          </Button>
        ) : null}
      </div>
      {canEdit ? (
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => setCalendarFeedEnabled(feed.id, !feed.enabled))}
          >
            {feed.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => run(() => deleteCalendarFeed(feed.id))}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function CreateForm({
  scope,
  tripId,
  tripTypeId,
}: {
  scope: CalendarFeedScope;
  tripId?: string;
  tripTypeId?: string;
}) {
  const { pending, run } = useAction();
  const [label, setLabel] = useState("");

  const submit = () =>
    run(
      () => createCalendarFeed({ scope, tripId, tripTypeId, label: label || undefined }),
      () => setLabel(""),
    );

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="font-medium">New feed</p>
      <div className="space-y-1">
        <Label htmlFor="feed-label">Label</Label>
        <Input
          id="feed-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Leaders' calendar"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Includes staff notes. Anyone with the URL can read it.
      </p>
      <Button type="button" size="sm" disabled={pending} onClick={submit}>
        Create feed
      </Button>
    </div>
  );
}
