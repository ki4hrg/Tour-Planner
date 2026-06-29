import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";

export function registerBookingTools(server: McpServer, user: SessionUser) {
  // ── list-bookings (VIEWER+) ──────────────────────────────────────────
  server.tool(
    "list-bookings",
    "List all bookings for a trip, including both schedule item bookings and stay bookings. Shows booking status, location, contact, confirmation reference, and which schedule item or stay each booking belongs to. Useful for checking which reservations still need attention.",
    {
      tripId: z.string(),
      status: z.string().optional(),
    },
    async ({ tripId, status }) => {
      try {
        if (!hasRole(user.role, "VIEWER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Insufficient permissions. VIEWER role or higher required." }],
            isError: true,
          };
        }

        const itemBookings = await prisma.booking.findMany({
          where: {
            scheduleItem: { day: { tripId } },
            ...(status ? { status: status as any } : {}),
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

        const stayBookings = await prisma.booking.findMany({
          where: {
            stay: { tripId },
            ...(status ? { status: status as any } : {}),
          },
          include: {
            stay: {
              select: {
                label: true,
                location: { select: { id: true, name: true } },
              },
            },
            location: { select: { id: true, name: true } },
            bookedContact: { select: { id: true, name: true } },
          },
        });

        const bookings = [
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
          ...stayBookings.map((b) => ({
            type: "stay" as const,
            id: b.id,
            label: b.label,
            status: b.status,
            confirmationRef: b.confirmationRef,
            notes: b.notes,
            stay: b.stay
              ? {
                  label: b.stay.label,
                  location: b.stay.location,
                }
              : null,
            location: b.location,
            bookedContact: b.bookedContact,
          })),
        ];

        return {
          content: [{ type: "text" as const, text: JSON.stringify(bookings, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ── add-booking (PLANNER+) ───────────────────────────────────────────
  server.tool(
    "add-booking",
    "Create a booking for a schedule item or stay. A booking tracks whether a venue or service has been reserved. Exactly one of scheduleItemId or stayId must be provided. Status options: NOT_BOOKED, REQUESTED, CONFIRMED.",
    {
      scheduleItemId: z.string().optional(),
      stayId: z.string().optional(),
      locationId: z.string().optional(),
      label: z.string().optional(),
      status: z.string(),
      bookedContactId: z.string().optional(),
      confirmationRef: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({ scheduleItemId, stayId, locationId, label, status, bookedContactId, confirmationRef, notes }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Insufficient permissions. PLANNER role or higher required." }],
            isError: true,
          };
        }

        const hasScheduleItem = !!scheduleItemId;
        const hasStay = !!stayId;
        if (hasScheduleItem === hasStay) {
          return {
            content: [{ type: "text" as const, text: "Error: Exactly one of scheduleItemId or stayId must be provided." }],
            isError: true,
          };
        }

        const booking = await prisma.booking.create({
          data: {
            scheduleItemId: scheduleItemId || null,
            stayId: stayId || null,
            locationId: locationId || null,
            label: label || null,
            status: status as any,
            bookedContactId: bookedContactId || null,
            confirmationRef: confirmationRef || null,
            notes: notes || null,
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id: booking.id }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  // ── update-booking (PLANNER+) ────────────────────────────────────────
  server.tool(
    "update-booking",
    "Update a booking's status, contact, confirmation reference, or notes. Common use: mark a booking as CONFIRMED with a confirmation reference number. Status options: NOT_BOOKED, REQUESTED, CONFIRMED.",
    {
      bookingId: z.string(),
      status: z.string().optional(),
      bookedContactId: z.string().optional(),
      confirmationRef: z.string().optional(),
      notes: z.string().optional(),
    },
    async ({ bookingId, status, bookedContactId, confirmationRef, notes }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return {
            content: [{ type: "text" as const, text: "Error: Insufficient permissions. PLANNER role or higher required." }],
            isError: true,
          };
        }

        const data: Record<string, unknown> = {};
        if (status !== undefined) data.status = status as any;
        if (bookedContactId !== undefined) data.bookedContactId = bookedContactId;
        if (confirmationRef !== undefined) data.confirmationRef = confirmationRef;
        if (notes !== undefined) data.notes = notes;

        const booking = await prisma.booking.update({
          where: { id: bookingId },
          data,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true, id: booking.id }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
