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

  // --- Wesley Pilgrimage trip type (GBP). Starter sites land in M8. ---
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
