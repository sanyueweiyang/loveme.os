-- CreateTable
CREATE TABLE "ScheduleNode" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "relatedPlanId" INTEGER,
    "title" TEXT,
    "remark" TEXT,
    "isMerged" BOOLEAN NOT NULL DEFAULT false,
    "span" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScheduleNode_relatedPlanId_fkey" FOREIGN KEY ("relatedPlanId") REFERENCES "PlanNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailySummary" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" TEXT NOT NULL,
    "mit" TEXT,
    "aiSummary" TEXT,
    "aiAudit" TEXT,
    "score" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ScheduleNode_date_idx" ON "ScheduleNode"("date");

-- CreateIndex
CREATE INDEX "ScheduleNode_relatedPlanId_idx" ON "ScheduleNode"("relatedPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "DailySummary_date_key" ON "DailySummary"("date");
