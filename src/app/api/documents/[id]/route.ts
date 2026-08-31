import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/authz";
import { documentResponse, isInlineViewable } from "@/lib/documents";

// Reads the DB per request; never prerender (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

/**
 * Download a stored document. Staff-facing: any signed-in user (VIEWER and up)
 * may read. `src/proxy.ts` already gates this path, but the session is checked
 * here too — this route hands out raw bytes and must never rely on middleware
 * alone.
 *
 * Outside audiences never reach this route; they go through
 * `/api/share/[token]/documents/[id]`, which applies the audience filter.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({
    where: { id },
    select: {
      filename: true,
      contentType: true,
      blob: { select: { bytes: true } },
    },
  });
  if (!doc?.blob) return new Response("Not found", { status: 404 });

  const inline =
    new URL(req.url).searchParams.get("inline") === "1" &&
    isInlineViewable(doc.contentType);

  return documentResponse(doc.blob.bytes, {
    contentType: doc.contentType,
    filename: doc.filename,
    inline,
  });
}
