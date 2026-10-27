import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BookingStatus } from "@prisma/client";
import { BOOKING_STATUSES } from "@/lib/trips";
import {
  seedWorkflowFor,
  setBookingStatusDirect,
  setBookingStep,
  setBookingWorkflow,
} from "@/lib/booking-workflow-sync";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { todayUtc, parseDateInput, toDateInput } from "@/lib/dates";
import { resolveSchedule, serializeInstallment } from "@/lib/payment-schedule";
import { agreedTotal, tripHeadcount } from "@/lib/costs";
import { paymentScheduleSchema, installmentRows } from "@/lib/validators/booking";
import { zodErrorMessage } from "@/lib/forms";
import { assertBookable, seedScheduleFromLocation } from "@/lib/trip-mutations";
import { engagementLocationIdFor } from "@/lib/booked-via.server";

const BOOKING_STATUSES_TUPLE = BOOKING_STATUSES as [BookingStatus, ...BookingStatus[]];

// Workflow + step completions, for workflowProgress().
const WORKFLOW_INCLUDE = {
  workflow: {
    select: {
      id: true,
      name: true,
      steps: {
        orderBy: { sortOrder: "asc" as const },
        select: { id: true, label: true, status: true },
      },
    },
  },
  stepCompletions: { select: { stepId: true, completedOn: true } },
};

function workflowProgress(b: {
  stageLabel: string | null;
  stageOn: Date | null;
  workflow: {
    id: string;
    name: string;
    steps: { id: string; label: string; status: BookingStatus }[];
  } | null;
  stepCompletions: { stepId: string; completedOn: Date }[];
}) {
  if (!b.workflow) return { workflow: null };
  const done = new Map(b.stepCompletions.map((c) => [c.stepId, c.completedOn]));
  return {
    workflow: { id: b.workflow.id, name: b.workflow.name },
    stage: b.stageLabel,
    stageOn: b.stageOn ? toDateInput(b.stageOn) : null,
    steps: b.workflow.steps.map((s) => ({
      id: s.id,
      label: s.label,
      reachesStatus: s.status,
      done: done.has(s.id),
      completedOn: done.has(s.id) ? toDateInput(done.get(s.id)!) : null,
    })),
  };
}

