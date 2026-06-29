import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRIP_NAME = "Sample — Wesley Pilgrimage 2026";

// Idempotent: re-running wipes and recreates the one sample trip (and its days /
// items / sites / bookings cascade away). Catalog rows (locations, talks,
// contacts, categories) are looked up / upserted, never duplicated.
async function main() {
  const tripType =
    (await prisma.tripType.findFirst({ where: { name: "Wesley Pilgrimage" } })) ??
    (await prisma.tripType.findFirst());
  if (!tripType) throw new Error("No trip type — run `npm run db:seed` first.");

  const cats = await prisma.scheduleItemCategory.findMany({
    select: { id: true, name: true },
  });
  const cat = (name: string) => {
    const c = cats.find((c) => c.name === name);
    if (!c) throw new Error(`Missing category "${name}" — run the seed.`);
    return c.id;
  };

  // --- Locations (findFirst-or-create; Location.name isn't unique) ---
  const location = async (name: string) => {
    const found = await prisma.location.findFirst({ where: { name } });
    if (found) return found;
    return prisma.location.create({ data: { name } });
  };
  const sarum = await location("Sarum College");
  const cathedral = await location("Salisbury Cathedral");
  const oldSarum = await location("Old Sarum");
  const closeWalk = await location("Cathedral Close");
  // A walk-by stop on the route that never needs a reservation.
  await prisma.location.update({
    where: { id: closeWalk.id },
    data: { bookable: false },
  });

  // --- Contacts + talks (for items that read by their talk title) ---
  const contact = async (name: string, organization?: string) => {
    const found = await prisma.contact.findFirst({ where: { name } });
    if (found) return found;
    return prisma.contact.create({ data: { name, organization } });
  };
  const worthington = await contact("David Worthington", "Sarum College");

  const presentation = async (title: string, presenterId?: string) => {
    const found = await prisma.presentation.findFirst({ where: { title } });
    if (found) return found;
    return prisma.presentation.create({
      data: {
        title,
        defaultPresenters: presenterId
          ? { connect: { id: presenterId } }
          : undefined,
      },
    });
  };
  const learningTalk = await presentation(
    "Wesley & the Methodist Revival",
    worthington.id,
  );
  const qaTalk = await presentation("Q&A Session", worthington.id);

  // --- Wipe + recreate the sample trip ---
  await prisma.trip.deleteMany({ where: { name: TRIP_NAME } });

  // 2026-07-06 (UTC midnight) as the trip start; Day N = start + (N-1).
  const start = new Date(Date.UTC(2026, 6, 6));
  const dayDate = (i: number) =>
    new Date(Date.UTC(2026, 6, 6 + (i - 1)));

  // Each item: [category, title|null, start, end, notes, locationIds[], talkId?, isBlock?]
  type Item = {
    cat: string | null;
    title?: string | null;
    start?: string;
    end?: string;
    notes?: string | null;
    sites?: { id: string }[];
    talk?: string | null;
    isBlock?: boolean;
  };

  const day6: Item[] = [
    { cat: "Worship", title: "Morning Prayer with Eucharist", start: "07:30", end: "08:00", sites: [sarum] },
    { cat: "Meal", title: "Breakfast", start: "08:00", end: "09:00", sites: [sarum] },
    { cat: "Presentation", title: "Learning Session", start: "09:15", end: "10:45", sites: [sarum], talk: learningTalk.id },
    // Break with NO title → label is the category "Break", chip dropped.
    { cat: "Break", title: null, start: "10:45", end: "11:15", notes: "Tea & coffee in the refectory" },
    // No title, has a talk → row leads with the talk title (was the eyesore).
    { cat: "Presentation", title: null, start: "11:15", end: "12:00", sites: [sarum], talk: learningTalk.id },
    { cat: "Presentation", title: null, start: "12:00", end: "13:00", sites: [sarum], talk: qaTalk.id },
    { cat: "Meal", title: "Lunch", start: "13:00", end: "14:00", sites: [sarum] },
    // Free-choice block at two sites → "Choose one: …" run.
    { cat: "Visit", title: "Afternoon excursion", start: "14:30", end: "16:30", sites: [closeWalk, oldSarum], isBlock: true },
    // System category, no location → its own "No location" run.
    { cat: "Free time", title: null, start: "16:30", end: "17:30", notes: "Rest / explore the city" },
    // A different venue → breaks into its own run, then back to Sarum.
    { cat: "Worship", title: "Evensong", start: "17:30", end: "18:00", sites: [cathedral] },
    { cat: "Meal", title: "Supper", start: "18:30", sites: [sarum] },
  ];

  const day7: Item[] = [
    { cat: "Meal", title: "Breakfast", start: "08:00", end: "09:00", sites: [sarum] },
    { cat: "Travel", title: "Depart for the Cathedral", start: "09:15", end: "09:30", notes: "Short walk down the High Street" },
    { cat: "Visit", title: "Guided Cathedral tour", start: "09:30", end: "11:00", sites: [cathedral] },
    { cat: "Visit", title: "Magna Carta & Chapter House", start: "11:00", end: "12:00", sites: [cathedral] },
    { cat: "Meal", title: "Lunch", start: "12:15", end: "13:15", sites: [closeWalk] },
    { cat: "Free time", title: null, start: "13:15", end: "15:00" },
  ];

  const days = [
    { index: 6, title: "Salisbury", items: day6 },
    { index: 7, title: "Salisbury — Cathedral day", items: day7 },
  ];

  const trip = await prisma.trip.create({
    data: {
      name: TRIP_NAME,
      tripTypeId: tripType.id,
      status: "CONFIRMED",
      startDate: start,
      participantCount: 24,
    },
  });

  for (const d of days) {
    const day = await prisma.itineraryDay.create({
      data: {
        tripId: trip.id,
        dayIndex: d.index,
        date: dayDate(d.index),
        title: d.title,
      },
    });
    let order = 1;
    for (const it of d.items) {
      await prisma.scheduleItem.create({
        data: {
          dayId: day.id,
          order: order++,
          categoryId: it.cat ? cat(it.cat) : null,
          title: it.title ?? null,
          startTime: it.start ?? null,
          endTime: it.end ?? null,
          notes: it.notes ?? null,
          isBlock: it.isBlock ?? false,
          presentationId: it.talk ?? null,
          sites: it.sites
            ? {
                create: it.sites.map((s, i) => ({
                  locationId: s.id,
                  order: i,
                })),
              }
            : undefined,
        },
      });
    }
  }

  // A venue engagement for the cathedral — one booking covering every session the
  // trip runs there (Evensong, tours, …), surfaced on the booking dashboard.
  await prisma.booking.create({
    data: {
      tripId: trip.id,
      locationId: cathedral.id,
      status: "CONFIRMED",
      label: "Reserved seating (24)",
      confirmationRef: "SC-4471",
    },
  });

  console.log(`Created "${TRIP_NAME}" — ${days.length} days. Trip id: ${trip.id}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
