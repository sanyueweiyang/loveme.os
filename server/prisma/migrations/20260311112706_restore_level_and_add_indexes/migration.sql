/*
  Warnings:

  - You are about to drop the column `date` on the `WorkLog` table. All the data in the column will be lost.
  - You are about to drop the column `duration` on the `WorkLog` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `WorkLog` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "relatedNodeId" INTEGER,
    "startTime" DATETIME,
    "endTime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_WorkLog" ("content", "createdAt", "endTime", "id", "relatedNodeId", "startTime") SELECT "content", "createdAt", "endTime", "id", "relatedNodeId", "startTime" FROM "WorkLog";
DROP TABLE "WorkLog";
ALTER TABLE "new_WorkLog" RENAME TO "WorkLog";
CREATE TABLE "new_PlanNode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "priority" TEXT NOT NULL DEFAULT 'P1',
    "parentId" INTEGER,
    "rootId" INTEGER,
    "plannedEndDate" TEXT,
    "actualEndDate" DATETIME,
    "planStatus" TEXT,
    "periodType" TEXT,
    "progress" REAL NOT NULL DEFAULT 0,
    "outputContent" TEXT,
    "dataFeedback" TEXT,
    "issueLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PlanNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlanNode" ("actualEndDate", "createdAt", "dataFeedback", "description", "id", "issueLog", "level", "outputContent", "owner", "parentId", "periodType", "planStatus", "plannedEndDate", "priority", "progress", "rootId", "title", "updatedAt") SELECT "actualEndDate", "createdAt", "dataFeedback", "description", "id", "issueLog", "level", "outputContent", "owner", "parentId", "periodType", "planStatus", "plannedEndDate", "priority", "progress", "rootId", "title", "updatedAt" FROM "PlanNode";
DROP TABLE "PlanNode";
ALTER TABLE "new_PlanNode" RENAME TO "PlanNode";
CREATE INDEX "PlanNode_rootId_idx" ON "PlanNode"("rootId");
CREATE INDEX "PlanNode_periodType_idx" ON "PlanNode"("periodType");
CREATE INDEX "PlanNode_updatedAt_idx" ON "PlanNode"("updatedAt");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;

-- CreateIndex
CREATE INDEX "PushHistory_reportType_reportPeriod_idx" ON "PushHistory"("reportType", "reportPeriod");
