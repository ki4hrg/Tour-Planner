"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FormState } from "@/lib/forms";
import {
  createApiKey,
  revokeApiKey,
  type CreateApiKeyResult,
} from "./actions";

type TripType = {
  id: string;
  name: string;
};

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  tripTypeIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

interface ApiKeysManagerProps {
  keys: ApiKeyRow[];
  tripTypes: TripType[];
}

// Surface action results as toasts.
function useToastEffect(state: FormState) {
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);
}

function CreateApiKeyForm({ tripTypes }: { tripTypes: TripType[] }) {
  const [state, action, pending] = useActionState<CreateApiKeyResult, FormData>(
    createApiKey,
    {},
  );
  const [copiedKey, setCopiedKey] = useState(false);

  useToastEffect(state);

  const copyToClipboard = () => {
    if (state.key) {
      navigator.clipboard.writeText(state.key);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New API key</CardTitle>
      </CardHeader>
      <CardContent>
        {state.key ? (
          // Show the full key only once
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded p-3">
              <p className="text-xs text-amber-900 mb-2">
                This key will only be shown once.{" "}
                {copiedKey ? "Copied." : "Click to copy."}
              </p>
              <button
                type="button"
                onClick={copyToClipboard}
                aria-label="Copy key"
                className="flex w-full items-start gap-2 text-left font-mono text-sm break-all bg-white border rounded p-2 hover:bg-amber-100"
              >
                <span className="min-w-0 flex-1">{state.key}</span>
                {copiedKey ? (
                  <Check className="size-4 shrink-0 text-green-700" />
                ) : (
                  <Copy className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <form
            action={action}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                name="name"
                placeholder="WordPress plugin"
                required
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="key-tripTypes">Limit to trip types</Label>
              <div className="flex flex-wrap gap-2">
                {tripTypes.map((tt) => (
                  <label key={tt.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      name="tripTypeIds"
                      value={tt.id}
                      className="rounded"
                    />
                    <span className="text-sm">{tt.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create key"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function RevokeKeyButton({ keyId }: { keyId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    revokeApiKey,
    {},
  );

  useToastEffect(state);

  return (
    <form id={`revoke-key-${keyId}`} action={action} className="inline">
      <input type="hidden" name="keyId" value={keyId} />
      <ConfirmButton
        formId={`revoke-key-${keyId}`}
        variant="destructive"
        size="sm"
        disabled={pending}
        pending={pending}
        title="Revoke key"
        description="Requests with this key fail immediately."
        confirmLabel="Revoke"
      >
        {pending ? "Revoking…" : "Revoke"}
      </ConfirmButton>
    </form>
  );
}

export function ApiKeysManager({
  keys,
  tripTypes,
}: ApiKeysManagerProps) {
  return (
    <div className="space-y-6">
      <CreateApiKeyForm tripTypes={tripTypes} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No API keys.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Trip types</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow
                      key={key.id}
                      className={key.revokedAt ? "opacity-60" : ""}
                    >
                      <TableCell className="font-mono text-sm">{key.name}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {key.prefix}***
                      </TableCell>
                      <TableCell className="text-sm">
                        {key.tripTypeIds.length === 0
                          ? "All"
                          : key.tripTypeIds.length + " types"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(key.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm">
                        {key.lastUsedAt
                          ? new Date(key.lastUsedAt).toLocaleDateString()
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {key.revokedAt ? (
                          <span className="text-red-600 font-medium">Revoked</span>
                        ) : (
                          <span className="text-green-600 font-medium">Active</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!key.revokedAt && <RevokeKeyButton keyId={key.id} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
