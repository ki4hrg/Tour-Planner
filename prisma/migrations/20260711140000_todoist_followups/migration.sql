-- Todoist follow-up integration: a per-user account connection (personal-token
-- now, OAuth-shaped for later), per-trip and per-trip-type project routing, and
-- the pushed task id on Note. Purely additive.

-- CreateEnum
CREATE TYPE "TodoistAuthType" AS ENUM ('PERSONAL_TOKEN', 'OAUTH');

-- CreateTable
CREATE TABLE "TodoistConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authType" "TodoistAuthType" NOT NULL DEFAULT 'PERSONAL_TOKEN',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "defaultProjectId" TEXT,
    "lastReconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TodoistConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripTodoistLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "todoistProjectId" TEXT NOT NULL,

    CONSTRAINT "TripTodoistLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripTypeTodoistLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripTypeId" TEXT NOT NULL,
    "todoistProjectId" TEXT NOT NULL,

    CONSTRAINT "TripTypeTodoistLink_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Note" ADD COLUMN "todoistTaskId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "TodoistConnection_userId_key" ON "TodoistConnection"("userId");
CREATE UNIQUE INDEX "TripTodoistLink_userId_tripId_key" ON "TripTodoistLink"("userId", "tripId");
CREATE INDEX "TripTodoistLink_tripId_idx" ON "TripTodoistLink"("tripId");
CREATE UNIQUE INDEX "TripTypeTodoistLink_userId_tripTypeId_key" ON "TripTypeTodoistLink"("userId", "tripTypeId");
CREATE INDEX "TripTypeTodoistLink_tripTypeId_idx" ON "TripTypeTodoistLink"("tripTypeId");

-- AddForeignKey
ALTER TABLE "TodoistConnection" ADD CONSTRAINT "TodoistConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripTodoistLink" ADD CONSTRAINT "TripTodoistLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripTodoistLink" ADD CONSTRAINT "TripTodoistLink_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripTypeTodoistLink" ADD CONSTRAINT "TripTypeTodoistLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TripTypeTodoistLink" ADD CONSTRAINT "TripTypeTodoistLink_tripTypeId_fkey" FOREIGN KEY ("tripTypeId") REFERENCES "TripType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
