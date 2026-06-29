import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { toDateInput, computeDayDate } from "@/lib/dates";

export function registerItineraryTools(server: McpServer, user: SessionUser) {
  // ── get-itinerary (VIEWER+) ───────────────────────────────────────────
  server.tool(
    "get-itinerary",
    "Get the full day-by-day schedule for a trip. Returns all days with their schedule items, including times, locations, categories, presentations, presenters, and booking statuses. This is the most detailed view of a trip's plan.",
    { tripId: z.string() },
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

        const serialized = days.map((day) => ({
          ...day,
          date: toDateInput(day.date),
        }));

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(serialized, null, 2) },
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
  server.tool(
    "add-day",
    "Add a new day to a trip's itinerary. The day is appended at the end with the next sequential day number. Its date is automatically computed from the trip's start date.",
    { tripId: z.string(), title: z.string().optional() },
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
  server.tool(
    "add-schedule-item",
    "Add a timed item to a day's schedule. Requires the dayId (from get-itinerary). Provide a title and/or location IDs. Times use 24-hour HH:MM format. Categories like 'Visit', 'Meal', 'Presentation', 'Travel', 'Free time' can be set via categoryId.",
    {
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
              text: JSON.stringify(
                { id: item.id, order: item.order },
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

  // ── update-schedule-item (PLANNER+) ───────────────────────────────────
  server.tool(
    "update-schedule-item",
    "Update a schedule item's title, times, locations, category, or notes. Only include fields you want to change. Use get-itinerary to find item IDs.",
    {
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
        if (categoryId !== undefined) updateData.categoryId = categoryId || null;
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
              text: JSON.stringify(
                { success: true, id: itemId },
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
}
