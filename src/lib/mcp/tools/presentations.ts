import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";

export function registerPresentationTools(server: McpServer, user: SessionUser) {
  // ── list-presentations (VIEWER+) ──────────────────────────────────────
  server.registerTool(
    "list-presentations",
    {
      title: "List Presentations",
      description:
        "List the catalog of reusable presentations (talks/sessions). One presentation can recur across trips and span multiple schedule items. Returns id, title, duration, default presenters, and how many schedule items deliver it. Use the id with add-schedule-item / update-schedule-item (presentationId). Excludes archived talks unless includeArchived is set.",
      inputSchema: {
        query: z.string().optional(),
        includeArchived: z.boolean().optional(),
        limit: z.number().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, includeArchived, limit }) => {
      try {
        const where: Record<string, unknown> = {};
        if (!includeArchived) where.archivedAt = null;
        if (query) where.title = { contains: query, mode: "insensitive" };

        const presentations = await prisma.presentation.findMany({
          where,
          take: limit || 50,
          orderBy: { title: "asc" },
          include: {
            defaultPresenters: { select: { id: true, name: true } },
            _count: { select: { items: true } },
          },
        });

        const result = presentations.map((p) => ({
          id: p.id,
          title: p.title,
          durationMinutes: p.durationMinutes,
          defaultPresenters: p.defaultPresenters,
          occurrenceCount: p._count.items,
          archived: p.archivedAt !== null,
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

  // ── get-presentation (VIEWER+) ────────────────────────────────────────
  server.registerTool(
    "get-presentation",
    {
      title: "Get Presentation Details",
      description:
        "Get full details of a presentation including its abstract/description, staff notes, duration, default presenters, and the schedule items (with trip and day) where it is delivered. Use list-presentations to find the id.",
      inputSchema: { presentationId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ presentationId }) => {
      try {
        const presentation = await prisma.presentation.findUnique({
          where: { id: presentationId },
          include: {
            defaultPresenters: {
              select: { id: true, name: true, organization: true },
            },
            items: {
              select: {
                id: true,
                title: true,
                day: {
                  select: {
                    dayIndex: true,
                    trip: { select: { id: true, name: true } },
                  },
                },
              },
            },
          },
        });

        if (!presentation) {
          return {
            content: [
              { type: "text" as const, text: "Error: Presentation not found" },
            ],
            isError: true,
          };
        }

        const result = {
          id: presentation.id,
          title: presentation.title,
          description: presentation.description,
          notes: presentation.notes,
          durationMinutes: presentation.durationMinutes,
          archived: presentation.archivedAt !== null,
          defaultPresenters: presentation.defaultPresenters,
          occurrences: presentation.items.map((i) => ({
            scheduleItemId: i.id,
            title: i.title,
            dayIndex: i.day.dayIndex,
            trip: i.day.trip,
          })),
        };

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

  // ── create-presentation (PLANNER+) ────────────────────────────────────
  server.registerTool(
    "create-presentation",
    {
      title: "Create Presentation",
      description:
        "Create a reusable presentation (talk/session) in the catalog. Requires a title. description is the itinerary-facing abstract; notes are staff-only. durationMinutes is optional. defaultPresenterIds (use search-contacts to find them) pre-fill the speaker on schedule items that deliver this talk.",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        notes: z.string().optional(),
        durationMinutes: z.number().optional(),
        defaultPresenterIds: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ title, description, notes, durationMinutes, defaultPresenterIds }) => {
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
        const presentation = await prisma.presentation.create({
          data: {
            title,
            description: description || null,
            notes: notes || null,
            durationMinutes: durationMinutes ?? null,
            defaultPresenters: defaultPresenterIds?.length
              ? { connect: defaultPresenterIds.map((id) => ({ id })) }
              : undefined,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: presentation.id }, null, 2),
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

  // ── update-presentation (PLANNER+) ────────────────────────────────────
  server.registerTool(
    "update-presentation",
    {
      title: "Update Presentation",
      description:
        "Update a presentation's title, description, notes, or duration. Only include fields you want to change. Passing defaultPresenterIds REPLACES the full set of default presenters (pass [] to clear). Use list-presentations to find the id.",
      inputSchema: {
        presentationId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
        durationMinutes: z.number().optional(),
        defaultPresenterIds: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      presentationId,
      title,
      description,
      notes,
      durationMinutes,
      defaultPresenterIds,
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
        const data: Record<string, unknown> = {};
        if (title !== undefined) data.title = title;
        if (description !== undefined) data.description = description || null;
        if (notes !== undefined) data.notes = notes || null;
        if (durationMinutes !== undefined)
          data.durationMinutes = durationMinutes ?? null;
        if (defaultPresenterIds !== undefined) {
          data.defaultPresenters = {
            set: defaultPresenterIds.map((id) => ({ id })),
          };
        }

        await prisma.presentation.update({
          where: { id: presentationId },
          data,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, id: presentationId }, null, 2),
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
