import type { Prisma, TodoistConnection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { noteTarget } from "@/lib/notes";
import { todayUtc, toDateInput } from "@/lib/dates";
import {
  TOUR_PLANNER_LABEL,
  closeTask,
  createTask,
  getTask,
  isTaskCompleted,
  updateTask,
} from "@/lib/todoist";

// Bridges Notes ↔ Todoist: pushes follow-ups as tasks, closes them when the
// follow-up clears, and lazily pulls completions back. EVERYTHING here is
// best-effort — functions return a warning string (or null) instead of throwing,
// so a Todoist outage never fails a note save. Callable from Server Actions and
// MCP tools alike (no revalidatePath in here).

export type TodoistAuth = { token: string; connection: TodoistConnection };

/** The user's decrypted Todoist credentials, or null when not connected. */
export async function getTodoistAuth(userId: string): Promise<TodoistAuth | null> {
  const connection = await prisma.todoistConnection.findUnique({
    where: { userId },
  });
  if (!connection) return null;
  try {
    return { token: decryptSecret(connection.accessToken), connection };
  } catch {
    // AUTH_SECRET rotated or row corrupted — treat as disconnected.
    return null;
  }
}

const NOTE_TARGET_INCLUDE = {
  location: { select: { id: true, name: true } },
  booking: {
    select: {
      tripId: true,
      label: true,
      location: { select: { name: true } },
      trip: { select: { id: true, name: true } },
      scheduleItem: {
        select: {
          day: { select: { trip: { select: { id: true, name: true } } } },
        },
      },
    },
  },
  trip: { select: { id: true, name: true } },
  stay: {
    select: {
      tripId: true,
      trip: { select: { id: true, name: true } },
      location: { select: { name: true } },
    },
  },
} as const;

type NoteWithTarget = Prisma.NoteGetPayload<{
  include: typeof NOTE_TARGET_INCLUDE;
}>;

// The owning trip id for a trip-context note (trip / booking / stay), else null
// (a location-only note routes via resolveLocationProject instead).
function tripIdOf(note: NoteWithTarget): string | null {
  if (note.tripId) return note.tripId;
  if (note.booking)
    return (
      note.booking.tripId ?? note.booking.scheduleItem?.day.trip.id ?? null
    );
  if (note.stay) return note.stay.tripId;
  return null;
}

// Trip-context routing: the trip's own project link, else the trip type's, else
// the user default, else null (Todoist Inbox).
async function resolveTripProject(
  userId: string,
  tripId: string,
  connection: TodoistConnection,
): Promise<string | null> {
  const tripLink = await prisma.tripTodoistLink.findUnique({
    where: { userId_tripId: { userId, tripId } },
    select: { todoistProjectId: true },
  });
  if (tripLink) return tripLink.todoistProjectId;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { tripTypeId: true },
  });
  if (trip) {
    const typeLink = await prisma.tripTypeTodoistLink.findUnique({
      where: { userId_tripTypeId: { userId, tripTypeId: trip.tripTypeId } },
      select: { todoistProjectId: true },
    });
    if (typeLink) return typeLink.todoistProjectId;
  }
  return connection.defaultProjectId;
}

/**
 * Default destination for a LOCATION-only note (the note form pre-selects this;
 * the user can override). Rules: no trip types on the location → user default;
 * one → that type's project; several → the type of the next scheduled-or-active
 * trip among them (soonest startDate ≥ today, else an ongoing one).
 */
export async function resolveLocationProject(
  userId: string,
  locationId: string,
  connection: TodoistConnection,
): Promise<string | null> {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    select: { tripTypes: { select: { id: true } } },
  });
  const typeIds = (location?.tripTypes ?? []).map((t) => t.id);
  if (typeIds.length === 0) return connection.defaultProjectId;

  let tripTypeId = typeIds[0];
  if (typeIds.length > 1) {
    const next = await prisma.trip.findFirst({
      where: {
        isTemplate: false,
        tripTypeId: { in: typeIds },
        status: "ACTIVE",
        OR: [{ endDate: { gte: todayUtc() } }, { endDate: null }],
      },
      orderBy: { startDate: "asc" },
      select: { tripTypeId: true },
    });
    if (next) tripTypeId = next.tripTypeId;
  }
  const typeLink = await prisma.tripTypeTodoistLink.findUnique({
    where: { userId_tripTypeId: { userId, tripTypeId } },
    select: { todoistProjectId: true },
  });
  return typeLink?.todoistProjectId ?? connection.defaultProjectId;
}

