import { getBaseUrl } from "@/lib/mcp/auth";

export async function GET() {
  const base = getBaseUrl();
  return Response.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ["mcp:read", "mcp:write", "mcp:admin"],
  });
}
