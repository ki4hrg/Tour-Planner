import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { todayUtc, parseDateInput } from "@/lib/dates";
import { resolveSchedule, serializeInstallment } from "@/lib/payment-schedule";
import { paymentScheduleSchema, installmentRows } from "@/lib/validators/booking";
import { zodErrorMessage } from "@/lib/forms";

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
            payments: { select: { amount: true } },
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
            payments: { select: { amount: true } },
          },
        });

        // Agreed price + running payment total (details via list-payments).
        const money = (b: {
          agreedAmount: unknown;
          agreedCurrency: string;
          payments: { amount: unknown }[];
        }) => {
          const agreedAmount =
            b.agreedAmount == null ? null : Number(b.agreedAmount);
          const paidTotal = b.payments.reduce(
            (sum, p) => sum + Number(p.amount),
            0,
          );
          return {
            agreedAmount,
            agreedCurrency: b.agreedCurrency,
            paidTotal,
            settled: agreedAmount != null && paidTotal >= agreedAmount,
          };
        };

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
            ...money(b),
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
            ...money(b),
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
        "Create a booking. Provide EITHER tripId + locationId (a venue engagement covering every schedule item in the trip that visits that location, plus lodging there — idempotent: re-adding the same venue updates it) OR scheduleItemId (a site-less reservation like a coach, tied to one item). Status options (workflow order): NOT_BOOKED, REQUESTED, TENTATIVELY_CONFIRMED, CONFIRMED, FINALIZED (or NOT_NEEDED to skip). bookedOn (YYYY-MM-DD) is the date the engagement was booked — it anchors BOOKING-relative payment installments. agreedAmount/agreedCurrency/agreedUnit record the negotiated price for the engagement (the location's cost catalog is the asking price); log actual payments with add-payment.",
      inputSchema: {
        tripId: z.string().optional(),
        scheduleItemId: z.string().optional(),
        locationId: z.string().optional(),
        label: z.string().optional(),
        status: z.string(),
        bookedContactId: z.string().optional(),
        confirmationRef: z.string().optional(),
        notes: z.string().optional(),
        bookedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        agreedAmount: z.number().nonnegative().optional(),
        agreedCurrency: z.string().optional(),
        agreedUnit: z.enum(["PER_PERSON", "PER_GROUP"]).optional(),
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
      bookedOn,
      agreedAmount,
      agreedCurrency,
      agreedUnit,
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
          bookedOn: bookedOn ? parseDateInput(bookedOn) : null,
          agreedAmount: agreedAmount ?? null,
          agreedCurrency: agreedCurrency || "USD",
          agreedUnit: agreedUnit ?? null,
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
        "Update a booking's status, contact, confirmation reference, notes, booked-on date, or agreed price (agreedAmount/agreedCurrency/agreedUnit — the negotiated engagement price; pass agreedAmount: 0 to keep, omit to leave unchanged). bookedOn (YYYY-MM-DD) is the date the engagement was booked — it anchors BOOKING-relative payment installments. Common use: mark a booking as CONFIRMED with a confirmation reference number. Status options (workflow order): NOT_BOOKED, REQUESTED, TENTATIVELY_CONFIRMED, CONFIRMED, FINALIZED (or NOT_NEEDED to skip).",
      inputSchema: {
        bookingId: z.string(),
        status: z.string().optional(),
        bookedContactId: z.string().optional(),
        confirmationRef: z.string().optional(),
        notes: z.string().optional(),
        bookedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        agreedAmount: z.number().nonnegative().optional(),
        agreedCurrency: z.string().optional(),
        agreedUnit: z.enum(["PER_PERSON", "PER_GROUP"]).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      bookingId,
      status,
      bookedContactId,
      confirmationRef,
      notes,
      bookedOn,
      agreedAmount,
      agreedCurrency,
      agreedUnit,
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

        const data: Record<string, unknown> = {};
        if (status !== undefined) data.status = status as BookingStatus;
        if (bookedContactId !== undefined)
          data.bookedContactId = bookedContactId;
        if (confirmationRef !== undefined)
          data.confirmationRef = confirmationRef;
        if (notes !== undefined) data.notes = notes;
        if (bookedOn !== undefined) data.bookedOn = parseDateInput(bookedOn);
        if (agreedAmount !== undefined) data.agreedAmount = agreedAmount;
        if (agreedCurrency !== undefined) data.agreedCurrency = agreedCurrency;
        if (agreedUnit !== undefined) data.agreedUnit = agreedUnit;

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

  // ── list-payments (VIEWER+) ──────────────────────────────────────────
  server.registerTool(
    "list-payments",
    {
      title: "List Payments",
      description:
        "List the payments logged against a booking (get bookingId from list-bookings), with the booking's agreed price, the outstanding balance, and its payment schedule: installments (percentage of the agreed price or a fixed amount) due a number of days before trip start, each resolved to an amount, due date, and paid/overdue/upcoming state. A booking is settled when payments cover the agreed amount. Set the schedule with set-payment-schedule.",
      inputSchema: {
        bookingId: z.string(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ bookingId }) => {
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

        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: {
            agreedAmount: true,
            agreedCurrency: true,
            agreedUnit: true,
            bookedOn: true,
            createdAt: true,
            payments: { orderBy: { paidOn: "asc" } },
            paymentSchedule: true,
            // Trip start anchors the schedule's due dates, whichever way the
            // booking hangs off the trip.
            trip: { select: { startDate: true } },
            scheduleItem: {
              select: {
                day: { select: { trip: { select: { startDate: true } } } },
              },
            },
          },
        });
        if (!booking) {
          return {
            content: [{ type: "text" as const, text: "Error: Booking not found." }],
            isError: true,
          };
        }

        const agreedAmount =
          booking.agreedAmount == null ? null : Number(booking.agreedAmount);
        const payments = booking.payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount),
          currency: p.currency,
          paidOn: p.paidOn.toISOString().slice(0, 10),
          method: p.method,
          note: p.note,
        }));
        const paidTotal = payments.reduce((sum, p) => sum + p.amount, 0);

        const tripStartDate =
          booking.trip?.startDate ??
          booking.scheduleItem?.day.trip.startDate ??
          null;
        const schedule = resolveSchedule(
          booking.paymentSchedule.map(serializeInstallment),
          {
            agreedAmount,
            paidTotal,
            tripStartDate,
            bookingDate: booking.bookedOn ?? booking.createdAt,
            today: todayUtc(),
          },
        );

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  agreedAmount,
                  agreedCurrency: booking.agreedCurrency,
                  agreedUnit: booking.agreedUnit,
                  paidTotal,
                  unpaidBalance:
                    agreedAmount == null
                      ? null
                      : Math.max(0, agreedAmount - paidTotal),
                  settled: agreedAmount != null && paidTotal >= agreedAmount,
                  payments,
                  paymentSchedule: schedule,
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
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── set-payment-schedule (PLANNER+) ──────────────────────────────────
  server.registerTool(
    "set-payment-schedule",
    {
      title: "Set Payment Schedule",
      description:
        "REPLACE a booking's payment schedule (get bookingId from list-bookings) with the given installments — pass an empty list to clear it. Each installment has EITHER percent (of the booking's agreed price) OR fixedAmount (in its agreed currency), plus an optional label like 'Deposit'. The due date is set by anchor: 'EVENT_START' (default) → offsetValue offsetUnits BEFORE trip start (offsetValue negative = after start); 'BOOKING' → offsetValue offsetUnits AFTER the booking's booked-on date; 'NONE' → no deadline (omit offsetValue/offsetUnit; never overdue). offsetUnit is 'DAY', 'WEEK', or 'MONTH'. Examples: 20% EVENT_START 180 DAY (180 days before start); a fixed 500 BOOKING 0 DAY (due on the booking date); a NONE deposit owed with no fixed deadline. See list-payments for resolved due dates and paid/overdue state.",
      inputSchema: {
        bookingId: z.string(),
        installments: z.array(
          z.object({
            label: z.string().optional(),
            percent: z.number().positive().max(100).optional(),
            fixedAmount: z.number().positive().optional(),
            anchor: z.enum(["EVENT_START", "BOOKING", "NONE"]).optional(),
            offsetValue: z.number().int().optional(),
            offsetUnit: z.enum(["DAY", "WEEK", "MONTH"]).optional(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ bookingId, installments }) => {
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

        // Same validator the web action uses — one home for the
        // exactly-one-of-percent/fixedAmount rule.
        const parsed = paymentScheduleSchema.safeParse({ installments });
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${zodErrorMessage(parsed.error)}`,
              },
            ],
            isError: true,
          };
        }

        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { id: true },
        });
        if (!booking) {
          return {
            content: [{ type: "text" as const, text: "Error: Booking not found." }],
            isError: true,
          };
        }

        await prisma.$transaction([
          prisma.paymentScheduleItem.deleteMany({ where: { bookingId } }),
          prisma.paymentScheduleItem.createMany({
            data: installmentRows(parsed.data.installments).map((r) => ({
              bookingId,
              ...r,
            })),
          }),
        ]);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, installments: installments.length },
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
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ── add-payment (PLANNER+) ───────────────────────────────────────────
  server.registerTool(
    "add-payment",
    {
      title: "Add Payment",
      description:
        "Log a payment against a booking (get bookingId from list-bookings). amount is a positive number, paidOn is yyyy-mm-dd; method (e.g. 'bank transfer') and note are optional. Payments count toward the booking's agreed price — see list-payments for the running balance.",
      inputSchema: {
        bookingId: z.string(),
        amount: z.number().positive(),
        currency: z.string().optional(),
        paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        method: z.string().optional(),
        note: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ bookingId, amount, currency, paidOn, method, note }) => {
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

        const booking = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { agreedCurrency: true },
        });
        if (!booking) {
          return {
            content: [{ type: "text" as const, text: "Error: Booking not found." }],
            isError: true,
          };
        }

        const payment = await prisma.payment.create({
          data: {
            bookingId,
            amount,
            currency: currency || booking.agreedCurrency,
            paidOn: new Date(`${paidOn}T00:00:00.000Z`),
            method: method || null,
            note: note || null,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: payment.id }, null, 2),
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
