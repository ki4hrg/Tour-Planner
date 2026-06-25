import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // --- Initial admin user (idempotent) ---
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "changeme123";
  const name = process.env.SEED_ADMIN_NAME ?? "Trip Admin";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash, role: "ADMIN" },
  });
  console.log(`Seeded admin user: ${admin.email}`);

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
