import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/authz";
import { hasRole } from "@/lib/authz";
import {
  documentTarget,
  formatFileSize,
  resolveContentType,
  sanitizeFilename,
} from "@/lib/documents";
import {
  DOCUMENT_KINDS,
  DOCUMENT_SHARE_AUDIENCES,
  DOCUMENT_TARGETS,
  MAX_DOCUMENT_BYTES,
  type DocumentTarget,
} from "@/lib/validators/document";

// Map a polymorphic target to its FK column.
function targetColumn(
  target: DocumentTarget,
): "locationId" | "bookingId" | "tripId" | "stayId" {
  return `${target}Id` as const;
}

function unauthorized(text: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${text}` }],
    isError: true,
  };
}

// The relations documentTarget needs to say where a file is filed.
const TARGET_SELECT = {
  location: { select: { id: true, name: true } },
  booking: {
    select: {
      label: true,
      locationId: true,
      location: { select: { name: true } },
      trip: { select: { id: true, name: true } },
      scheduleItem: {
        select: {
          day: { select: { trip: { select: { id: true, name: true } } } },
        },
      },
    },
  },
  trip: { select: { id: true, name: true } },
  stay: {
    select: {
      id: true,
      trip: { select: { id: true, name: true } },
      location: { select: { name: true } },
    },
  },
} as const;

export function registerDocumentTools(server: McpServer, user: SessionUser) {
  // ── list-documents (VIEWER+) ──────────────────────────────────────────
  server.registerTool(
    "list-documents",
    {
      title: "List Documents",
      description:
        "List stored files (contracts, invoices, printable itineraries, rosters, permits). Filter by target ('location' | 'booking' | 'trip' | 'stay') plus the matching id (from search-locations / list-bookings / list-trips / list-stays), and/or by kind. Omit both to list everything, newest first. Returns metadata plus a downloadUrl that needs an authenticated session — it does NOT return the file's bytes. shareAudiences lists the non-staff share-link audiences the file has been released to (empty = staff only).",
      inputSchema: {
        target: z.enum(DOCUMENT_TARGETS).optional(),
        targetId: z.string().optional(),
        kind: z.enum(DOCUMENT_KINDS).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ target, targetId, kind, limit }) => {
      try {
        if (!hasRole(user.role, "VIEWER")) {
          return unauthorized("Not authorized");
        }
        if ((target && !targetId) || (targetId && !target)) {
          return unauthorized("Pass target and targetId together, or neither.");
        }

        const documents = await prisma.document.findMany({
          where: {
            ...(target && targetId ? { [targetColumn(target)]: targetId } : {}),
            ...(kind ? { kind } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: limit ?? 50,
          select: {
            id: true,
            title: true,
            description: true,
            kind: true,
            filename: true,
            contentType: true,
            size: true,
            shareAudiences: true,
            createdAt: true,
            uploadedBy: { select: { name: true, email: true } },
            ...TARGET_SELECT,
          },
        });

        const result = documents.map((d) => {
          const where = documentTarget(d);
          return {
            id: d.id,
            title: d.title,
            description: d.description,
            kind: d.kind,
            filename: d.filename,
            contentType: d.contentType,
            size: d.size,
            sizeLabel: formatFileSize(d.size),
            shareAudiences: d.shareAudiences,
            filedUnder: where.label,
            uploadedBy: d.uploadedBy?.name ?? d.uploadedBy?.email ?? null,
            createdAt: d.createdAt.toISOString(),
            downloadUrl: `${process.env.AUTH_URL ?? ""}/api/documents/${d.id}`,
          };
        });

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

  // ── add-document (PLANNER+) ───────────────────────────────────────────
  server.registerTool(
    "add-document",
    {
      title: "Add Document",
      description:
        `Store a file against a target ('location' | 'booking' | 'trip' | 'stay') plus the matching id. content is the file's bytes as a base64 string (max ${formatFileSize(MAX_DOCUMENT_BYTES)} decoded); filename decides the stored name and, when contentType is omitted, the type. Accepts PDFs, images, office documents and text files — HTML and SVG are rejected. title defaults to the filename. shareAudiences releases the file to non-staff share links (PARTICIPANT and/or HOST_SITE); omit for staff-only, which is the default and the right choice for anything internal.`,
      inputSchema: {
        target: z.enum(DOCUMENT_TARGETS),
        targetId: z.string(),
        filename: z.string(),
        content: z.string().describe("base64-encoded file bytes"),
        contentType: z.string().optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        kind: z.enum(DOCUMENT_KINDS).optional(),
        shareAudiences: z.array(z.enum(DOCUMENT_SHARE_AUDIENCES)).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({
      target,
      targetId,
      filename,
      content,
      contentType,
      title,
      description,
      kind,
      shareAudiences,
    }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return unauthorized("Requires PLANNER role or above");
      }

      try {
        const name = sanitizeFilename(filename);
        const type = resolveContentType(contentType, name);
        if (!type) {
          return unauthorized(
            "Unsupported file type. Store a PDF, image, office document, or text file.",
          );
        }

        const bytes = Buffer.from(content, "base64");
        if (bytes.byteLength === 0) {
          return unauthorized("content decoded to zero bytes.");
        }
        if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
          return unauthorized(
            `File is ${formatFileSize(bytes.byteLength)}; the limit is ${formatFileSize(MAX_DOCUMENT_BYTES)}.`,
          );
        }

        const doc = await prisma.document.create({
          data: {
            title: title?.trim() || name,
            description: description?.trim() || null,
            kind: kind ?? "OTHER",
            filename: name,
            contentType: type,
            size: bytes.byteLength,
            checksum: createHash("sha256").update(bytes).digest("hex"),
            shareAudiences: shareAudiences ?? [],
            [targetColumn(target)]: targetId,
            uploadedById: user.id,
            blob: { create: { bytes } },
          },
          select: { id: true, title: true, filename: true, size: true },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { ...doc, sizeLabel: formatFileSize(doc.size) },
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

  // ── update-document (PLANNER+) ────────────────────────────────────────
  server.registerTool(
    "update-document",
    {
      title: "Update Document",
      description:
        "Edit a stored file's metadata (documentId from list-documents). Only the fields you pass change; the bytes are immutable, so add-document a new file to replace one. Passing shareAudiences REPLACES the released-to set — pass [] to pull a file back to staff only.",
      inputSchema: {
        documentId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        kind: z.enum(DOCUMENT_KINDS).optional(),
        shareAudiences: z.array(z.enum(DOCUMENT_SHARE_AUDIENCES)).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ documentId, title, description, kind, shareAudiences }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return unauthorized("Requires PLANNER role or above");
      }

      try {
        const doc = await prisma.document.update({
          where: { id: documentId },
          data: {
            ...(title !== undefined ? { title: title.trim() } : {}),
            ...(description !== undefined
              ? { description: description.trim() || null }
              : {}),
            ...(kind !== undefined ? { kind } : {}),
            ...(shareAudiences !== undefined ? { shareAudiences } : {}),
          },
          select: {
            id: true,
            title: true,
            kind: true,
            shareAudiences: true,
          },
        });

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(doc, null, 2) },
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

  // ── delete-document (PLANNER+) ────────────────────────────────────────
  server.registerTool(
    "delete-document",
    {
      title: "Delete Document",
      description:
        "Permanently delete a stored file and its bytes (documentId from list-documents). There is no archive and no undo — confirm with the user before calling this on anything they didn't just upload.",
      inputSchema: { documentId: z.string() },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ documentId }) => {
      if (!hasRole(user.role, "PLANNER")) {
        return unauthorized("Requires PLANNER role or above");
      }

      try {
        const doc = await prisma.document.delete({
          where: { id: documentId },
          select: { id: true, title: true, filename: true },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ deleted: doc }, null, 2),
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
