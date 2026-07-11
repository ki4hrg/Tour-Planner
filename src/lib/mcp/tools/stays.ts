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
        "List all lodging stays for a trip, showing location, check-in/out anchors, headcount, cost per person per night, and booking status. A dated trip's stays carry calendar dates (checkIn/checkOut); a date-less template's stays carry 1-based day numbers (checkInDayIndex/checkOutDayIndex) instead — exactly one pair is set. Stays can overlap — higher priority wins for resolving which location the group sleeps at on a given night.",
      inputSchema: {
        tripId: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tripId }) => {
      const stays = await prisma.stay.findMany({
        where: { tripId },
        orderBy: [{ checkIn: "asc" }, { checkInDayIndex: "asc" }],
        include: {
          location: { select: { id: true, name: true } },
        },
      });

      const serialized = stays.map((s) => ({
        id: s.id,
        location: s.location,
        checkIn: s.checkIn ? toDateInput(s.checkIn) : null,
        checkOut: s.checkOut ? toDateInput(s.checkOut) : null,
        checkInDayIndex: s.checkInDayIndex,
        checkOutDayIndex: s.checkOutDayIndex,
        arrivalTime: s.arrivalTime,
        departureTime: s.departureTime,
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
        "Add a lodging stay to a trip. Requires a location ID (use search-locations with hostSitesOnly to find lodging venues). For a DATED trip, pass check-in/check-out dates (YYYY-MM-DD). For a date-less TEMPLATE (get-trip shows isTemplate), pass day numbers instead: checkInDayIndex/checkOutDayIndex (1-based; check-out is the departure morning, so it may be one past the last day). Provide exactly one anchor mode matching the trip. Stays can overlap — set priority > 0 for excursion stays that override the base lodging.",
      inputSchema: {
        tripId: z.string(),
        locationId: z.string(),
        checkIn: z.string().optional(),
        checkOut: z.string().optional(),
        checkInDayIndex: z.number().int().positive().optional(),
        checkOutDayIndex: z.number().int().positive().optional(),
        arrivalTime: z.string().optional(),
        departureTime: z.string().optional(),
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
      checkInDayIndex,
      checkOutDayIndex,
      arrivalTime,
      departureTime,
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

      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        select: { isTemplate: true },
      });
      if (!trip) {
        return {
          content: [{ type: "text" as const, text: "Error: Trip not found." }],
          isError: true,
        };
      }

      // Resolve the anchor from the trip's mode: templates take day numbers,
      // dated trips take calendar dates (mirrors the web action + DB CHECK).
      let anchor: {
        checkIn: Date | null;
        checkOut: Date | null;
        checkInDayIndex: number | null;
        checkOutDayIndex: number | null;
      };
      if (trip.isTemplate) {
        if (checkInDayIndex == null || checkOutDayIndex == null) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: This is a template — pass checkInDayIndex and checkOutDayIndex (day numbers), not dates.",
              },
            ],
            isError: true,
          };
        }
        if (checkOutDayIndex <= checkInDayIndex) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Check-out day must be after check-in day.",
              },
            ],
            isError: true,
          };
        }
        anchor = {
          checkIn: null,
          checkOut: null,
          checkInDayIndex,
          checkOutDayIndex,
        };
      } else {
        if (!checkIn || !checkOut) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: This trip has dates — pass checkIn and checkOut (YYYY-MM-DD).",
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
        anchor = {
          checkIn: checkInDate,
          checkOut: checkOutDate,
          checkInDayIndex: null,
          checkOutDayIndex: null,
        };
      }

      const stay = await prisma.stay.create({
        data: {
          tripId,
          locationId,
          ...anchor,
          arrivalTime: arrivalTime || null,
          departureTime: departureTime || null,
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
        "Update a stay's details. Only include fields you want to change. Use list-stays to find stay IDs. To change the anchor, pass BOTH endpoints of one mode: checkIn+checkOut (YYYY-MM-DD, dated trips) or checkInDayIndex+checkOutDayIndex (1-based day numbers, templates) — a stay must match its trip's mode.",
      inputSchema: {
        stayId: z.string(),
        locationId: z.string().optional(),
        checkIn: z.string().optional(),
        checkOut: z.string().optional(),
        checkInDayIndex: z.number().int().positive().optional(),
        checkOutDayIndex: z.number().int().positive().optional(),
        arrivalTime: z.string().optional(),
        departureTime: z.string().optional(),
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
      checkInDayIndex,
      checkOutDayIndex,
      arrivalTime,
      departureTime,
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

      const wantsDates = checkIn !== undefined || checkOut !== undefined;
      const wantsIndices =
        checkInDayIndex !== undefined || checkOutDayIndex !== undefined;
      if (wantsDates && wantsIndices) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: Use either calendar dates or day numbers, not both.",
            },
          ],
          isError: true,
        };
      }
      if (wantsDates) {
        // Setting dates → clear any day-index anchor (exactly one mode holds).
        if (checkIn === undefined || checkOut === undefined) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Pass both checkIn and checkOut to change the dates.",
              },
            ],
            isError: true,
          };
        }
        const ci = parseDateInput(checkIn);
        const co = parseDateInput(checkOut);
        if (!ci || !co) {
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
        if (co <= ci) {
          return {
            content: [
              { type: "text" as const, text: "Error: Check-out must be after check-in." },
            ],
            isError: true,
          };
        }
        data.checkIn = ci;
        data.checkOut = co;
        data.checkInDayIndex = null;
        data.checkOutDayIndex = null;
      }
      if (wantsIndices) {
        // Setting day numbers → clear any date anchor.
        if (checkInDayIndex === undefined || checkOutDayIndex === undefined) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Pass both checkInDayIndex and checkOutDayIndex to change the day numbers.",
              },
            ],
            isError: true,
          };
        }
        if (checkOutDayIndex <= checkInDayIndex) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Check-out day must be after check-in day.",
              },
            ],
            isError: true,
          };
        }
        data.checkInDayIndex = checkInDayIndex;
        data.checkOutDayIndex = checkOutDayIndex;
        data.checkIn = null;
        data.checkOut = null;
      }
      if (arrivalTime !== undefined) data.arrivalTime = arrivalTime || null;
      if (departureTime !== undefined)
        data.departureTime = departureTime || null;
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
