import { PrismaClient } from "@prisma/client";
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

  // --- Wesley Pilgrimage trip type (GBP). Starter locations land in M8. ---
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
  const categories = [
    { name: "Visit", color: "#2e5e4e", sortOrder: 10 },
    { name: "Presentation", color: "#a9762f", sortOrder: 20 },
    { name: "Meal", color: "#9b342b", sortOrder: 30 },
    { name: "Travel", color: "#6b7269", sortOrder: 40 },
    { name: "Free time", color: "#46685c", sortOrder: 50 },
    { name: "Reception", color: "#7c5a9e", sortOrder: 60 },
    { name: "Worship", color: "#3b6ea5", sortOrder: 70 },
    { name: "Accommodation", color: "#8a6d3b", sortOrder: 80 },
    { name: "Other", color: null, sortOrder: 90 },
  ];
  for (const c of categories) {
    await prisma.scheduleItemCategory.upsert({
      where: { name: c.name },
      update: {},
      create: c,
    });
  }
  console.log(`Seeded ${categories.length} schedule-item categories.`);
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
