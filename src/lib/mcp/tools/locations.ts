import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";

export function registerLocationTools(server: McpServer, user: SessionUser) {
  // ── search-locations (VIEWER+) ─────────────────────────────────────────
  server.tool(
    "search-locations",
    "Search locations by name, region, or trip type. Returns location name, address, region, and whether it's a host site. Use this to find location IDs for schedule items and stays. Excludes archived locations by default.",
    {
      query: z.string().optional(),
      regionId: z.string().optional(),
      tripTypeId: z.string().optional(),
      hostSitesOnly: z.boolean().optional(),
      limit: z.number().optional(),
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
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
  server.tool(
    "get-location",
    "Get full details of a location including contacts, costs, host site capabilities, booking notes, and schedule limitations. Useful before creating a booking or adding a location to an itinerary.",
    { locationId: z.string() },
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
            hostSite: true,
          },
        });

        if (!location) {
          return {
            content: [{ type: "text" as const, text: "Error: Location not found" }],
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
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── search-contacts (VIEWER+) ──────────────────────────────────────────
  server.tool(
    "search-contacts",
    "Search contacts by name or organization. Returns contact details and their linked locations. Useful for finding a contact ID when creating a booking or assigning a presenter.",
    {
      query: z.string().optional(),
      limit: z.number().optional(),
    },
    async ({ query, limit }) => {
      try {
        const where: Record<string, unknown> = {};

        if (query) {
          where.OR = [
            { name: { contains: query, mode: "insensitive" } },
            { organization: { contains: query, mode: "insensitive" } },
          ];
        }

        const contacts = await prisma.contact.findMany({
          where,
          take: limit || 25,
          orderBy: { name: "asc" },
          include: {
            locations: { select: { id: true, name: true } },
          },
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(contacts, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
          isError: true,
        };
      }
    },
  );

  // ── list-trip-types (VIEWER+) ──────────────────────────────────────────
  server.tool(
    "list-trip-types",
    "List all available trip types with their names, descriptions, and default currencies. Use the trip type ID when creating a new trip.",
    {},
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
          content: [{ type: "text" as const, text: JSON.stringify(tripTypes, null, 2) }],
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
