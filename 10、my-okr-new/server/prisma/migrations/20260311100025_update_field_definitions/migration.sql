-- AlterTable
ALTER TABLE "PlanNode" ADD COLUMN "dataFeedback" TEXT;
ALTER TABLE "PlanNode" ADD COLUMN "issueLog" TEXT;
ALTER TABLE "PlanNode" ADD COLUMN "periodType" TEXT;
ALTER TABLE "PlanNode" ADD COLUMN "planStatus" TEXT;

-- CreateTable
CREATE TABLE "PushHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
