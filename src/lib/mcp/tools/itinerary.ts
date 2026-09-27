import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { toDateInput, computeDayDate } from "@/lib/dates";
import { timedInsertIndex } from "@/lib/schedule-order";
import { travelLegCreateData } from "@/lib/travel";
import { TRAVEL_LEG_INCLUDE } from "@/lib/trips";
import { deleteItineraryDay } from "@/lib/trip-mutations";

// A travel span (GH #80) on add/update-schedule-item. Setting it makes the item
// a travel leg: origin → destination by a method, item start/end = depart/arrive.
const travelInputSchema = z.object({
  method: z.enum(["COACH", "TRAIN", "FERRY", "FLIGHT", "WALK", "TAXI", "OTHER"]),
  fromLocationId: z.string().optional(),
  fromLabel: z.string().optional(),
  toLocationId: z.string().optional(),
  toLabel: z.string().optional(),
  stops: z
    .array(
      z.object({
        locationId: z.string().optional(),
        label: z.string().optional(),
        dwellMinutes: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
});

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
        "Get the full day-by-day schedule for a trip. Returns all days with their schedule items, including times, locations, categories, presentations, presenters, and booking statuses. Also returns each day's plannedLocations — the rough-plan venues assigned to the day without timed items (see add-planned-location). This is the most detailed view of a trip's plan.",
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
            primaryLocation: { select: { id: true, name: true } },
            plannedLocations: {
              orderBy: { order: "asc" },
              include: { location: { select: { id: true, name: true } } },
            },
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
                travel: TRAVEL_LEG_INCLUDE,
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
        "Add a new day to a trip's itinerary. The day is appended at the end with the next sequential day number. Its date is automatically computed from the trip's start date. Optionally set primaryLocationId (from search-locations) as the day's default venue for new schedule items.",
      inputSchema: {
        tripId: z.string(),
        title: z.string().optional(),
        primaryLocationId: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ tripId, title, primaryLocationId }) => {
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
            primaryLocationId: primaryLocationId || null,
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
        "Add a timed item to a day's schedule. Requires the dayId (from get-itinerary). Provide a title and/or location IDs. Times use 24-hour HH:MM format. Categories like 'Visit', 'Meal', 'Presentation', 'Free time' can be set via categoryId. For travel between venues, pass `travel` (method + from/to location IDs or free-text labels + optional en-route stops) instead of locationIds — the item becomes a travel SPAN whose startTime/endTime are the depart/arrive times; do NOT create paired 'Depart'/'Arrive' items.",
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
        travel: travelInputSchema.optional(),
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
      travel,
    }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        // Slot the item into its chronological position rather than appending —
        // items are ordered by an explicit `order`, not by time (mirrors the web
        // addScheduleItem action).
        const item = await prisma.$transaction(async (tx) => {
          const items = await tx.scheduleItem.findMany({
            where: { dayId },
            select: { order: true, startTime: true },
          });
          const insertAt = timedInsertIndex(items, startTime);
          await tx.scheduleItem.updateMany({
            where: { dayId, order: { gt: insertAt } },
            data: { order: { increment: 1 } },
          });
          return tx.scheduleItem.create({
            data: {
              dayId,
              order: insertAt + 1,
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
              // A travel item's "where" is its leg — never ScheduleItemSite rows.
              sites:
                !travel && locationIds?.length
                  ? {
                      create: locationIds.map((locationId, i) => ({
                        locationId,
                        order: i,
                      })),
                    }
                  : undefined,
              travel: travel
                ? { create: travelLegCreateData(travel) }
                : undefined,
            },
          });
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
        "Update a schedule item's title, times, locations, category, notes, or travel leg. Only include fields you want to change. Use get-itinerary to find item IDs. `travel` REPLACES the whole leg (method + endpoints + stops); pass travel: null to turn a travel item back into an ordinary one.",
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
        travel: travelInputSchema.nullable().optional(),
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
      travel,
    }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const existing = await prisma.scheduleItem.findUnique({
          where: { id: itemId },
          select: {
            title: true,
            travel: { select: { id: true } },
            _count: { select: { sites: true } },
          },
        });
        if (!existing) {
          return {
            content: [{ type: "text" as const, text: "Error: Item not found." }],
            isError: true,
          };
        }

        // The item must stay identifiable: removing the leg (travel: null)
        // needs a title or locations to remain.
        const finalTitle = title !== undefined ? title || null : existing.title;
        const finalHasSites =
          locationIds !== undefined
            ? locationIds.length > 0
            : existing._count.sites > 0;
        if (travel === null && !finalTitle && !finalHasSites) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Removing the travel leg would leave the item with no title, locations, or route — set a title or locationIds in the same call.",
              },
            ],
            isError: true,
          };
        }

        // An existing leg the input leaves untouched wins over stray
        // locationIds — a travel item's "where" is its leg (mirrors the web
        // action's effectiveLocationIds).
        const isTravel = travel !== undefined ? !!travel : !!existing.travel;

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
          // Travel leg: an object replaces it wholesale, null removes it,
          // undefined leaves an existing leg untouched. Setting a leg also
          // clears the site links (a travel item's "where" is its leg).
          if (travel !== undefined) {
            await tx.travelLeg.deleteMany({ where: { scheduleItemId: itemId } });
            if (travel) {
              await tx.travelLeg.create({
                data: { scheduleItemId: itemId, ...travelLegCreateData(travel) },
              });
              await tx.scheduleItemSite.deleteMany({
                where: { scheduleItemId: itemId },
              });
            }
          }

          if (locationIds !== undefined && !isTravel) {
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
              // Null any item-targeted booking whose locationId is not in the new set
              await tx.booking.updateMany({
                where: {
                  scheduleItemId: itemId,
                  locationId: { notIn: locationIds },
                },
                data: { locationId: null },
              });
            } else {
              // No locations: null all item-targeted bookings' locationId
              await tx.booking.updateMany({
                where: { scheduleItemId: itemId },
                data: { locationId: null },
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
        "Update a day's title, notes, and primary location. logisticalNotes are staff-only (hidden on participant/host-site shares); participantNotes are participant-facing free text. primaryLocationId sets the day's default venue (get its id from search-locations); pass an empty string to clear it. Only include fields you want to change. Use get-itinerary to find the day id. (Day dates are derived from the trip start date and cannot be set directly.)",
      inputSchema: {
        dayId: z.string(),
        title: z.string().optional(),
        logisticalNotes: z.string().optional(),
        participantNotes: z.string().optional(),
        primaryLocationId: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dayId, title, logisticalNotes, participantNotes, primaryLocationId }) => {
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
        if (primaryLocationId !== undefined)
          data.primaryLocationId = primaryLocationId || null;

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
        "Delete a day from a trip's itinerary. This also deletes the day's schedule items. Remaining days are renumbered and their dates recomputed, and stays after the deleted day shift back by one night to follow them. A stay that covered ONLY the deleted night is left untouched and counted in the result's collapsedStays (with a warning) so you can fix it via update-stay. Use get-itinerary to find the day id.",
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

        // Locks the trip row and reads the day inside the txn, renumbers +
        // redates the rest, and pulls stays along (shared with web deleteDay).
        const res = await deleteItineraryDay(dayId);
        if ("error" in res) {
          return {
            content: [{ type: "text" as const, text: `Error: ${res.error}` }],
            isError: true,
          };
        }
        const collapsed = res.collapsedStays;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  id: dayId,
                  collapsedStays: collapsed,
                  ...(collapsed
                    ? {
                        warning: `${collapsed} stay${collapsed === 1 ? "" : "s"} covered only the deleted night and ${collapsed === 1 ? "was" : "were"} left unchanged — review with list-stays.`,
                      }
                    : {}),
                },
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

  // ── add-planned-location (PLANNER+) ───────────────────────────────────
  server.registerTool(
    "add-planned-location",
    {
      title: "Add Planned Location",
      description:
        "Assign a location to a day as a ROUGH plan (GH #9) — 'we'll be in this city seeing this venue' — WITHOUT committing to a timed schedule item. Idempotent per (day, location): re-adding updates the note. Get dayId from get-itinerary and locationId from search-locations. Use this for early, coarse planning; promote-planned-location turns it into a real schedule item later.",
      inputSchema: {
        dayId: z.string(),
        locationId: z.string(),
        note: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dayId, locationId, note }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const count = await prisma.itineraryDayLocation.count({
          where: { dayId },
        });
        const row = await prisma.itineraryDayLocation.upsert({
          where: { dayId_locationId: { dayId, locationId } },
          update: { note: note || null },
          create: { dayId, locationId, note: note || null, order: count },
        });

        return {
          content: [
            { type: "text", text: JSON.stringify(row, null, 2) },
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

  // ── remove-planned-location (PLANNER+) ────────────────────────────────
  server.registerTool(
    "remove-planned-location",
    {
      title: "Remove Planned Location",
      description:
        "Remove a rough-plan location assignment (GH #9) from a day. Identified by the (dayId, locationId) pair — the same values passed to add-planned-location; find them via get-itinerary. Does NOT touch any timed schedule items at that location.",
      inputSchema: { dayId: z.string(), locationId: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ dayId, locationId }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const existing = await prisma.itineraryDayLocation.findUnique({
          where: { dayId_locationId: { dayId, locationId } },
          select: { id: true },
        });
        if (!existing) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No such planned location for this day",
              },
            ],
            isError: true,
          };
        }

        await prisma.itineraryDayLocation.delete({
          where: { id: existing.id },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, dayId, locationId }, null, 2),
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

  // ── promote-planned-location (PLANNER+) ───────────────────────────────
  server.registerTool(
    "promote-planned-location",
    {
      title: "Promote Planned Location",
      description:
        "Turn a rough-plan location assignment (GH #9) into a real, time-less schedule item at the end of the day, then remove the rough assignment. The location identifies the new item (no title/times needed); any note carries over to the item's notes. Identified by the (dayId, locationId) pair — find them via get-itinerary. Set times afterward with update-schedule-item.",
      inputSchema: { dayId: z.string(), locationId: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ dayId, locationId }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Not authorized" }],
            isError: true,
          };
        }

        const planned = await prisma.itineraryDayLocation.findUnique({
          where: { dayId_locationId: { dayId, locationId } },
          select: { id: true, note: true },
        });
        if (!planned) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: No such planned location for this day",
              },
            ],
            isError: true,
          };
        }

        const item = await prisma.$transaction(async (tx) => {
          const count = await tx.scheduleItem.count({ where: { dayId } });
          const created = await tx.scheduleItem.create({
            data: {
              dayId,
              order: count + 1,
              notes: planned.note || null,
              sites: { create: [{ locationId, order: 0 }] },
            },
          });
          await tx.itineraryDayLocation.delete({ where: { id: planned.id } });
          return created;
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, scheduleItemId: item.id }, null, 2),
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
