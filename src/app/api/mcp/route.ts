import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getMcpUser } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";

export async function POST(request: Request) {
  const user = await getMcpUser(request);
  if (!user) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const server = createMcpServer(user);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  try {
    const body = await request.json();
    const result = await transport.handleRequest(request, body);
    return result;
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function GET() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function DELETE() {
  return new Response("Method Not Allowed", { status: 405 });
}
