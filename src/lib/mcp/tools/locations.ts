import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CostUnit } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import { parseDateInput, toDateInput } from "@/lib/dates";
import { paymentScheduleSchema, installmentRows } from "@/lib/validators/booking";
import { zodErrorMessage } from "@/lib/forms";
import { locationEventSchema } from "@/lib/validators/location-event";
import {
  MergeError,
  mergeLocations,
  previewLocationMerge,
} from "@/lib/location-merge";
import { checkBookedVia, setBookedVia } from "@/lib/booked-via.server";

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
        "Get full details of a location including contacts, costs (each with its active dates validFrom/validTo), standing events (events: recurring fixtures at the venue such as 'Evensong 17:00' — to put one on a day, call add-schedule-item with its title, startTime/endTime, categoryId and fixedTime: true), host site capabilities, booking notes, and schedule limitations. bookedVia is the parent venue whose single engagement covers this site (its bookings live on the parent — see add-booking); coveredSites lists the sites booked via this one. Useful before creating a booking or adding a location to an itinerary.",
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
                validFrom: true,
                validTo: true,
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
            // Standing events here (Evensong 17:00) — add-schedule-item with
            // these times (+ fixedTime) puts one on a day.
            events: {
              orderBy: [{ startTime: "asc" }, { title: "asc" }],
              select: {
                id: true,
                title: true,
                startTime: true,
                endTime: true,
                categoryId: true,
                category: { select: { name: true } },
                notes: true,
              },
            },
            hostSite: true,
            bookedVia: { select: { id: true, name: true } },
            coveredSites: {
              orderBy: { name: "asc" },
              select: { id: true, name: true },
            },
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
            validFrom: toDateInput(c.validFrom) || null,
            validTo: toDateInput(c.validTo) || null,
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
        "Create a location (a venue, stop, or potential host site). Requires a name. description is itinerary-facing (shown on shared itineraries); notes are staff-only. Set bookable=false for walk-by stops that are never booked. regionId files it under a region (use list-regions); tripTypeIds tag it (use list-trip-types). googlePlaceId (a Google Places place ID) plus lat/lng (both or neither) make map links open the exact place. To make it a host site or add pricing, use set-host-site / add-location-cost afterwards. bookedViaId names a parent venue whose single engagement covers this site (a museum booking covering several of its sites): the site still shows as itself on itineraries, but its sessions and stays are booked on the parent. Single level only — the parent can't itself be booked via another, and a site that covers others can't take a parent.",
      inputSchema: {
        name: z.string(),
        regionId: z.string().optional(),
        address: z.string().optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
        website: z.string().optional(),
        mapUrl: z.string().optional(),
        googlePlaceId: z.string().optional(),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
        bookable: z.boolean().optional(),
        bookingOpensLeadDays: z.number().optional(),
        bookingNotes: z.string().optional(),
        scheduleLimitations: z.string().optional(),
        tripTypeIds: z.array(z.string()).optional(),
        bookedViaId: z.string().nullable().optional(),
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
      googlePlaceId,
      lat,
      lng,
      bookable,
      bookingOpensLeadDays,
      bookingNotes,
      scheduleLimitations,
      tripTypeIds,
      bookedViaId,
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

      if (bookedViaId) {
        const err = await checkBookedVia(null, bookedViaId);
        if (err) {
          return {
            content: [{ type: "text" as const, text: `Error: ${err}` }],
            isError: true,
          };
        }
      }

      if ((lat == null) !== (lng == null)) {
        return {
          content: [
            { type: "text" as const, text: "Error: Pass lat and lng together, or neither." },
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
            googlePlaceId: googlePlaceId || null,
            placeIdCheckedAt: googlePlaceId ? new Date() : null,
            lat: lat ?? null,
            lng: lng ?? null,
            bookable: bookable ?? true,
            bookingOpensLeadDays: bookingOpensLeadDays ?? null,
            bookingNotes: bookingNotes || null,
            scheduleLimitations: scheduleLimitations || null,
            ...(regionId ? { region: { connect: { id: regionId } } } : {}),
            tripTypes: tripTypeIds?.length
              ? { connect: tripTypeIds.map((id) => ({ id })) }
              : undefined,
            ...(bookedViaId ? { bookedVia: { connect: { id: bookedViaId } } } : {}),
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
        "Update a location's details. Only include fields you want to change. Pass regionId to refile (empty string clears the region). Passing tripTypeIds REPLACES the tag set (pass [] to clear). googlePlaceId links a Google place (empty string clears); lat/lng must be passed together (null clears both). Use get-location to find the id and current values. bookedViaId names a parent venue whose single engagement covers this site (a museum booking covering several of its sites): the site still shows as itself on itineraries, but its sessions and stays are booked on the parent. Single level only — the parent can't itself be booked via another, and a site that covers others can't take a parent. null clears it. Setting a parent MOVES this site's own existing engagements to the parent's (folded into the parent's engagement on the same trip, like merge-locations does; reported as movedBookings).",
      inputSchema: {
        locationId: z.string(),
        name: z.string().optional(),
        regionId: z.string().optional(),
        address: z.string().optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
        website: z.string().optional(),
        mapUrl: z.string().optional(),
        googlePlaceId: z.string().optional(),
        lat: z.number().min(-90).max(90).nullable().optional(),
        lng: z.number().min(-180).max(180).nullable().optional(),
        bookable: z.boolean().optional(),
        bookingOpensLeadDays: z.number().optional(),
        bookingNotes: z.string().optional(),
        scheduleLimitations: z.string().optional(),
        tripTypeIds: z.array(z.string()).optional(),
        bookedViaId: z.string().nullable().optional(),
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
      googlePlaceId,
      lat,
      lng,
      bookable,
      bookingOpensLeadDays,
      bookingNotes,
      scheduleLimitations,
      tripTypeIds,
      bookedViaId,
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
        if (googlePlaceId !== undefined) {
          data.googlePlaceId = googlePlaceId || null;
          data.placeIdCheckedAt = googlePlaceId ? new Date() : null;
          data.placeIdNeedsReview = false;
        }
        if (lat !== undefined || lng !== undefined) {
          if ((lat == null) !== (lng == null)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: Pass lat and lng together (null for both clears them).",
                },
              ],
              isError: true,
            };
          }
          data.lat = lat ?? null;
          data.lng = lng ?? null;
        }
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

        // Booked-via goes through its own path: validated (single level, not
        // self) and folds this site's engagements into the parent's.
        let movedBookings = 0;
        if (bookedViaId !== undefined) {
          const res = await setBookedVia(locationId, bookedViaId || null);
          if ("error" in res) {
            return {
              content: [{ type: "text" as const, text: `Error: ${res.error}` }],
              isError: true,
            };
          }
          movedBookings = res.folded;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  id: locationId,
                  ...(bookedViaId !== undefined ? { movedBookings } : {}),
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
        "Add a price line to a location (e.g. an entry fee or guide fee). Requires locationId, a label, and an amount. unit is PER_PERSON (default) or PER_GROUP. confirmedAt (YYYY-MM-DD) records when the price was last verified — stale pricing surfaces in the UI. validFrom / validTo (YYYY-MM-DD, either optional) are the line's active dates: a trip is priced by the lines valid on its start date, so a known future price change is a second line with a validFrom (and a validTo on the current one). The venue's price list is the default price of every engagement there until a booking gets its own agreed priceLines (add-booking / update-booking). Use get-location to see existing costs.",
      inputSchema: {
        locationId: z.string(),
        label: z.string(),
        amount: z.number(),
        currency: z.string().optional(),
        unit: z.string().optional(),
        confirmedAt: z.string().optional(),
        validFrom: z.string().optional(),
        validTo: z.string().optional(),
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
      locationId,
      label,
      amount,
      currency,
      unit,
      confirmedAt,
      validFrom,
      validTo,
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
        const cost = await prisma.cost.create({
          data: {
            locationId,
            label,
            amount,
            currency: currency || "USD",
            unit: (unit as CostUnit) || "PER_PERSON",
            confirmedAt: confirmedAt ? parseDateInput(confirmedAt) : null,
            validFrom: validFrom ? parseDateInput(validFrom) : null,
            validTo: validTo ? parseDateInput(validTo) : null,
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
        "Update a location price line. Only include fields you want to change. Common use: refresh the amount and set confirmedAt (YYYY-MM-DD) to today to clear a stale-price flag. unit is PER_PERSON or PER_GROUP. validFrom / validTo (YYYY-MM-DD; pass an empty string to clear) bound the line's active dates. Use get-location to find the cost id.",
      inputSchema: {
        costId: z.string(),
        label: z.string().optional(),
        amount: z.number().optional(),
        currency: z.string().optional(),
        unit: z.string().optional(),
        confirmedAt: z.string().optional(),
        validFrom: z.string().optional(),
        validTo: z.string().optional(),
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
      costId,
      label,
      amount,
      currency,
      unit,
      confirmedAt,
      validFrom,
      validTo,
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
        if (label !== undefined) data.label = label;
        if (amount !== undefined) data.amount = amount;
        if (currency !== undefined) data.currency = currency || "USD";
        if (unit !== undefined) data.unit = unit as CostUnit;
        if (confirmedAt !== undefined)
          data.confirmedAt = confirmedAt ? parseDateInput(confirmedAt) : null;
        if (validFrom !== undefined)
          data.validFrom = validFrom ? parseDateInput(validFrom) : null;
        if (validTo !== undefined)
          data.validTo = validTo ? parseDateInput(validTo) : null;
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

  // ── add-location-event (PLANNER+) ──────────────────────────────────────
  server.registerTool(
    "add-location-event",
    {
      title: "Add Location Event",
      description:
        "Add a standing event to a location — a fixture that happens there at a set time regardless of the trip (e.g. 'Evensong' at 17:00 at a cathedral, a daily guided tour at 11:00). Requires locationId, a title and startTime (HH:MM, 24-hour); endTime (HH:MM), categoryId (from list-schedule-categories) and notes are optional. Planners add one to a day in one click from the itinerary item form; over MCP, add-schedule-item with the event's times and fixedTime: true does the same. Use get-location to see a venue's events.",
      inputSchema: {
        locationId: z.string(),
        title: z.string(),
        startTime: z.string(),
        endTime: z.string().optional(),
        categoryId: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ locationId, title, startTime, endTime, categoryId, notes }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [{ type: "text" as const, text: "Error: Requires PLANNER role or above" }],
          isError: true,
        };
      }
      const parsed = locationEventSchema.safeParse({
        title,
        startTime,
        endTime,
        categoryId,
        notes,
      });
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${zodErrorMessage(parsed.error)}` }],
          isError: true,
        };
      }
      try {
        const event = await prisma.locationEvent.create({
          data: {
            locationId,
            title: parsed.data.title,
            startTime: parsed.data.startTime,
            endTime: parsed.data.endTime ?? null,
            categoryId: parsed.data.categoryId ?? null,
            notes: parsed.data.notes || null,
          },
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ id: event.id }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── update-location-event (PLANNER+) ───────────────────────────────────
  server.registerTool(
    "update-location-event",
    {
      title: "Update Location Event",
      description:
        "Update a location's standing event (eventId from get-location's events). Only include fields you want to change: title, startTime / endTime (HH:MM; pass endTime as an empty string to clear it), categoryId (empty string clears), notes. Schedule items already added from the event are not touched.",
      inputSchema: {
        eventId: z.string(),
        title: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        categoryId: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ eventId, title, startTime, endTime, categoryId, notes }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [{ type: "text" as const, text: "Error: Requires PLANNER role or above" }],
          isError: true,
        };
      }
      try {
        const current = await prisma.locationEvent.findUnique({ where: { id: eventId } });
        if (!current) {
          return {
            content: [{ type: "text" as const, text: "Error: Event not found" }],
            isError: true,
          };
        }
        // Validate the merged result so a partial update can't leave the
        // event with an end before its start.
        const parsed = locationEventSchema.safeParse({
          title: title ?? current.title,
          startTime: startTime ?? current.startTime,
          endTime: endTime ?? current.endTime ?? "",
          categoryId: categoryId ?? current.categoryId ?? "",
          notes: notes ?? current.notes ?? "",
        });
        if (!parsed.success) {
          return {
            content: [{ type: "text" as const, text: `Error: ${zodErrorMessage(parsed.error)}` }],
            isError: true,
          };
        }
        await prisma.locationEvent.update({
          where: { id: eventId },
          data: {
            title: parsed.data.title,
            startTime: parsed.data.startTime,
            endTime: parsed.data.endTime ?? null,
            categoryId: parsed.data.categoryId ?? null,
            notes: parsed.data.notes || null,
          },
        });
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: true, id: eventId }, null, 2) },
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

  // ── delete-location-event (PLANNER+) ───────────────────────────────────
  server.registerTool(
    "delete-location-event",
    {
      title: "Delete Location Event",
      description:
        "Remove a location's standing event (eventId from get-location's events). Schedule items already added from it stay on their days.",
      inputSchema: { eventId: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ eventId }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return {
          content: [{ type: "text" as const, text: "Error: Requires PLANNER role or above" }],
          isError: true,
        };
      }
      try {
        await prisma.locationEvent.delete({ where: { id: eventId } });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: true }, null, 2) }],
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