const WARNING = "Note saved. Todoist sync failed.";

/**
 * Push a note's follow-up state to Todoist after a create/update:
 * follow-up on + no task → create; on + task → update due/content;
 * off + task → close (and forget the id, so re-flagging makes a fresh task).
 * `destinationProjectId` is the note form's explicit choice (location notes).
 * Returns a warning message for the toast, or null when all is well (including
 * "user not connected", which is simply a no-op).
 */
export async function syncNoteFollowUp(
  userId: string,
  noteId: string,
  destinationProjectId?: string,
): Promise<string | null> {
  const auth = await getTodoistAuth(userId);
  if (!auth) return null;

  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: NOTE_TARGET_INCLUDE,
  });
  if (!note) return null;

  try {
    if (!note.followUp) {
      if (note.todoistTaskId) {
        await closeTask(auth.token, note.todoistTaskId).catch((e) => {
          // Already completed/deleted in Todoist is fine.
          if (!(e && typeof e === "object" && "status" in e && e.status === 404))
            throw e;
        });
        await prisma.note.update({
          where: { id: note.id },
          data: { todoistTaskId: null },
        });
      }
      return null;
    }

    const target = noteTarget(note);
    const content = `${target.label}: ${note.body.split("\n")[0]}`;
    const dueDate = note.dueDate ? toDateInput(note.dueDate) : null;

    if (note.todoistTaskId) {
      await updateTask(auth.token, note.todoistTaskId, { content, dueDate });
      return null;
    }

    const tripId = tripIdOf(note);
    const projectId = tripId
      ? await resolveTripProject(userId, tripId, auth.connection)
      : (destinationProjectId ??
        (note.locationId
          ? await resolveLocationProject(userId, note.locationId, auth.connection)
          : auth.connection.defaultProjectId));

    const task = await createTask(auth.token, {
      content,
      description: `${process.env.AUTH_URL ?? ""}${target.href}`,
      projectId,
      dueDate,
      labels: [TOUR_PLANNER_LABEL],
    });
    await prisma.note.update({
      where: { id: note.id },
      data: { todoistTaskId: task.id },
    });
    return null;
  } catch (e) {
    console.warn("todoist sync failed:", e);
    return WARNING;
  }
}

/** Close the mirrored task when a note is deleted. Best-effort. */
export async function closeNoteTaskOnDelete(
  userId: string,
  todoistTaskId: string | null,
): Promise<void> {
  if (!todoistTaskId) return;
  const auth = await getTodoistAuth(userId);
  if (!auth) return;
  try {
    await closeTask(auth.token, todoistTaskId);
  } catch (e) {
    console.warn("todoist close-on-delete failed:", e);
  }
}

const RECONCILE_MIN_MS = 60 * 1000;

/**
 * Lazy completion pull: for the user's open follow-ups that have Todoist tasks,
 * fetch task state and clear `followUp` for ones completed (or deleted) in
 * Todoist. Throttled via lastReconciledAt (~60s) — call it freely from the
 * dashboard render path. Returns the number of follow-ups cleared.
 */
export async function reconcileTodoistFollowUps(userId: string): Promise<number> {
  const auth = await getTodoistAuth(userId);
  if (!auth) return 0;

  const last = auth.connection.lastReconciledAt?.getTime() ?? 0;
  if (Date.now() - last < RECONCILE_MIN_MS) return 0;
  // Stamp first so concurrent renders don't double-poll.
  await prisma.todoistConnection.update({
    where: { id: auth.connection.id },
    data: { lastReconciledAt: new Date() },
  });

  const open = await prisma.note.findMany({
    where: { createdById: userId, followUp: true, todoistTaskId: { not: null } },
    select: { id: true, todoistTaskId: true },
    take: 50,
  });
  let cleared = 0;
  for (const note of open) {
    try {
      const task = await getTask(auth.token, note.todoistTaskId!);
      if (task == null || isTaskCompleted(task)) {
        await prisma.note.update({
          where: { id: note.id },
          data: { followUp: false, todoistTaskId: null },
        });
        cleared += 1;
      }
    } catch (e) {
      console.warn("todoist reconcile failed:", e);
      break; // outage — stop hammering; next throttle window retries
    }
  }
  return cleared;
}
