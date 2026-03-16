-- RedefineTables
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WorkLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "relatedNodeId" INTEGER,
    "startTime" DATETIME,
    "endTime" DATETIME,
    "durationMinutes" INTEGER,
    "priority" TEXT,
    "businessDate" TEXT NOT NULL,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_WorkLog" ("businessDate", "confidence", "content", "createdAt", "durationMinutes", "endTime", "id", "priority", "relatedNodeId", "startTime") SELECT "businessDate", "confidence", "content", "createdAt", "durationMinutes", "endTime", "id", "priority", "relatedNodeId", "startTime" FROM "WorkLog";
DROP TABLE "WorkLog";
ALTER TABLE "new_WorkLog" RENAME TO "WorkLog";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
