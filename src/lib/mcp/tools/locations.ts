import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CostUnit } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { parseDateInput } from "@/lib/dates";
import { paymentScheduleSchema, installmentRows } from "@/lib/validators/booking";
import { zodErrorMessage } from "@/lib/forms";
import {
  MergeError,
  mergeLocations,
  previewLocationMerge,
} from "@/lib/location-merge";

export function registerLocationTools(server: McpServer, user: SessionUser) {
  // ── search-locations (VIEWER+) ─────────────────────────────────────────
  server.registerTool(
    "search-locations",
    {
      title: "Search Locations",
      description:
        "Search locations by name, region, or trip type. Returns location name, address, region, and whether it's a host site. Use this to find location IDs for schedule items and stays. Excludes archived locations by default.",
      inputSchema: {
        query: z.string().optional(),
        regionId: z.string().optional(),
        tripTypeId: z.string().optional(),
        hostSitesOnly: z.boolean().optional(),
        limit: z.number().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, regionId, tripTypeId, hostSitesOnly, limit }) => {
      try {
        const where: Record<string, unknown> = { archivedAt: null };

        if (query) where.name = { contains: query, mode: "insensitive" };
        if (regionId) where.regionId = regionId;
        if (tripTypeId) where.tripTypes = { some: { id: tripTypeId } };
        if (hostSitesOnly) where.hostSite = { isNot: null };

        const locations = await prisma.location.findMany({
          where,
          take: limit || 25,
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            address: true,
            region: { select: { id: true, name: true } },
            hostSite: { select: { providesLodging: true } },
            _count: { select: { costs: true, contacts: true } },
          },
        });

        const result = locations.map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
          region: l.region,
          hasHostSite: l.hostSite !== null,
          providesLodging: l.hostSite?.providesLodging ?? false,
          costCount: l._count.costs,
          contactCount: l._count.contacts,
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

  // ── get-location (VIEWER+) ─────────────────────────────────────────────
  server.registerTool(
    "get-location",
    {
      title: "Get Location Details",
      description:
        "Get full details of a location including contacts, costs, host site capabilities, booking notes, and schedule limitations. Useful before creating a booking or adding a location to an itinerary.",
      inputSchema: { locationId: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ locationId }) => {
      try {
        const location = await prisma.location.findUnique({
          where: { id: locationId },
          include: {
            region: { select: { id: true, name: true } },
            tripTypes: { select: { id: true, name: true } },
            contacts: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                organization: true,
                role: true,
              },
            },
            primaryContact: {
              select: { id: true, name: true },
            },
            costs: {
              select: {
                id: true,
                label: true,
                amount: true,
                currency: true,
                unit: true,
                confirmedAt: true,
                notes: true,
              },
            },
            // Standing payment terms (GH #86) that seed new engagements here.
            defaultPaymentSchedule: {
              orderBy: { sortOrder: "asc" },
              select: {
                id: true,
                label: true,
                percent: true,
                fixedAmount: true,
                anchor: true,
                offsetValue: true,
                offsetUnit: true,
              },
            },
            hostSite: true,
          },
        });

        if (!location) {
          return {
            content: [
              { type: "text" as const, text: "Error: Location not found" },
            ],
            isError: true,
          };
        }

        const result = {
          ...location,
          costs: location.costs.map((c) => ({
            ...c,
            amount: Number(c.amount),
            confirmedAt: c.confirmedAt?.toISOString() ?? null,
          })),
          defaultPaymentSchedule: location.defaultPaymentSchedule.map((t) => ({
            ...t,
            percent: t.percent == null ? null : Number(t.percent),
            fixedAmount: t.fixedAmount == null ? null : Number(t.fixedAmount),
          })),
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

  // ── set-location-payment-schedule (PLANNER+) ───────────────────────────
  server.registerTool(
    "set-location-payment-schedule",
    {
      title: "Set Location Payment Terms",
      description:
        "REPLACE a location's STANDING payment terms (get locationId from get-location / search-locations) with the given installments — pass an empty list to clear them. These are the venue's default deposit/balance cadence (they tend to hold year to year), stored on the location like its cost catalog; a NEW venue engagement pre-fills its own schedule from them (an instantiated template's schedule wins, then these, then empty). Editing terms never changes existing bookings — use set-payment-schedule for a specific booking. Each installment has EITHER percent (of the eventual agreed price) OR fixedAmount, plus an optional label like 'Deposit'. The due date is set by anchor: 'EVENT_START' (default) → offsetValue offsetUnits before trip start (negative = after); 'BOOKING' → offsetValue offsetUnits after the engagement's booked-on date; 'NONE' → no deadline (omit offsetValue/offsetUnit). offsetUnit is 'DAY', 'WEEK', or 'MONTH'. A BOOKING/NONE term resolves per engagement once seeded onto a real booking.",
      inputSchema: {
        locationId: z.string(),
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
    async ({ locationId, installments }) => {
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

        const location = await prisma.location.findUnique({
          where: { id: locationId },
          select: { id: true },
        });
        if (!location) {
          return {
            content: [
              { type: "text" as const, text: "Error: Location not found." },
            ],
            isError: true,
          };
        }

        await prisma.$transaction([
          prisma.locationPaymentScheduleItem.deleteMany({ where: { locationId } }),
          prisma.locationPaymentScheduleItem.createMany({
            data: installmentRows(parsed.data.installments).map((r) => ({
              locationId,
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

  // ── list-trip-types (VIEWER+) ──────────────────────────────────────────
  server.registerTool(
    "list-trip-types",
    {
      title: "List Trip Types",
      description:
        "List all available trip types with their names, descriptions, and default currencies. Use the trip type ID when creating a new trip.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const tripTypes = await prisma.tripType.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
            defaultCurrency: true,
          },
        });

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(tripTypes, null, 2) },
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

  // ── list-regions (VIEWER+) ─────────────────────────────────────────────
  server.registerTool(
    "list-regions",
    {
      title: "List Regions",
      description:
        "List the hierarchical place catalog (e.g. England → London). Returns each region's id, name, parent, and location count. Use a region id with search-locations (regionId) or create-location/update-location to file a location under a region.",
      inputSchema: {
        query: z.string().optional(),
        tripTypeId: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, tripTypeId }) => {
      try {
        const where: Record<string, unknown> = {};
        if (query) where.name = { contains: query, mode: "insensitive" };
        if (tripTypeId) where.tripTypes = { some: { id: tripTypeId } };

        const regions = await prisma.region.findMany({
          where,
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            parent: { select: { id: true, name: true } },
            _count: { select: { locations: true } },
          },
        });

        const result = regions.map((r) => ({
          id: r.id,
          name: r.name,
          parent: r.parent,
          locationCount: r._count.locations,
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

  // ── create-location (PLANNER+) ─────────────────────────────────────────
  server.registerTool(
    "create-location",
    {
      title: "Create Location",
      description:
        "Create a location (a venue, stop, or potential host site). Requires a name. description is itinerary-facing (shown on shared itineraries); notes are staff-only. Set bookable=false for walk-by stops that are never booked. regionId files it under a region (use list-regions); tripTypeIds tag it (use list-trip-types). To make it a host site or add pricing, use set-host-site / add-location-cost afterwards.",
      inputSchema: {
        name: z.string(),
        regionId: z.string().optional(),
        address: z.string().optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
        website: z.string().optional(),
        mapUrl: z.string().optional(),
        bookable: z.boolean().optional(),
        bookingOpensLeadDays: z.number().optional(),
        bookingNotes: z.string().optional(),
        scheduleLimitations: z.string().optional(),
        tripTypeIds: z.array(z.string()).optional(),
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
      regionId,
      address,
      description,
      notes,
      website,
      mapUrl,
      bookable,
      bookingOpensLeadDays,
      bookingNotes,
      scheduleLimitations,
      tripTypeIds,
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
        const location = await prisma.location.create({
          data: {
            name,
            address: address || null,
            description: description || null,
            notes: notes || null,
            website: website || null,
            mapUrl: mapUrl || null,
            bookable: bookable ?? true,
            bookingOpensLeadDays: bookingOpensLeadDays ?? null,
            bookingNotes: bookingNotes || null,
            scheduleLimitations: scheduleLimitations || null,
            ...(regionId ? { region: { connect: { id: regionId } } } : {}),
            tripTypes: tripTypeIds?.length
              ? { connect: tripTypeIds.map((id) => ({ id })) }
              : undefined,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: location.id }, null, 2),
            },
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

  // ── update-location (PLANNER+) ─────────────────────────────────────────
  server.registerTool(
    "update-location",
    {
      title: "Update Location",
      description:
        "Update a location's details. Only include fields you want to change. Pass regionId to refile (empty string clears the region). Passing tripTypeIds REPLACES the tag set (pass [] to clear). Use get-location to find the id and current values.",
      inputSchema: {
        locationId: z.string(),
        name: z.string().optional(),
        regionId: z.string().optional(),
        address: z.string().optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
        website: z.string().optional(),
        mapUrl: z.string().optional(),
        bookable: z.boolean().optional(),
        bookingOpensLeadDays: z.number().optional(),
        bookingNotes: z.string().optional(),
        scheduleLimitations: z.string().optional(),
        tripTypeIds: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      locationId,
      name,
      regionId,
      address,
      description,
      notes,
      website,
      mapUrl,
      bookable,
      bookingOpensLeadDays,
      bookingNotes,
      scheduleLimitations,
      tripTypeIds,
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
        if (address !== undefined) data.address = address || null;
        if (description !== undefined) data.description = description || null;
        if (notes !== undefined) data.notes = notes || null;
        if (website !== undefined) data.website = website || null;
        if (mapUrl !== undefined) data.mapUrl = mapUrl || null;
        if (bookable !== undefined) data.bookable = bookable;
        if (bookingOpensLeadDays !== undefined)
          data.bookingOpensLeadDays = bookingOpensLeadDays ?? null;
        if (bookingNotes !== undefined) data.bookingNotes = bookingNotes || null;
        if (scheduleLimitations !== undefined)
          data.scheduleLimitations = scheduleLimitations || null;
        if (regionId !== undefined) {
          data.region = regionId
            ? { connect: { id: regionId } }
            : { disconnect: true };
        }
        if (tripTypeIds !== undefined) {
          data.tripTypes = { set: tripTypeIds.map((id) => ({ id })) };
        }

        await prisma.location.update({ where: { id: locationId }, data });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, id: locationId }, null, 2),
            },
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

  // ── set-host-site (PLANNER+) ───────────────────────────────────────────
  server.registerTool(
    "set-host-site",
    {
      title: "Set Host Site",
      description:
        "Mark a location as a host site and set its capability flags, or update them. A host site can host/lodge the group. Set remove=true to strip host-site status entirely. Capability flags (providesLodging, providesMeals, providesMeetingSpace) and notes default to their current values when omitted on an existing host site, or to false/empty when first marking one.",
      inputSchema: {
        locationId: z.string(),
        providesLodging: z.boolean().optional(),
        providesMeals: z.boolean().optional(),
        providesMeetingSpace: z.boolean().optional(),
        staffNotes: z.string().optional(),
        logisticsNotes: z.string().optional(),
        remove: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      locationId,
      providesLodging,
      providesMeals,
      providesMeetingSpace,
      staffNotes,
      logisticsNotes,
      remove,
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
        if (remove) {
          await prisma.hostSite.deleteMany({ where: { locationId } });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { success: true, locationId, hostSite: false },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const update: Record<string, unknown> = {};
        if (providesLodging !== undefined)
          update.providesLodging = providesLodging;
        if (providesMeals !== undefined) update.providesMeals = providesMeals;
        if (providesMeetingSpace !== undefined)
          update.providesMeetingSpace = providesMeetingSpace;
        if (staffNotes !== undefined) update.staffNotes = staffNotes || null;
        if (logisticsNotes !== undefined)
          update.logisticsNotes = logisticsNotes || null;

        const hostSite = await prisma.hostSite.upsert({
          where: { locationId },
          update,
          create: {
            locationId,
            providesLodging: providesLodging ?? false,
            providesMeals: providesMeals ?? false,
            providesMeetingSpace: providesMeetingSpace ?? false,
            staffNotes: staffNotes || null,
            logisticsNotes: logisticsNotes || null,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, id: hostSite.id }, null, 2),
            },
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

  // ── set-primary-contact (PLANNER+) ─────────────────────────────────────
  server.registerTool(
    "set-primary-contact",
    {
      title: "Set Primary Contact",
      description:
        "Designate a contact as the primary/go-to person for a location. The contact is linked to the location if it isn't already, then set as primary. Set clear=true (or omit contactId) to remove the designation without unlinking the contact. Use search-contacts to find the contactId and get-location to see the current primary.",
      inputSchema: {
        locationId: z.string(),
        contactId: z.string().optional(),
        clear: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ locationId, contactId, clear }) => {
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
        const setPrimary = !clear && contactId;
        await prisma.location.update({
          where: { id: locationId },
          data: setPrimary
            ? {
                contacts: { connect: { id: contactId } },
                primaryContact: { connect: { id: contactId } },
              }
            : { primaryContact: { disconnect: true } },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  locationId,
                  primaryContactId: setPrimary ? contactId : null,
                },
                null,
                2,
              ),
            },
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

  // ── add-location-cost (PLANNER+) ───────────────────────────────────────
  server.registerTool(
    "add-location-cost",
    {
      title: "Add Location Cost",
      description:
        "Add a price line to a location (e.g. an entry fee or guide fee). Requires locationId, a label, and an amount. unit is PER_PERSON (default) or PER_GROUP. confirmedAt (YYYY-MM-DD) records when the price was last verified — stale pricing surfaces in the UI. Use get-location to see existing costs.",
      inputSchema: {
        locationId: z.string(),
        label: z.string(),
        amount: z.number(),
        currency: z.string().optional(),
        unit: z.string().optional(),
        confirmedAt: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ locationId, label, amount, currency, unit, confirmedAt, notes }) => {
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
        const cost = await prisma.cost.create({
          data: {
            locationId,
            label,
            amount,
            currency: currency || "USD",
            unit: (unit as CostUnit) || "PER_PERSON",
            confirmedAt: confirmedAt ? parseDateInput(confirmedAt) : null,
            notes: notes || null,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: cost.id }, null, 2),
            },
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

  // ── update-location-cost (PLANNER+) ────────────────────────────────────
  server.registerTool(
    "update-location-cost",
    {
      title: "Update Location Cost",
      description:
        "Update a location price line. Only include fields you want to change. Common use: refresh the amount and set confirmedAt (YYYY-MM-DD) to today to clear a stale-price flag. unit is PER_PERSON or PER_GROUP. Use get-location to find the cost id.",
      inputSchema: {
        costId: z.string(),
        label: z.string().optional(),
        amount: z.number().optional(),
        currency: z.string().optional(),
        unit: z.string().optional(),
        confirmedAt: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ costId, label, amount, currency, unit, confirmedAt, notes }) => {
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
        if (label !== undefined) data.label = label;
        if (amount !== undefined) data.amount = amount;
        if (currency !== undefined) data.currency = currency || "USD";
        if (unit !== undefined) data.unit = unit as CostUnit;
        if (confirmedAt !== undefined)
          data.confirmedAt = confirmedAt ? parseDateInput(confirmedAt) : null;
        if (notes !== undefined) data.notes = notes || null;

        await prisma.cost.update({ where: { id: costId }, data });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, id: costId }, null, 2),
            },
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

  // ── merge-locations (PLANNER+) ─────────────────────────────────────────
  server.registerTool(
    "merge-locations",
    {
      title: "Merge Locations",
      description:
        "Merge a duplicate location (sourceLocationId) into the one to keep (targetLocationId), then DELETE the source. Every reference moves to the target: schedule items, rough-plan days, bookings, stays, notes, documents, costs, contacts, trip-type tags, travel legs/stops, share links. The target's values win; the source only fills empty fields (long text is concatenated). If both venues are engaged on the same trip, the two bookings fold into the target's (payments/notes/documents move over; the further-along status is kept). Use search-locations to find both IDs. Pass dryRun: true first to see what would move without changing anything. Returns counts of what was (or would be) moved.",
      inputSchema: {
        sourceLocationId: z.string(),
        targetLocationId: z.string(),
        dryRun: z.boolean().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ sourceLocationId, targetLocationId, dryRun }) => {
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
        const result = dryRun
          ? await previewLocationMerge(sourceLocationId, targetLocationId)
          : await mergeLocations(sourceLocationId, targetLocationId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, dryRun: dryRun ?? false, ...result },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof MergeError ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
