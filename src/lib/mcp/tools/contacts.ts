import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";

export function registerContactTools(server: McpServer, user: SessionUser) {
  // ── search-contacts (VIEWER+) ──────────────────────────────────────────
  server.registerTool(
    "search-contacts",
    {
      title: "Search Contacts",
      description:
        "Search contacts by name or organization. Returns contact details and their linked locations. Useful for finding a contact ID when creating a booking, assigning a presenter, or logging a note.",
      inputSchema: {
        query: z.string().optional(),
        limit: z.number().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
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
          content: [
            { type: "text" as const, text: JSON.stringify(contacts, null, 2) },
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

  // ── create-contact (PLANNER+) ──────────────────────────────────────────
  server.registerTool(
    "create-contact",
    {
      title: "Create Contact",
      description:
        "Create a contact (a person at a venue, host site, or supplier). Requires a name; organization, role, email, phone, and notes are optional. Pass locationIds to link the contact to one or more locations (use search-locations to find them).",
      inputSchema: {
        name: z.string(),
        organization: z.string().optional(),
        role: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
        locationIds: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name, organization, role, email, phone, notes, locationIds }) => {
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
        const contact = await prisma.contact.create({
          data: {
            name,
            organization: organization || null,
            role: role || null,
            email: email || null,
            phone: phone || null,
            notes: notes || null,
            locations: locationIds?.length
              ? { connect: locationIds.map((id) => ({ id })) }
              : undefined,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ id: contact.id }, null, 2),
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

  // ── update-contact (PLANNER+) ──────────────────────────────────────────
  server.registerTool(
    "update-contact",
    {
      title: "Update Contact",
      description:
        "Update a contact's details. Only include fields you want to change. Passing locationIds REPLACES the full set of linked locations (pass [] to unlink all). Use search-contacts to find the id.",
      inputSchema: {
        contactId: z.string(),
        name: z.string().optional(),
        organization: z.string().optional(),
        role: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        notes: z.string().optional(),
        locationIds: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      contactId,
      name,
      organization,
      role,
      email,
      phone,
      notes,
      locationIds,
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
        if (organization !== undefined) data.organization = organization || null;
        if (role !== undefined) data.role = role || null;
        if (email !== undefined) data.email = email || null;
        if (phone !== undefined) data.phone = phone || null;
        if (notes !== undefined) data.notes = notes || null;
        if (locationIds !== undefined) {
          data.locations = { set: locationIds.map((id) => ({ id })) };
        }

        await prisma.contact.update({ where: { id: contactId }, data });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, id: contactId }, null, 2),
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
}
