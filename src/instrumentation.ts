// Runs once per server start. Background jobs are Node-only (Prisma), so skip
// the Edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPlaceRefreshScheduler } = await import("@/lib/place-refresh");
    startPlaceRefreshScheduler();
    // One booking per venue per trip: fold any per-session venue bookings
    // left from before engagements (idempotent; a no-op once clean).
    const { foldAllSessionBookings } = await import("@/lib/session-booking-fold");
    foldAllSessionBookings()
      .then((n) => {
        if (n > 0) console.log(`Folded ${n} session booking(s) into venue bookings.`);
      })
      .catch((e) => console.error("Session booking fold failed:", e));
  }
}