function toolError(text: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${text}` }],
    isError: true,
  };
}

async function bookingStateResult(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { id: true, status: true, stageLabel: true, stageOn: true, ...WORKFLOW_INCLUDE },
  });
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ id: b.id, status: b.status, ...workflowProgress(b) }, null, 2),
      },
    ],
  };
}

export function registerBookingTools(server: McpServer, user: SessionUser) {
  // ── list-bookings (VIEWER+) ──────────────────────────────────────────
  server.registerTool(
    "list-bookings",
    {
      title: "List Bookings",
      description:
        "List all bookings for a trip. A 'venue' booking is one engagement with a location that covers every schedule item visiting that location plus any lodging there — including sites booked via it (a child location whose bookedVia is this venue; listed as location.coveredSites). A 'schedule_item' booking is a site-less reservation (e.g. a coach) tied to one item. Shows status, workflow progress (the workflow, its current stage, and each step with whether and when it was done — step IDs feed set-booking-step), location, contact, confirmation reference, and money: agreedAmount/agreedUnit as stored, agreedTotal (agreedAmount × headcount when agreedUnit is PER_PERSON, else agreedAmount; null when unknown), headcount, paidTotal, unpaidBalance and settled (both measured against agreedTotal). Venues the itinerary visits that have no booking yet are not listed (add-booking creates one). Useful for checking which reservations still need attention.",
      inputSchema: {
        tripId: z.string(),
        status: z.enum(BOOKING_STATUSES_TUPLE).optional(),
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
            location: {
              select: {
                id: true,
                name: true,
                coveredSites: {
                  select: { id: true, name: true },
                  orderBy: { name: "asc" },
                },
              },
            },
            bookedContact: { select: { id: true, name: true } },
            payments: { select: { amount: true } },
            ...WORKFLOW_INCLUDE,
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
            ...WORKFLOW_INCLUDE,
          },
        });

        // Per-person agreed prices multiply by the trip headcount.
        const trip = await prisma.trip.findUnique({
          where: { id: tripId },
          select: { participantCount: true, capacity: true },
        });
        const headcount = trip ? tripHeadcount(trip) : null;

        // Agreed price + running payment total (details via list-payments).
        const money = (b: {
          agreedAmount: unknown;
          agreedCurrency: string;
          agreedUnit: "PER_PERSON" | "PER_GROUP" | null;
          payments: { amount: unknown }[];
        }) => {
          const agreedAmount =
            b.agreedAmount == null ? null : Number(b.agreedAmount);
          const total = agreedTotal(
            { agreedAmount, agreedUnit: b.agreedUnit },
            headcount,
          );
          const paidTotal = b.payments.reduce(
            (sum, p) => sum + Number(p.amount),
            0,
          );
          return {
            agreedAmount,
            agreedCurrency: b.agreedCurrency,
            agreedUnit: b.agreedUnit,
            agreedTotal: total,
            headcount,
            paidTotal,
            unpaidBalance:
              total == null ? null : Math.max(0, total - paidTotal),
            settled: total != null && paidTotal >= total,
          };
        };

        const bookings = [
          ...engagementBookings.map((b) => ({
            type: "venue" as const,
            id: b.id,
            label: b.label,
            status: b.status,
            ...workflowProgress(b),
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
            ...workflowProgress(b),
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
        "Create a booking. Provide EITHER tripId + locationId (a venue engagement covering every schedule item in the trip that visits that location, plus lodging there — idempotent: re-adding the same venue updates it; a locationId that is booked via a parent venue (get-location's bookedVia) resolves to the PARENT's engagement, which is what is created/updated and returned as engagementLocationId) OR scheduleItemId (a site-less reservation like a coach or travel leg, tied to one item — rejected if the item is at a venue, since the venue engagement already covers it). A venue booking is refused for a location marked not bookable, and a NEW engagement's payment schedule is pre-filled from the location's standing payment terms (see set-location-payment-schedule), and it starts on the location's default workflow (else the global default). Status is coarse: PLANNED, IN_PROGRESS, CONFIRMED, NOT_NEEDED. A booking on a workflow (see list-booking-workflows) derives its status from the workflow steps ticked with set-booking-step; on such a booking only NOT_NEEDED (or leaving it) can be set directly. A booking without a workflow takes any status. bookedOn (YYYY-MM-DD) is the date the engagement was booked — it anchors BOOKING-relative payment installments. agreedAmount/agreedCurrency/agreedUnit record the negotiated price for the engagement (the location's cost catalog is the asking price); agreedUnit: null (or omitted) = agreedAmount is the TOTAL for the engagement; PER_PERSON = agreedAmount is a per-person rate, multiplied by the trip headcount (participantCount, else capacity) to get the total that balances, settled state and payment-schedule percentages use; with no headcount that total is unknown (agreedTotal null in list-bookings/list-payments). PER_GROUP is legacy and also means the total. Log actual payments with add-payment.",
      inputSchema: {
        tripId: z.string().optional(),
        scheduleItemId: z.string().optional(),
        locationId: z.string().optional(),
        label: z.string().optional(),
        status: z.enum(BOOKING_STATUSES_TUPLE).optional(),
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

        // A site booked via a parent is covered by the parent's engagement.
        const venueId = isVenue
          ? await engagementLocationIdFor(locationId!)
          : null;
        const scalars = {
          locationId: (isVenue ? venueId : locationId) || null,
          label: label || null,
          bookedContactId: bookedContactId || null,
          confirmationRef: confirmationRef || null,
          notes: notes || null,
          bookedOn: bookedOn ? parseDateInput(bookedOn) : null,
          agreedAmount: agreedAmount ?? null,
          agreedCurrency: agreedCurrency || "USD",
          agreedUnit: agreedUnit ?? null,
        };
        let booking: { id: string };
        if (isVenue) {
          // Same guards as the web upsertVenueBooking: never book a walk-by
          // stop, and seed a NEW engagement's installment schedule from the
          // venue's standing payment terms (GH #86). The nested create only
          // fires on the create branch — an existing engagement keeps its
          // schedule. A passed status is applied after the write, through the
          // same workflow rules as the web status control.
          const notBookable = await assertBookable(venueId!);
          if (notBookable) {
            return {
              content: [{ type: "text" as const, text: `Error: ${notBookable}` }],
              isError: true,
            };
          }
          const schedule = await seedScheduleFromLocation(venueId!);
          const workflow = await seedWorkflowFor(venueId!);
          booking = await prisma.booking.upsert({
            where: {
              tripId_locationId: { tripId: tripId!, locationId: venueId! },
            },
            create: {
              tripId,
              ...scalars,
              ...workflow,
              ...(schedule ? { paymentSchedule: schedule } : {}),
            },
            update: scalars,
          });
        } else {
          // Item bookings are for SITE-LESS items only (a coach, a label-only
          // reservation, a travel leg). A venue item is covered by its
          // (trip, location) engagement — mirrors web addBooking.
          const item = await prisma.scheduleItem.findUnique({
            where: { id: scheduleItemId! },
            select: { _count: { select: { sites: true } } },
          });
          if (!item) {
            return {
              content: [{ type: "text" as const, text: "Error: Schedule item not found." }],
              isError: true,
            };
          }
          if (item._count.sites > 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: This item is at a venue — book the venue engagement instead (add-booking with tripId + locationId), not per item.",
                },
              ],
              isError: true,
            };
          }
          booking = await prisma.booking.create({
            data: { scheduleItemId, ...scalars, ...(await seedWorkflowFor(null)) },
          });
        }
        if (status) await setBookingStatusDirect(booking.id, status);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                isVenue
                  ? { id: booking.id, engagementLocationId: venueId }
                  : { id: booking.id },
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

  // ── update-booking (PLANNER+) ────────────────────────────────────────
  server.registerTool(
    "update-booking",
    {
      title: "Update Booking",
      description:
        "Update a booking's status, contact, confirmation reference, notes, booked-on date, or agreed price (agreedAmount/agreedCurrency/agreedUnit — the negotiated engagement price; omit a field to leave it unchanged). agreedUnit: null (or omitted) = agreedAmount is the TOTAL for the engagement; PER_PERSON = agreedAmount is a per-person rate, multiplied by the trip headcount (participantCount, else capacity) to get the total that balances, settled state and payment-schedule percentages use; with no headcount that total is unknown (agreedTotal null in list-bookings/list-payments). PER_GROUP is legacy and also means the total. Pass agreedUnit: null to switch a per-person price back to a total. bookedOn (YYYY-MM-DD) is the date the engagement was booked — it anchors BOOKING-relative payment installments. Common use: record a confirmation reference number. Status is coarse: PLANNED, IN_PROGRESS, CONFIRMED, NOT_NEEDED. A booking on a workflow (see list-booking-workflows) derives its status from the workflow steps ticked with set-booking-step; on such a booking only NOT_NEEDED (or leaving it) can be set directly. A booking without a workflow takes any status. To move a workflow booking along, use set-booking-step.",
      inputSchema: {
        bookingId: z.string(),
        status: z.enum(BOOKING_STATUSES_TUPLE).optional(),
        bookedContactId: z.string().optional(),
        confirmationRef: z.string().optional(),
        notes: z.string().optional(),
        bookedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        agreedAmount: z.number().nonnegative().optional(),
        agreedCurrency: z.string().optional(),
        agreedUnit: z.enum(["PER_PERSON", "PER_GROUP"]).nullable().optional(),
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
        if (status !== undefined) {
          await setBookingStatusDirect(bookingId, status);
        }

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

  // ── list-booking-workflows (VIEWER+) ─────────────────────────────────
  server.registerTool(
    "list-booking-workflows",
    {
      title: "List Booking Workflows",
      description:
        "List the admin-defined booking workflows (e.g. 'Booking agreement', 'Tickets only') with their ordered steps. Each step names the coarse status a booking reaches once it is done (IN_PROGRESS or CONFIRMED). Returns workflow IDs for set-booking-workflow and step IDs for set-booking-step; isDefault marks the workflow new bookings start on when their venue names none.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      if (!hasRole(user.role, "VIEWER")) {
        return toolError("Insufficient permissions. VIEWER role or higher required.");
      }
      const workflows = await prisma.bookingWorkflow.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          isDefault: true,
          steps: {
            orderBy: { sortOrder: "asc" },
            select: { id: true, label: true, status: true },
          },
        },
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              workflows.map((w) => ({
                ...w,
                steps: w.steps.map((st) => ({
                  id: st.id,
                  label: st.label,
                  reachesStatus: st.status,
                })),
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── set-booking-step (PLANNER+) ──────────────────────────────────────
  server.registerTool(
    "set-booking-step",
    {
      title: "Set Booking Workflow Step",
      description:
        "Mark one workflow step done (or not done) on a booking — e.g. 'Initial contact' when the venue was emailed. Needs bookingId (from list-bookings) and stepId (from list-bookings' steps or list-booking-workflows; it must belong to the booking's workflow). completedOn (YYYY-MM-DD) back-dates it; default today. Steps may be ticked out of order. Returns the booking's resulting status and stage.",
      inputSchema: {
        bookingId: z.string(),
        stepId: z.string(),
        done: z.boolean().default(true),
        completedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ bookingId, stepId, done, completedOn }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return toolError("Insufficient permissions. PLANNER role or higher required.");
        }
        const on = completedOn ? parseDateInput(completedOn) : todayUtc();
        if (!on) return toolError("completedOn must be a real YYYY-MM-DD date.");
        const res = await setBookingStep({
          bookingId,
          stepId,
          done,
          completedOn: on,
          userId: user.id,
        });
        if ("error" in res) return toolError(res.error);
        return bookingStateResult(bookingId);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );

  // ── set-booking-workflow (PLANNER+) ──────────────────────────────────
  server.registerTool(
    "set-booking-workflow",
    {
      title: "Set Booking Workflow",
      description:
        "Put a booking on a different workflow (workflowId from list-booking-workflows), or pass workflowId: null to take it off workflows (its status is then set directly with update-booking). Needs bookingId from list-bookings. Clears the steps ticked under the old workflow and restarts the status at PLANNED (unless NOT_NEEDED). Returns the booking's resulting status and stage.",
      inputSchema: {
        bookingId: z.string(),
        workflowId: z.string().nullable(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ bookingId, workflowId }) => {
      try {
        if (!hasRole(user.role, "PLANNER")) {
          return toolError("Insufficient permissions. PLANNER role or higher required.");
        }
        const res = await setBookingWorkflow(bookingId, workflowId);
        if ("error" in res) return toolError(res.error);
        return bookingStateResult(bookingId);
      } catch (error) {
        return toolError(error instanceof Error ? error.message : String(error));
      }
    },
  );

  // ── list-payments (VIEWER+) ──────────────────────────────────────────
  server.registerTool(
    "list-payments",
    {
      title: "List Payments",
      description:
        "List the payments logged against a booking (get bookingId from list-bookings), with the booking's agreed price (agreedAmount/agreedUnit as stored, plus agreedTotal: the rate × trip headcount for a PER_PERSON price, else the amount; null when a per-person rate has no headcount), the outstanding balance, and its payment schedule: installments (percentage of agreedTotal or a fixed amount) due a number of days before trip start, each resolved to an amount, due date, and paid/overdue/upcoming state. A booking is settled when payments cover agreedTotal. Set the schedule with set-payment-schedule.",
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
            trip: {
              select: { startDate: true, participantCount: true, capacity: true },
            },
            scheduleItem: {
              select: {
                day: {
                  select: {
                    trip: {
                      select: {
                        startDate: true,
                        participantCount: true,
                        capacity: true,
                      },
                    },
                  },
                },
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

        const trip = booking.trip ?? booking.scheduleItem?.day.trip ?? null;
        const tripStartDate = trip?.startDate ?? null;
        const headcount = trip ? tripHeadcount(trip) : null;
        const total = agreedTotal(
          { agreedAmount, agreedUnit: booking.agreedUnit },
          headcount,
        );
        const schedule = resolveSchedule(
          booking.paymentSchedule.map(serializeInstallment),
          {
            agreedAmount: total,
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
                  agreedTotal: total,
                  headcount,
                  paidTotal,
                  unpaidBalance:
                    total == null ? null : Math.max(0, total - paidTotal),
                  settled: total != null && paidTotal >= total,
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
