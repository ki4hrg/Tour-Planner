import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { toDateInput, computeDayDate } from "@/lib/dates";

export function registerItineraryTools(server: McpServer, user: SessionUser) {
  // ── list-schedule-categories (VIEWER+) ────────────────────────────────
  server.registerTool(
    "list-schedule-categories",
    {
      title: "List Schedule Categories",
      description:
        "List the configurable schedule-item categories (Visit, Presentation, Meal, Travel, Free time, Break…). Returns id, name, color, and whether it's a built-in system category. Use a category id with add-schedule-item / update-schedule-item (categoryId).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        if (!hasRole(user.role, "VIEWER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const categories = await prisma.scheduleItemCategory.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            color: true,
            sortOrder: true,
            system: true,
          },
        });

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(categories, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── get-itinerary (VIEWER+) ───────────────────────────────────────────
  server.registerTool(
    "get-itinerary",
    {
      title: "Get Itinerary",
      description:
        "Get the full day-by-day schedule for a trip. Returns all days with their schedule items, including times, locations, categories, presentations, presenters, and booking statuses. This is the most detailed view of a trip's plan.",
      inputSchema: { tripId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tripId }) => {
      try {
        if (!hasRole(user.role, "VIEWER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const days = await prisma.itineraryDay.findMany({
          where: { tripId },
          orderBy: { dayIndex: "asc" },
          include: {
            scheduleItems: {
              orderBy: { order: "asc" },
              include: {
                category: { select: { id: true, name: true, color: true } },
                presentation: { select: { id: true, title: true } },
                presenters: { select: { id: true, name: true } },
                sites: {
                  orderBy: { order: "asc" },
                  include: {
                    location: { select: { id: true, name: true } },
                  },
                },
                bookings: {
                  select: {
                    id: true,
                    status: true,
                    locationId: true,
                    label: true,
                    confirmationRef: true,
                  },
                },
              },
            },
          },
        });

        const serialized = days.map((day: (typeof days)[number]) => ({
          ...day,
          date: toDateInput(day.date),
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(serialized, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── add-day (PLANNER+) ────────────────────────────────────────────────
  server.registerTool(
    "add-day",
    {
      title: "Add Itinerary Day",
      description:
        "Add a new day to a trip's itinerary. The day is appended at the end with the next sequential day number. Its date is automatically computed from the trip's start date.",
      inputSchema: { tripId: z.string(), title: z.string().optional() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ tripId, title }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { startDate: true, _count: { select: { days: true } } },
        });

        if (!trip) {
          return {
            content: [{ type: "text" as const, text: "Error: Trip not found" }],
            isError: true,
          };
        }

        const dayIndex = trip._count.days + 1;
        const day = await prisma.itineraryDay.create({
          data: {
            tripId,
            dayIndex,
            title: title || null,
            date: computeDayDate(trip.startDate, dayIndex),
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { ...day, date: toDateInput(day.date) },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── add-schedule-item (PLANNER+) ──────────────────────────────────────
  server.registerTool(
    "add-schedule-item",
    {
      title: "Add Schedule Item",
      description:
        "Add a timed item to a day's schedule. Requires the dayId (from get-itinerary). Provide a title and/or location IDs. Times use 24-hour HH:MM format. Categories like 'Visit', 'Meal', 'Presentation', 'Travel', 'Free time' can be set via categoryId.",
      inputSchema: {
        dayId: z.string(),
        title: z.string().optional(),
        categoryId: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        notes: z.string().optional(),
        locationIds: z.array(z.string()).optional(),
        presentationId: z.string().optional(),
        presenterIds: z.array(z.string()).optional(),
        isBlock: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      dayId,
      title,
      categoryId,
      startTime,
      endTime,
      notes,
      locationIds,
      presentationId,
      presenterIds,
      isBlock,
    }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const count = await prisma.scheduleItem.count({ where: { dayId } });
        const item = await prisma.scheduleItem.create({
          data: {
            dayId,
            order: count + 1,
            categoryId: categoryId || null,
            title: title || null,
            startTime: startTime || null,
            endTime: endTime || null,
            notes: notes || null,
            isBlock: isBlock ?? false,
            presentationId: presentationId || null,
            presenters: presenterIds?.length
              ? { connect: presenterIds.map((id) => ({ id })) }
              : undefined,
            sites: locationIds?.length
              ? {
                  create: locationIds.map((locationId, i) => ({
                    locationId,
                    order: i,
                  })),
                }
              : undefined,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ id: item.id, order: item.order }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update-schedule-item (PLANNER+) ───────────────────────────────────
  server.registerTool(
    "update-schedule-item",
    {
      title: "Update Schedule Item",
      description:
        "Update a schedule item's title, times, locations, category, or notes. Only include fields you want to change. Use get-itinerary to find item IDs.",
      inputSchema: {
        itemId: z.string(),
        title: z.string().optional(),
        categoryId: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        notes: z.string().optional(),
        locationIds: z.array(z.string()).optional(),
        presentationId: z.string().optional(),
        presenterIds: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      itemId,
      title,
      categoryId,
      startTime,
      endTime,
      notes,
      locationIds,
      presentationId,
      presenterIds,
    }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const updateData: Record<string, unknown> = {};
        if (title !== undefined) updateData.title = title || null;
        if (categoryId !== undefined)
          updateData.categoryId = categoryId || null;
        if (startTime !== undefined) updateData.startTime = startTime || null;
        if (endTime !== undefined) updateData.endTime = endTime || null;
        if (notes !== undefined) updateData.notes = notes || null;
        if (presentationId !== undefined)
          updateData.presentationId = presentationId || null;
        if (presenterIds !== undefined) {
          updateData.presenters = { set: presenterIds.map((id) => ({ id })) };
        }

        await prisma.$transaction(async (tx) => {
          if (locationIds !== undefined) {
            await tx.scheduleItemSite.deleteMany({
              where: { scheduleItemId: itemId },
            });
            if (locationIds.length > 0) {
              await tx.scheduleItemSite.createMany({
                data: locationIds.map((locationId, i) => ({
                  scheduleItemId: itemId,
                  locationId,
                  order: i,
                })),
              });
            }
          }

          await tx.scheduleItem.update({
            where: { id: itemId },
            data: updateData,
          });
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, id: itemId }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update-day (PLANNER+) ─────────────────────────────────────────────
  server.registerTool(
    "update-day",
    {
      title: "Update Itinerary Day",
      description:
        "Update a day's title and notes. logisticalNotes are staff-only (hidden on participant/host-site shares); participantNotes are participant-facing free text. Only include fields you want to change. Use get-itinerary to find the day id. (Day dates are derived from the trip start date and cannot be set directly.)",
      inputSchema: {
        dayId: z.string(),
        title: z.string().optional(),
        logisticalNotes: z.string().optional(),
        participantNotes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dayId, title, logisticalNotes, participantNotes }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const data: Record<string, unknown> = {};
        if (title !== undefined) data.title = title || null;
        if (logisticalNotes !== undefined)
          data.logisticalNotes = logisticalNotes || null;
        if (participantNotes !== undefined)
          data.participantNotes = participantNotes || null;

        await prisma.itineraryDay.update({ where: { id: dayId }, data });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, id: dayId }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── delete-day (PLANNER+) ─────────────────────────────────────────────
  server.registerTool(
    "delete-day",
    {
      title: "Delete Itinerary Day",
      description:
        "Delete a day from a trip's itinerary. This also deletes the day's schedule items. Remaining days are renumbered and their dates recomputed. Use get-itinerary to find the day id.",
      inputSchema: { dayId: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ dayId }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const day = await prisma.itineraryDay.findUnique({
          where: { id: dayId },
          select: { tripId: true, trip: { select: { startDate: true } } },
        });
        if (!day) {
          return {
            content: [{ type: "text" as const, text: "Error: Day not found" }],
            isError: true,
          };
        }

        await prisma.$transaction(async (tx) => {
          await tx.itineraryDay.delete({ where: { id: dayId } }); // cascades to items
          const remaining = await tx.itineraryDay.findMany({
            where: { tripId: day.tripId },
            orderBy: { dayIndex: "asc" },
            select: { id: true },
          });
          for (let i = 0; i < remaining.length; i++) {
            await tx.itineraryDay.update({
              where: { id: remaining[i].id },
              data: {
                dayIndex: i + 1,
                date: computeDayDate(day.trip.startDate, i + 1),
              },
            });
          }
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, id: dayId }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── delete-schedule-item (PLANNER+) ───────────────────────────────────
  server.registerTool(
    "delete-schedule-item",
    {
      title: "Delete Schedule Item",
      description:
        "Delete a schedule item from a day. Remaining items in that day are renumbered to stay contiguous. Any site-less item booking tied to this item is removed too. Use get-itinerary to find the item id.",
      inputSchema: { itemId: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ itemId }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const item = await prisma.scheduleItem.findUnique({
          where: { id: itemId },
          select: { dayId: true },
        });
        if (!item) {
          return {
            content: [{ type: "text" as const, text: "Error: Item not found" }],
            isError: true,
          };
        }

        await prisma.$transaction(async (tx) => {
          await tx.scheduleItem.delete({ where: { id: itemId } });
          const remaining = await tx.scheduleItem.findMany({
            where: { dayId: item.dayId },
            orderBy: { order: "asc" },
            select: { id: true },
          });
          for (let i = 0; i < remaining.length; i++) {
            await tx.scheduleItem.update({
              where: { id: remaining[i].id },
              data: { order: i + 1 },
            });
          }
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, id: itemId }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
