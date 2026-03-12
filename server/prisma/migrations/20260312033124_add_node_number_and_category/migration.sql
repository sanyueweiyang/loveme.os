/*
  Warnings:

  - A unique constraint covering the columns `[nodeNumber]` on the table `PlanNode` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "PlanNode" ADD COLUMN "nodeNumber" TEXT;
ALTER TABLE "PlanNode" ADD COLUMN "planCategory" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PlanNode_nodeNumber_key" ON "PlanNode"("nodeNumber");
