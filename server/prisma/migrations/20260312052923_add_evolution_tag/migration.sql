/*
  Warnings:

  - You are about to drop the column `outputContent` on the `PlanNode` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA foreign_keys=OFF;
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
    "planCategoryCode" TEXT,
    "objectiveCode" TEXT,
    "krCode" TEXT,
    "detail1Code" TEXT,
    "detail2Code" TEXT,
    "monthCode" TEXT,
    "weekCode" TEXT,
    "nodeNumber" TEXT,
    "planCategory" TEXT,
    "targetDate" DATETIME,
    "progress" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "dataFeedback" TEXT,
    "issueLog" TEXT,
    "evolutionTag" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PlanNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PlanNode" ("actualEndDate", "createdAt", "dataFeedback", "description", "detail1Code", "detail2Code", "id", "issueLog", "krCode", "level", "monthCode", "nodeNumber", "objectiveCode", "owner", "parentId", "periodType", "planCategory", "planCategoryCode", "planStatus", "plannedEndDate", "priority", "progress", "rootId", "status", "targetDate", "title", "updatedAt", "weekCode") SELECT "actualEndDate", "createdAt", "dataFeedback", "description", "detail1Code", "detail2Code", "id", "issueLog", "krCode", "level", "monthCode", "nodeNumber", "objectiveCode", "owner", "parentId", "periodType", "planCategory", "planCategoryCode", "planStatus", "plannedEndDate", "priority", "progress", "rootId", "status", "targetDate", "title", "updatedAt", "weekCode" FROM "PlanNode";
DROP TABLE "PlanNode";
ALTER TABLE "new_PlanNode" RENAME TO "PlanNode";
CREATE UNIQUE INDEX "PlanNode_nodeNumber_key" ON "PlanNode"("nodeNumber");
CREATE INDEX "PlanNode_rootId_idx" ON "PlanNode"("rootId");
CREATE INDEX "PlanNode_periodType_idx" ON "PlanNode"("periodType");
CREATE INDEX "PlanNode_updatedAt_idx" ON "PlanNode"("updatedAt");
CREATE INDEX "PlanNode_status_idx" ON "PlanNode"("status");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
