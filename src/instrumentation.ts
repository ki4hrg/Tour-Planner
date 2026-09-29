// Runs once per server start. Background jobs are Node-only (Prisma), so skip
// the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPlaceRefreshScheduler } = await import("@/lib/place-refresh");
    startPlaceRefreshScheduler();
  }
}
