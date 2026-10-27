import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { toDateInput, parseDateInput, todayUtc } from "@/lib/dates";
import {
  TRIP_LIFECYCLES,
  TRIP_STATUSES,
  type TripLifecycle,
  deriveTripLifecycle,
  tripLifecycleWhere,
} from "@/lib/trips";
import type { TripStatus } from "@prisma/client";
import { applyStartDateChange } from "@/lib/trip-mutations";

// z.enum needs tuple types; the arrays are non-empty by construction.
const lifecycleEnum = z.enum(
  TRIP_LIFECYCLES as [TripLifecycle, ...TripLifecycle[]],
);
const statusOverrideEnum = z.enum(TRIP_STATUSES as [TripStatus, ...TripStatus[]]);

export function registerTripTools(server: McpServer, user: SessionUser) {
  // ── list-trips (VIEWER+) ──────────────────────────────────────────────
  server.registerTool(
    "list-trips",
    {
      title: "List Trips",
      description:
        "List all trips, optionally filtered by lifecycle status (PLANNING, IN_PROGRESS, COMPLETE — derived from the trip's dates — or the manual overrides ARCHIVED, CANCELLED) or trip type. Returns trip name, dates, derived status, type, and participant count.",
      inputSchema: {
        status: lifecycleEnum.optional(),
        tripTypeId: z.string().optional(),
        includeTemplates: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status, tripTypeId, includeTemplates }) => {
      try {
        const today = todayUtc();
        const where = {
          ...(status ? tripLifecycleWhere(status, today) : {}),
          ...(tripTypeId ? { tripTypeId } : {}),
          ...(includeTemplates ? {} : { isTemplate: false }),
        };

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
          status: deriveTripLifecycle(t, today),
          tripType: t.tripType.name,
          currencies: t.currencies,
          startDate: toDateInput(t.startDate),
          endDate: toDateInput(t.endDate),
          capacity: t.capacity,
          participantCount: t.participantCount,
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

  // ── get-trip (VIEWER+) ────────────────────────────────────────────────
  server.registerTool(
    "get-trip",
    {
      title: "Get Trip Details",
      description:
        "Get full details of a specific trip including day count, stay count, and booking status summary (counts by coarse status across all bookings — PLANNED, IN_PROGRESS, CONFIRMED, NOT_NEEDED; workflow stages via list-bookings). Use list-trips first to find the trip ID.",
      inputSchema: { tripId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
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
            OR: [{ tripId }, { scheduleItem: { day: { tripId } } }],
          },
          _count: { _all: true },
        });

        const bookingStatus: Record<string, number> = {};
        for (const b of bookingCounts) {
          bookingStatus[b.status] = b._count._all;
        }

        const result = {
          id: trip.id,
          name: trip.name,
          status: deriveTripLifecycle(trip, todayUtc()),
          statusOverride: trip.status,
          tripType: trip.tripType.name,
          currencies: trip.currencies,
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

  // ── create-trip (PLANNER+) ────────────────────────────────────────────
  server.registerTool(
    "create-trip",
    {
      title: "Create Trip",
      description:
        "Create a new trip. Requires a name and tripTypeId. The Planning → In progress → Complete lifecycle is derived from the trip's dates; status is only a manual override (ACTIVE = normal, default; ARCHIVED; CANCELLED). Dates (YYYY-MM-DD), capacity, participant count, and currencies (3-letter codes; the trip-scoped currency vocabulary, defaults to the trip type's default currency) are optional. Use list-trip-types to find available type IDs.",
      inputSchema: {
        name: z.string(),
        tripTypeId: z.string(),
        status: statusOverrideEnum.optional(),
        currencies: z.array(z.string().regex(/^[A-Za-z]{3}$/)).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        capacity: z.number().optional(),
        participantCount: z.number().optional(),
        notes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      name,
      tripTypeId,
      status,
      currencies,
      startDate,
      endDate,
      capacity,
      participantCount,
      notes,
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
        // Seed the currency vocabulary from the trip type's default when the
        // caller doesn't supply one (mirrors the web form).
        const tripCurrencies = currencies?.length
          ? currencies.map((c) => c.toUpperCase())
          : await prisma.tripType
              .findUniqueOrThrow({
                where: { id: tripTypeId },
                select: { defaultCurrency: true },
              })
              .then((tt) => [tt.defaultCurrency]);

        const trip = await prisma.trip.create({
          data: {
            name,
            tripTypeId,
            status: status ?? "ACTIVE",
            currencies: tripCurrencies,
            startDate: parseDateInput(startDate),
            endDate: parseDateInput(endDate),
            capacity,
            participantCount,
            notes,
            createdById: user.id,
          },
        });

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(trip, null, 2) },
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

  // ── update-trip (PLANNER+) ────────────────────────────────────────────
  server.registerTool(
    "update-trip",
    {
      title: "Update Trip",
      description:
        "Update an existing trip's details. Only include fields you want to change. Status is a manual override only (ACTIVE = lifecycle follows the dates; ARCHIVED; CANCELLED) — Planning/In progress/Complete cannot be set directly, they derive from startDate/endDate. Passing currencies REPLACES the trip's currency vocabulary (3-letter codes). Changing startDate (YYYY-MM-DD) recomputes every itinerary day's date and shifts dated stays by the same number of days so lodging stays on the same trip nights.",
      inputSchema: {
        tripId: z.string(),
        name: z.string().optional(),
        status: statusOverrideEnum.optional(),
        currencies: z.array(z.string().regex(/^[A-Za-z]{3}$/)).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        capacity: z.number().optional(),
        participantCount: z.number().optional(),
        notes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      tripId,
      name,
      status,
      currencies,
      startDate,
      endDate,
      capacity,
      participantCount,
      notes,
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

        if (name !== undefined) data.name = name;
        if (status !== undefined) data.status = status;
        if (currencies !== undefined)
          data.currencies = currencies.map((c) => c.toUpperCase());
        if (startDate !== undefined) data.startDate = parseDateInput(startDate);
        if (endDate !== undefined) data.endDate = parseDateInput(endDate);
        if (capacity !== undefined) data.capacity = capacity;
        if (participantCount !== undefined)
          data.participantCount = participantCount;
        if (notes !== undefined) data.notes = notes;

        // Mirror web updateTrip: a startDate change re-derives every day's
        // date and moves dated stays by the same delta, atomically with the
        // trip write. The trip row is locked so a concurrent add/delete-day
        // can't renumber between the read and the recompute.
        const trip = await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "Trip" WHERE "id" = ${tripId} FOR UPDATE`;
          const before = await tx.trip.findUnique({
            where: { id: tripId },
            select: { startDate: true },
          });
          if (!before) throw new Error("Trip not found.");
          const updated = await tx.trip.update({ where: { id: tripId }, data });
          if (startDate !== undefined) {
            await applyStartDateChange(
              tx,
              tripId,
              before.startDate,
              updated.startDate,
            );
          }
          return updated;
        });

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(trip, null, 2) },
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
