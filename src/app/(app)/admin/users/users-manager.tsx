"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FormState } from "@/lib/forms";
import {
  createUser,
  deleteUser,
  resetUserPassword,
  updateUserRole,
} from "./actions";

const ROLES: Role[] = ["ADMIN", "PLANNER", "VIEWER"];

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
};

// Surface action results as toasts.
function useToastEffect(state: FormState) {
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
    else if (state.error) toast.error(state.error);
  }, [state]);
}

function CreateUserForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createUser,
    {},
  );
  useToastEffect(state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add user</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={action}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input id="new-email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" name="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Temporary password</Label>
            <Input
              id="new-password"
              name="password"
              type="text"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role">Role</Label>
            <Select name="role" defaultValue="PLANNER">
              <SelectTrigger id="new-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create user"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function UserRowItem({
  user,
  isSelf,
}: {
  user: UserRow;
  isSelf: boolean;
}) {
  const [roleState, roleAction, rolePending] = useActionState<
    FormState,
    FormData
  >(updateUserRole, {});
  const [pwState, pwAction, pwPending] = useActionState<FormState, FormData>(
    resetUserPassword,
    {},
  );
  const [delState, delAction, delPending] = useActionState<FormState, FormData>(
    deleteUser,
    {},
  );
  useToastEffect(roleState);
  useToastEffect(pwState);
  useToastEffect(delState);

  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="truncate font-medium">{user.name ?? user.email}</div>
        <div className="truncate text-sm text-muted-foreground">
          {user.email}
          {isSelf ? " · you" : ""}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form action={roleAction} className="flex items-end gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Role</Label>
            <Select name="role" defaultValue={user.role}>
              <SelectTrigger className="w-32" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={rolePending}>
            Save
          </Button>
        </form>

        <form action={pwAction} className="flex items-end gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              New password
            </Label>
            <Input
              name="password"
              type="text"
              minLength={8}
              placeholder="min 8 chars"
              className="w-40"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={pwPending}
          >
            Reset
          </Button>
        </form>

        <form action={delAction}>
          <input type="hidden" name="userId" value={user.id} />
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            disabled={isSelf || delPending}
          >
            Delete
          </Button>
        </form>
      </div>
    </div>
  );
}

export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  return (
    <div className="space-y-6">
      <CreateUserForm />
      <Card>
        <CardHeader>
          <CardTitle>Users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {users.map((u) => (
            <UserRowItem
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
