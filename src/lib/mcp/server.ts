import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionUser } from "@/lib/authz";
import { registerTripTools } from "./tools/trips";
import { registerItineraryTools } from "./tools/itinerary";
import { registerBookingTools } from "./tools/bookings";
import { registerLocationTools } from "./tools/locations";
import { registerContactTools } from "./tools/contacts";
import { registerPresentationTools } from "./tools/presentations";
import { registerStayTools } from "./tools/stays";
import { registerNoteTools } from "./tools/notes";
import { registerDocumentTools } from "./tools/documents";

export function createMcpServer(user: SessionUser): McpServer {
  const server = new McpServer({
    name: "Tour Planner",
    version: "1.0.0",
  });

  registerTripTools(server, user);
  registerItineraryTools(server, user);
  registerBookingTools(server, user);
  registerLocationTools(server, user);
  registerContactTools(server, user);
  registerPresentationTools(server, user);
  registerStayTools(server, user);
  registerNoteTools(server, user);
  registerDocumentTools(server, user);

  return server;
}
