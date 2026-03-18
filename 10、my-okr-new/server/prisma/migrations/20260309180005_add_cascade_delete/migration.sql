-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlanNode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "progress" REAL NOT NULL DEFAULT 0.0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "owner" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'P1',
    "parentId" INTEGER,
    "rootId" INTEGER,
    "outputContent" TEXT,
    "plannedEndDate" TEXT,
    "actualEndDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PlanNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlanNode" ("actualEndDate", "createdAt", "description", "id", "level", "outputContent", "owner", "parentId", "plannedEndDate", "priority", "progress", "rootId", "title", "updatedAt") SELECT "actualEndDate", "createdAt", "description", "id", "level", "outputContent", "owner", "parentId", "plannedEndDate", "priority", "progress", "rootId", "title", "updatedAt" FROM "PlanNode";
DROP TABLE "PlanNode";
ALTER TABLE "new_PlanNode" RENAME TO "PlanNode";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
