import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";

export function registerBookingTools(server: McpServer, user: SessionUser) {
  // ── list-bookings (VIEWER+) ──────────────────────────────────────────
  server.registerTool(
    "list-bookings",
    {
      title: "List Bookings",
      description:
        "List all bookings for a trip. A 'venue' booking is one engagement with a location that covers every schedule item visiting that location plus any lodging there. A 'schedule_item' booking is a site-less reservation (e.g. a coach) tied to one item. Shows status, location, contact, confirmation reference. Useful for checking which reservations still need attention.",
      inputSchema: {
        tripId: z.string(),
        status: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ tripId, status }) => {
      try {
        if (!hasRole(user.role, "VIEWER")) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Insufficient permissions. VIEWER role or higher required.",
              },
            ],
            isError: true,
          };
        }

        const engagementBookings = await prisma.booking.findMany({
          where: {
            tripId,
            ...(status ? { status: status as BookingStatus } : {}),
          },
          include: {
            location: { select: { id: true, name: true } },
            bookedContact: { select: { id: true, name: true } },
          },
        });

        const itemBookings = await prisma.booking.findMany({
          where: {
            scheduleItem: { day: { tripId } },
            ...(status ? { status: status as BookingStatus } : {}),
          },
          include: {
            scheduleItem: {
              select: {
                title: true,
                day: { select: { dayIndex: true, title: true } },
              },
            },
            location: { select: { id: true, name: true } },
            bookedContact: { select: { id: true, name: true } },
          },
        });

        const bookings = [
          ...engagementBookings.map((b) => ({
            type: "venue" as const,
            id: b.id,
            label: b.label,
            status: b.status,
            confirmationRef: b.confirmationRef,
            notes: b.notes,
            location: b.location,
            bookedContact: b.bookedContact,
          })),
          ...itemBookings.map((b) => ({
            type: "schedule_item" as const,
            id: b.id,
            label: b.label,
            status: b.status,
            confirmationRef: b.confirmationRef,
            notes: b.notes,
            scheduleItem: b.scheduleItem
              ? {
                  title: b.scheduleItem.title,
                  dayIndex: b.scheduleItem.day.dayIndex,
                  dayTitle: b.scheduleItem.day.title,
                }
              : null,
            location: b.location,
            bookedContact: b.bookedContact,
          })),
        ];

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(bookings, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── add-booking (PLANNER+) ───────────────────────────────────────────
  server.registerTool(
    "add-booking",
    {
      title: "Add Booking",
      description:
        "Create a booking. Provide EITHER tripId + locationId (a venue engagement covering every schedule item in the trip that visits that location, plus lodging there — idempotent: re-adding the same venue updates it) OR scheduleItemId (a site-less reservation like a coach, tied to one item). Status options: NOT_BOOKED, REQUESTED, CONFIRMED.",
      inputSchema: {
        tripId: z.string().optional(),
        scheduleItemId: z.string().optional(),
        locationId: z.string().optional(),
        label: z.string().optional(),
        status: z.string(),
        bookedContactId: z.string().optional(),
        confirmationRef: z.string().optional(),
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
      scheduleItemId,
      locationId,
      label,
      status,
      bookedContactId,
      confirmationRef,
      notes,
    }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Insufficient permissions. PLANNER role or higher required.",
              },
            ],
            isError: true,
          };
        }

        const isVenue = !!tripId;
        const isItem = !!scheduleItemId;
        if (isVenue === isItem) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Provide exactly one of (tripId + locationId) or scheduleItemId.",
              },
            ],
            isError: true,
          };
        }
        if (isVenue && !locationId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: A venue booking requires both tripId and locationId.",
              },
            ],
            isError: true,
          };
        }

        const scalars = {
          locationId: locationId || null,
          label: label || null,
          status: status as BookingStatus,
          bookedContactId: bookedContactId || null,
          confirmationRef: confirmationRef || null,
          notes: notes || null,
        };
        const booking = isVenue
          ? await prisma.booking.upsert({
              where: {
                tripId_locationId: { tripId: tripId!, locationId: locationId! },
              },
              create: { tripId, ...scalars },
              update: scalars,
            })
          : await prisma.booking.create({
              data: { scheduleItemId, ...scalars },
            });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: booking.id }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── update-booking (PLANNER+) ────────────────────────────────────────
  server.registerTool(
    "update-booking",
    {
      title: "Update Booking",
      description:
        "Update a booking's status, contact, confirmation reference, or notes. Common use: mark a booking as CONFIRMED with a confirmation reference number. Status options: NOT_BOOKED, REQUESTED, CONFIRMED.",
      inputSchema: {
        bookingId: z.string(),
        status: z.string().optional(),
        bookedContactId: z.string().optional(),
        confirmationRef: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ bookingId, status, bookedContactId, confirmationRef, notes }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Insufficient permissions. PLANNER role or higher required.",
              },
            ],
            isError: true,
          };
        }

        const data: Record<string, unknown> = {};
        if (status !== undefined) data.status = status as BookingStatus;
        if (bookedContactId !== undefined)
          data.bookedContactId = bookedContactId;
        if (confirmationRef !== undefined)
          data.confirmationRef = confirmationRef;
        if (notes !== undefined) data.notes = notes;

        const booking = await prisma.booking.update({
          where: { id: bookingId },
          data,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, id: booking.id }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
