import { prisma } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/authz";
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
import { CalendarFeedManager } from "../calendar-feeds/calendar-feed-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const canManageFeeds = hasRole(user.role, "PLANNER");

  // A single subscribable feed spanning every (non-template) trip. These are
  // shared staff feeds, not per-user.
  const allTripsFeeds = await prisma.calendarFeed.findMany({
    where: { scope: "ALL" },
    orderBy: { createdAt: "desc" },
    select: { id: true, token: true, label: true, enabled: true },
  });

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
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Calendar feed — all trips</CardTitle>
        </CardHeader>
        <CardContent>
          <CalendarFeedManager
            scope="ALL"
            canEdit={canManageFeeds}
            feeds={allTripsFeeds}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Todoist</CardTitle>
        </CardHeader>
        <CardContent>
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
