import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TripStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { toDateInput, parseDateInput } from "@/lib/dates";

export function registerTripTools(server: McpServer, user: SessionUser) {
  // ── list-trips (VIEWER+) ──────────────────────────────────────────────
  server.tool(
    "list-trips",
    "List all trips, optionally filtered by status (PLANNING, CONFIRMED, IN_PROGRESS, COMPLETED, ARCHIVED) or trip type. Returns trip name, dates, status, type, and participant count.",
    {
      status: z.string().optional(),
      tripTypeId: z.string().optional(),
      includeTemplates: z.boolean().optional(),
    },
    async ({ status, tripTypeId, includeTemplates }) => {
      try {
        const where: Record<string, unknown> = {};

        if (status) where.status = status;
        if (tripTypeId) where.tripTypeId = tripTypeId;
        if (!includeTemplates) where.isTemplate = false;

        const trips = await prisma.trip.findMany({
          where,
          include: { tripType: { select: { name: true } } },
          orderBy: [
            { startDate: { sort: "asc", nulls: "last" } },
            { createdAt: "desc" },
          ],
        });

        const result = trips.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          tripType: t.tripType.name,
          startDate: toDateInput(t.startDate),
          endDate: toDateInput(t.endDate),
          capacity: t.capacity,
          participantCount: t.participantCount,
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── get-trip (VIEWER+) ────────────────────────────────────────────────
  server.tool(
    "get-trip",
    "Get full details of a specific trip including day count, stay count, and booking status summary (counts of NOT_BOOKED, REQUESTED, CONFIRMED across all items). Use list-trips first to find the trip ID.",
    { tripId: z.string() },
    async ({ tripId }) => {
      try {
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          include: {
            tripType: true,
            _count: { select: { days: true, stays: true } },
          },
        });

        if (!trip) {
          return {
            content: [{ type: "text" as const, text: "Error: Trip not found" }],
            isError: true,
          };
        }

        const bookingCounts = await prisma.booking.groupBy({
          by: ["status"],
          where: {
            OR: [
              { scheduleItem: { day: { tripId } } },
              { stay: { tripId } },
            ],
          },
          _count: true,
        });

        const bookingStatus: Record<string, number> = {};
        for (const b of bookingCounts) {
          bookingStatus[b.status] = b._count;
        }

        const result = {
          id: trip.id,
          name: trip.name,
          status: trip.status,
          tripType: trip.tripType.name,
          startDate: toDateInput(trip.startDate),
          endDate: toDateInput(trip.endDate),
          capacity: trip.capacity,
          participantCount: trip.participantCount,
          notes: trip.notes,
          isTemplate: trip.isTemplate,
          dayCount: trip._count.days,
          stayCount: trip._count.stays,
          bookingStatus,
          createdAt: trip.createdAt.toISOString(),
          updatedAt: trip.updatedAt.toISOString(),
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── create-trip (PLANNER+) ────────────────────────────────────────────
  server.tool(
    "create-trip",
    "Create a new trip. Requires a name and tripTypeId. Status defaults to PLANNING. Dates (YYYY-MM-DD), capacity, and participant count are optional. Use list-trip-types to find available type IDs.",
    {
      name: z.string(),
      tripTypeId: z.string(),
      status: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      capacity: z.number().optional(),
      participantCount: z.number().optional(),
      notes: z.string().optional(),
    },
    async ({ name, tripTypeId, status, startDate, endDate, capacity, participantCount, notes }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [{ type: "text" as const, text: "Error: Requires PLANNER role or above" }],
          isError: true,
        };
      }

      try {
        const trip = await prisma.trip.create({
          data: {
            name,
            tripTypeId,
            status: (status as TripStatus) || "PLANNING",
            startDate: parseDateInput(startDate),
            endDate: parseDateInput(endDate),
            capacity,
            participantCount,
            notes,
            createdById: user.id,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(trip, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── update-trip (PLANNER+) ────────────────────────────────────────────
  server.tool(
    "update-trip",
    "Update an existing trip's details. Only include fields you want to change. Valid statuses: PLANNING, CONFIRMED, IN_PROGRESS, COMPLETED, ARCHIVED.",
    {
      tripId: z.string(),
      name: z.string().optional(),
      status: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      capacity: z.number().optional(),
      participantCount: z.number().optional(),
      notes: z.string().optional(),
    },
    async ({ tripId, name, status, startDate, endDate, capacity, participantCount, notes }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [{ type: "text" as const, text: "Error: Requires PLANNER role or above" }],
          isError: true,
        };
      }

      try {
        const data: Record<string, unknown> = {};

        if (name !== undefined) data.name = name;
        if (status !== undefined) data.status = status;
        if (startDate !== undefined) data.startDate = parseDateInput(startDate);
        if (endDate !== undefined) data.endDate = parseDateInput(endDate);
        if (capacity !== undefined) data.capacity = capacity;
        if (participantCount !== undefined) data.participantCount = participantCount;
        if (notes !== undefined) data.notes = notes;

        const trip = await prisma.trip.update({
          where: { id: tripId },
          data,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(trip, null, 2) }],
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
