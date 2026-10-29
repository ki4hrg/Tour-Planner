import { PrismaClient, type ScheduleItemKind } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Optional admin override ---
  // By default the first admin is created via the in-app /setup flow. Only
  // pre-seed one when BOTH email and password are explicitly provided.
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const name = process.env.SEED_ADMIN_NAME ?? "Trip Admin";
    const passwordHash = await bcrypt.hash(password, 10);
    const admin = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, passwordHash, role: "ADMIN" },
    });
    console.log(`Seeded admin user: ${admin.email}`);
  } else {
    console.log("No SEED_ADMIN_* provided — first admin will be created via /setup.");
  }

  // --- Wesley Pilgrimage trip type (GBP). ---
  const wesley = await prisma.tripType.upsert({
    where: { name: "Wesley Pilgrimage" },
    update: {},
    create: {
      name: "Wesley Pilgrimage",
      description:
        "The recurring John & Charles Wesley Pilgrimage through England.",
      color: "#7c3aed",
      defaultCurrency: "GBP",
    },
  });
  console.log(`Seeded trip type: ${wesley.name}`);

  // --- Schedule-item categories (admin-configurable; the migration seeds these
  // too, but upsert here keeps fresh/`db push` databases consistent). ---
  const categories: {
    name: string;
    color: string | null;
    sortOrder: number;
    system?: boolean;
    kind?: ScheduleItemKind;
  }[] = [
    { name: "Visit", color: "#2e5e4e", sortOrder: 10, system: true, kind: "VISIT" },
    { name: "Presentation", color: "#a9762f", sortOrder: 20, system: true, kind: "PRESENTATION" },
    { name: "Meal", color: "#9b342b", sortOrder: 30, system: true, kind: "MEAL" },
    { name: "Travel", color: "#6b7269", sortOrder: 40, system: true, kind: "TRAVEL" },
    { name: "Free time", color: "#46685c", sortOrder: 50, system: true, kind: "FREE" },
    { name: "Break", color: "#5f7a6a", sortOrder: 55, system: true, kind: "FREE" },
    { name: "Reception", color: "#7c5a9e", sortOrder: 60 },
    { name: "Worship", color: "#3b6ea5", sortOrder: 70 },
    { name: "Accommodation", color: "#8a6d3b", sortOrder: 80 },
    { name: "Other", color: null, sortOrder: 90 },
  ];
  for (const c of categories) {
    await prisma.scheduleItemCategory.upsert({
      where: { name: c.name },
      // Backfill the `system` flag + kind on the built-ins for DBs that already
      // had these rows from an earlier seed; leave user-editable rows untouched.
      update: c.system ? { system: true, kind: c.kind } : {},
      create: { ...c, system: c.system ?? false, kind: c.kind ?? "OTHER" },
    });
  }
  console.log(`Seeded ${categories.length} schedule-item categories.`);

  // --- Starter reference locations (M8). Canonical Wesley pilgrimage sites,
  // tagged to the trip type so the itinerary site-picker defaults to them.
  // Location.name isn't unique, so we find-or-create by name; existing rows are
  // only re-tagged + given a region if they don't already have one (never clobber
  // admin edits — db:seed is reference data, safe to re-run). ---
  const england =
    (await prisma.region.findFirst({
      where: { name: "England", parentId: null },
    })) ??
    (await prisma.region.create({
      data: { name: "England", tripTypes: { connect: { id: wesley.id } } },
    }));

  const starterLocations: {
    name: string;
    address: string;
    description: string;
  }[] = [
    {
      name: "Epworth Old Rectory",
      address: "1 Rectory St, Epworth, Doncaster DN9 1HX",
      description:
        "The Wesley family home where John and Charles grew up.",
    },
    {
      name: "Wesley's Chapel & Leysian Mission",
      address: "49 City Rd, London EC1Y 1AU",
      description: "John Wesley's London base — his house, chapel, and tomb.",
    },
    {
      name: "The New Room",
      address: "36 The Horsefair, Broadmead, Bristol BS1 3JE",
      description: "The oldest Methodist building in the world.",
    },
    {
      name: "Gwennap Pit",
      address: "Busveal, Redruth TR16 5HH",
      description:
        "Open-air amphitheatre where Wesley preached to thousands.",
    },
  ];
  for (const loc of starterLocations) {
    const existing = await prisma.location.findFirst({
      where: { name: loc.name },
    });
    if (existing) {
      await prisma.location.update({
        where: { id: existing.id },
        data: {
          tripTypes: { connect: { id: wesley.id } },
          ...(existing.regionId == null ? { regionId: england.id } : {}),
        },
      });
    } else {
      await prisma.location.create({
        data: {
          ...loc,
          regionId: england.id,
          tripTypes: { connect: { id: wesley.id } },
        },
      });
    }
  }
  console.log(
    `Seeded ${starterLocations.length} starter locations in ${england.name}.`,
  );
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
