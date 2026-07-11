import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NoteMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { toDateInput, parseDateInput, todayUtc } from "@/lib/dates";
import { NOTE_TARGETS, type NoteTarget } from "@/lib/validators/note";
import { syncNoteFollowUp } from "@/lib/todoist-sync";

// Map a polymorphic target to its FK column.
function targetColumn(
  target: NoteTarget,
): "locationId" | "bookingId" | "tripId" | "stayId" {
  return `${target}Id` as const;
}

export function registerNoteTools(server: McpServer, user: SessionUser) {
  // ── list-notes (VIEWER+) ──────────────────────────────────────────────
  server.registerTool(
    "list-notes",
    {
      title: "List Notes",
      description:
        "List the contact-log notes attached to a target. A note records a conversation/contact while arranging a trip (method, who was spoken to, when, follow-up flag + due date). Specify target ('location' | 'booking' | 'trip' | 'stay') and the matching id (from search-locations / list-bookings / list-trips / list-stays). Most recent first.",
      inputSchema: {
        target: z.enum(NOTE_TARGETS),
        targetId: z.string(),
        followUpOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ target, targetId, followUpOnly }) => {
      try {
        if (!hasRole(user.role, "VIEWER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const notes = await prisma.note.findMany({
          where: {
            [targetColumn(target)]: targetId,
            ...(followUpOnly ? { followUp: true } : {}),
          },
          orderBy: [{ contactedOn: "desc" }, { createdAt: "desc" }],
          include: {
            contact: { select: { id: true, name: true, organization: true } },
            createdBy: { select: { id: true, name: true, email: true } },
          },
        });

        const result = notes.map((n) => ({
          id: n.id,
          body: n.body,
          method: n.method,
          contact: n.contact,
          contactedOn: toDateInput(n.contactedOn),
          followUp: n.followUp,
          dueDate: toDateInput(n.dueDate),
          createdBy: n.createdBy.name ?? n.createdBy.email,
          createdAt: n.createdAt.toISOString(),
        }));

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── add-note (PLANNER+) ───────────────────────────────────────────────
  server.registerTool(
    "add-note",
    {
      title: "Add Note",
      description:
        "Add a contact-log note to a target. Specify target ('location' | 'booking' | 'trip' | 'stay') and the matching id. body is required. method is CALL, EMAIL, IN_PERSON, or OTHER (default OTHER). contactId links the person spoken to (use search-contacts). contactedOn (YYYY-MM-DD, defaults to today) is when the contact happened. Set followUp=true with an optional dueDate (YYYY-MM-DD) to flag a follow-up.",
      inputSchema: {
        target: z.enum(NOTE_TARGETS),
        targetId: z.string(),
        body: z.string(),
        method: z.string().optional(),
        contactId: z.string().optional(),
        contactedOn: z.string().optional(),
        followUp: z.boolean().optional(),
        dueDate: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      target,
      targetId,
      body,
      method,
      contactId,
      contactedOn,
      followUp,
      dueDate,
    }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Requires PLANNER role or above",
            },
          ],
          isError: true,
        };
      }

      try {
        const contactedOnDate = contactedOn
          ? parseDateInput(contactedOn)
          : todayUtc();
        if (!contactedOnDate) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Invalid contactedOn. Use YYYY-MM-DD.",
              },
            ],
            isError: true,
          };
        }

        const note = await prisma.note.create({
          data: {
            body,
            method: (method as NoteMethod) || "OTHER",
            contactId: contactId || null,
            contactedOn: contactedOnDate,
            followUp: followUp ?? false,
            dueDate: dueDate ? parseDateInput(dueDate) : null,
            [targetColumn(target)]: targetId,
            createdById: user.id,
          },
        });

        // Best-effort Todoist push (no-op unless this user has a connection).
        const todoistWarning = await syncNoteFollowUp(user.id, note.id);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { id: note.id, ...(todoistWarning ? { todoistWarning } : {}) },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
