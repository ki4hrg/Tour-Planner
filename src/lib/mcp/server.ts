import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionUser } from "@/lib/authz";
import { registerTripTools } from "./tools/trips";
import { registerItineraryTools } from "./tools/itinerary";
import { registerBookingTools } from "./tools/bookings";
import { registerLocationTools } from "./tools/locations";
import { registerStayTools } from "./tools/stays";

export function createMcpServer(user: SessionUser): McpServer {
  const server = new McpServer({
    name: "Tour Planner",
    version: "1.0.0",
  });

  registerTripTools(server, user);
  registerItineraryTools(server, user);
  registerBookingTools(server, user);
  registerLocationTools(server, user);
  registerStayTools(server, user);

  return server;
}
