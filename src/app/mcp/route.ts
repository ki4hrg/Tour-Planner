import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getBaseUrl, getMcpUser } from "@/lib/mcp/auth";
import { createMcpServer } from "@/lib/mcp/server";

export async function POST(request: Request) {
  const user = await getMcpUser(request);
  if (!user) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${getBaseUrl()}/.well-known/oauth-protected-resource/mcp"`,
      },
    });
  }

  const server = createMcpServer(user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // JSON response mode is required for this per-request handler model.
    // In the default SSE mode, handleRequest() returns the streaming Response
    // immediately and writes the JSON-RPC reply asynchronously — but we close
    // the transport in `finally` as soon as it returns, tearing the stream
    // down before anything is written. JSON mode makes handleRequest() resolve
    // only once the full response is built, so the close is safe.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
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
