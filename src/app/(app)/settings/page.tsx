import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/authz";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getTodoistAuth } from "@/lib/todoist-sync";
import { listProjects } from "@/lib/todoist";
import {
  TodoistConnectForm,
  TodoistManager,
  type ProjectOption,
} from "./todoist-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();

  const auth = await getTodoistAuth(user.id);

  let projects: ProjectOption[] | null = null;
  let tokenHint = "";
  if (auth) {
    tokenHint = `…${auth.token.slice(-4)}`;
    try {
      projects = (await listProjects(auth.token)).map((p) => ({
        id: p.id,
        name: p.name,
      }));
    } catch {
      projects = null; // connected but unreachable — the manager says so
    }
  }

  const tripTypes = auth
    ? await prisma.tripType.findMany({
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          todoistLinks: {
            where: { userId: user.id },
            select: { todoistProjectId: true },
          },
        },
      })
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Personal integrations — these apply to your account only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Todoist</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Flagging a note as needing follow-up creates a Todoist task (with the
            <span className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
              tour-planner
            </span>
            label and a link back). Completing the task in Todoist clears the
            follow-up here.
          </p>
          {auth ? (
            <TodoistManager
              tokenHint={tokenHint}
              projects={projects}
              defaultProjectId={auth.connection.defaultProjectId}
              tripTypes={tripTypes.map((t) => ({
                id: t.id,
                name: t.name,
                todoistProjectId: t.todoistLinks[0]?.todoistProjectId ?? null,
              }))}
            />
          ) : (
            <TodoistConnectForm />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
