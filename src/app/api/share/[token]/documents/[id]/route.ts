import { prisma } from "@/lib/db";
import { todayUtc } from "@/lib/dates";
import { isOrphanedScopedLink, isShareLinkActive } from "@/lib/share";
import {
  documentResponse,
  isInlineViewable,
  visibleToShareAudience,
} from "@/lib/documents";
import { shareDocumentWhere } from "@/lib/share-documents";

// Reads the DB per request; never prerender (no DATABASE_URL at build time).
export const dynamic = "force-dynamic";

/**
 * Download a document through a share link — the only path by which an outside
 * audience reaches stored bytes.
 *
 * Two gates, both required: the document must be one this link's trip (and, for
 * a host-site link, its scoped venue) actually reaches, and it must have been
 * released to the link's audience. An unknown, disabled or expired token 404s
 * exactly like the share page — the token is the only capability, so a wrong
 * one and a switched-off one must look identical.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;

  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: {
      tripId: true,
      locationId: true,
      audience: true,
      enabled: true,
      expiresAt: true,
    },
  });
  if (
    !link ||
    !isShareLinkActive(link, todayUtc()) ||
    isOrphanedScopedLink(link.audience, link.locationId)
  ) {
    return new Response("Not found", { status: 404 });
  }

  const doc = await prisma.document.findFirst({
    where: {
      id,
      ...shareDocumentWhere(link),
    },
    select: {
      filename: true,
      contentType: true,
      shareAudiences: true,
      blob: { select: { bytes: true } },
    },
  });
  // Audience release is re-checked in code as well as SQL: this route is the
  // last thing between a public token and private bytes.
  if (!doc?.blob || !visibleToShareAudience(doc, link.audience)) {
    return new Response("Not found", { status: 404 });
  }

  const inline =
    new URL(req.url).searchParams.get("inline") === "1" &&
    isInlineViewable(doc.contentType);

  return documentResponse(doc.blob.bytes, {
    contentType: doc.contentType,
    filename: doc.filename,
    inline,
  });
}
