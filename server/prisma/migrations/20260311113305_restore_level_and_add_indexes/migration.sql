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
    "progress" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
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
CREATE INDEX "PlanNode_status_idx" ON "PlanNode"("status");
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
