import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { toDateInput, parseDateInput } from "@/lib/dates";

export function registerStayTools(server: McpServer, user: SessionUser) {
  server.registerTool(
    "list-stays",
    {
      title: "List Stays",
      description:
        "List all lodging stays for a trip, showing location, check-in/out dates, board type, headcount, cost per person per night, and booking status. Stays can overlap — higher priority wins for resolving which location the group sleeps at on a given night.",
      inputSchema: {
        tripId: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tripId }) => {
      const stays = await prisma.stay.findMany({
        where: { tripId },
        orderBy: { checkIn: "asc" },
        include: {
          location: { select: { id: true, name: true } },
        },
      });

      const serialized = stays.map((s) => ({
        id: s.id,
        location: s.location,
        label: s.label,
        checkIn: toDateInput(s.checkIn),
        checkOut: toDateInput(s.checkOut),
        arrivalTime: s.arrivalTime,
        departureTime: s.departureTime,
        board: s.board,
        headcount: s.headcount,
        costPerPersonPerNight:
          s.costPerPersonPerNight != null
            ? Number(s.costPerPersonPerNight)
            : null,
        currency: s.currency,
        priority: s.priority,
        notes: s.notes,
        // Lodging booking state lives on the venue engagement — see list-bookings.
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(serialized, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "add-stay",
    {
      title: "Add Stay",
      description:
        "Add a lodging stay to a trip. Requires a location ID (use search-locations with hostSitesOnly to find lodging venues) and check-in/check-out dates (YYYY-MM-DD format). Board types: NONE (default), BED_AND_BREAKFAST, HALF_BOARD, FULL_BOARD. Stays can overlap — set priority > 0 for excursion stays that override the base lodging.",
      inputSchema: {
        tripId: z.string(),
        locationId: z.string(),
        checkIn: z.string(),
        checkOut: z.string(),
        label: z.string().optional(),
        arrivalTime: z.string().optional(),
        departureTime: z.string().optional(),
        board: z.string().optional(),
        headcount: z.number().optional(),
        costPerPersonPerNight: z.number().optional(),
        currency: z.string().optional(),
        priority: z.number().optional(),
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
      tripId,
      locationId,
      checkIn,
      checkOut,
      label,
      arrivalTime,
      departureTime,
      board,
      headcount,
      costPerPersonPerNight,
      currency,
      priority,
      notes,
    }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Requires PLANNER role or above.",
            },
          ],
          isError: true,
        };
      }

      if (checkOut <= checkIn) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Check-out must be after check-in.",
            },
          ],
          isError: true,
        };
      }

      const checkInDate = parseDateInput(checkIn);
      const checkOutDate = parseDateInput(checkOut);
      if (!checkInDate || !checkOutDate) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Invalid date format. Use YYYY-MM-DD.",
            },
          ],
          isError: true,
        };
      }

      const stay = await prisma.stay.create({
        data: {
          tripId,
          locationId,
          label: label || null,
          checkIn: checkInDate,
          checkOut: checkOutDate,
          arrivalTime: arrivalTime || null,
          departureTime: departureTime || null,
          board:
            (board as
              | "NONE"
              | "BED_AND_BREAKFAST"
              | "HALF_BOARD"
              | "FULL_BOARD") || "NONE",
          headcount: headcount ?? null,
          costPerPersonPerNight: costPerPersonPerNight ?? null,
          currency: currency || "USD",
          priority: priority ?? 0,
          notes: notes || null,
        },
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { id: stay.id, message: "Stay added." },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "update-stay",
    {
      title: "Update Stay",
      description:
        "Update a stay's details. Only include fields you want to change. Use list-stays to find stay IDs. Dates use YYYY-MM-DD format. Board types: NONE, BED_AND_BREAKFAST, HALF_BOARD, FULL_BOARD.",
      inputSchema: {
        stayId: z.string(),
        locationId: z.string().optional(),
        checkIn: z.string().optional(),
        checkOut: z.string().optional(),
        label: z.string().optional(),
        arrivalTime: z.string().optional(),
        departureTime: z.string().optional(),
        board: z.string().optional(),
        headcount: z.number().optional(),
        costPerPersonPerNight: z.number().optional(),
        currency: z.string().optional(),
        priority: z.number().optional(),
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
      stayId,
      locationId,
      checkIn,
      checkOut,
      label,
      arrivalTime,
      departureTime,
      board,
      headcount,
      costPerPersonPerNight,
      currency,
      priority,
      notes,
    }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Requires PLANNER role or above.",
            },
          ],
          isError: true,
        };
      }

      const data: Record<string, unknown> = {};
      if (locationId !== undefined) data.locationId = locationId;
      if (checkIn !== undefined) {
        const d = parseDateInput(checkIn);
        if (!d) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Invalid checkIn format. Use YYYY-MM-DD.",
              },
            ],
            isError: true,
          };
        }
        data.checkIn = d;
      }
      if (checkOut !== undefined) {
        const d = parseDateInput(checkOut);
        if (!d) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Invalid checkOut format. Use YYYY-MM-DD.",
              },
            ],
            isError: true,
          };
        }
        data.checkOut = d;
      }
      if (label !== undefined) data.label = label || null;
      if (arrivalTime !== undefined) data.arrivalTime = arrivalTime || null;
      if (departureTime !== undefined)
        data.departureTime = departureTime || null;
      if (board !== undefined) data.board = board;
      if (headcount !== undefined) data.headcount = headcount;
      if (costPerPersonPerNight !== undefined)
        data.costPerPersonPerNight = costPerPersonPerNight;
      if (currency !== undefined) data.currency = currency;
      if (priority !== undefined) data.priority = priority;
      if (notes !== undefined) data.notes = notes || null;

      try {
        await prisma.stay.update({ where: { id: stayId }, data });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ message: "Stay updated." }),
            },
          ],
        };
      } catch {
        return {
          content: [{ type: "text" as const, text: "Error: Stay not found." }],
          isError: true,
        };
      }
    },
  );
}
