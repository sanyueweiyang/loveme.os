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
    "businessDate" TEXT NOT NULL DEFAULT '1970-01-01',
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_WorkLog" ("content", "createdAt", "endTime", "id", "relatedNodeId", "startTime") SELECT "content", "createdAt", "endTime", "id", "relatedNodeId", "startTime" FROM "WorkLog";
DROP TABLE "WorkLog";
ALTER TABLE "new_WorkLog" RENAME TO "WorkLog";
PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
