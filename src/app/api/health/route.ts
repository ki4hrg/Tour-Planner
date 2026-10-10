// Liveness probe for the Docker healthcheck. Public (excluded from the auth
// proxy matcher) and deliberately does not touch the DB.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { status: 200 });
}
