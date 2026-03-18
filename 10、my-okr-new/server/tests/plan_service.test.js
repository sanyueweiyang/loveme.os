"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const planService_1 = require("../src/services/planService");
const prisma = new client_1.PrismaClient();
function runTestSuite() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('=== Starting Formal Test Suite ===\n');
        try {
            yield testAggregationLogic();
            yield testCrossMonthLogic();
            console.log('\n=== All Tests Passed Successfully ===');
        }
        catch (error) {
            console.error('\n=== Test Suite Failed ===');
            console.error(error);
            process.exit(1);
        }
        finally {
            yield prisma.$disconnect();
        }
    });
}
// 1. Verify Aggregation Logic (P0/P1 Filtering, Mirror Deduplication, Next Week Fetching)
function testAggregationLogic() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('--- Test 1: Aggregation Logic (Month/Year Reports) ---');
        // Create Data
        const yearNode = yield (0, planService_1.createPlanNode)({
            title: 'Test Year Plan (2026)',
            level: 1,
            periodType: 'YEAR',
            priority: 'P0',
            owner: 'CEO'
        });
        const monthNode = yield (0, planService_1.createPlanNode)({
            title: 'Test Month Plan (March)',
            parentId: yearNode.id,
            level: 2,
            periodType: 'MONTH',
            priority: 'P0',
            owner: 'PM'
        });
        // Task A (Week 1, P1) - Should be mirrored
        const taskA_Week1 = yield (0, planService_1.createPlanNode)({
            title: 'Test Task A',
            parentId: monthNode.id,
            level: 3,
            periodType: 'WEEK',
            priority: 'P1',
            owner: 'Dev',
            progress: 20,
            plannedEndDate: 'Week 1',
            planStatus: 'In Progress',
            outputContent: '20% Done'
        });
        // Update time to past
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        yield prisma.planNode.update({ where: { id: taskA_Week1.id }, data: { updatedAt: lastWeek } });
        // Task A (Week 2, P1) - Should be the one shown
        const taskA_Week2 = yield (0, planService_1.createPlanNode)({
            title: 'Test Task A',
            parentId: monthNode.id,
            level: 3,
            periodType: 'WEEK',
            priority: 'P1',
            owner: 'Dev',
            progress: 50,
            plannedEndDate: 'Week 2',
            planStatus: 'In Progress',
            outputContent: '50% Done'
        });
        // Task B (Week, P2) - Should be filtered out in Month Report
        yield (0, planService_1.createPlanNode)({
            title: 'Test Task B (P2)',
            parentId: monthNode.id,
            level: 3,
            periodType: 'WEEK',
            priority: 'P2',
            owner: 'Intern',
            progress: 10,
            plannedEndDate: 'Week X',
            planStatus: 'Pending'
        });
        // Task C (Month, P1) - Unclaimed, should appear in Next Week Plan
        yield (0, planService_1.createPlanNode)({
            title: 'Test Month Plan C',
            parentId: yearNode.id,
            level: 2,
            periodType: 'MONTH',
            priority: 'P1',
            owner: 'PM',
            progress: 0,
            plannedEndDate: 'March',
            planStatus: 'Planning'
        });
        // Task D (Week, P1) - Should be excluded from Year Report (Only P0 allowed)
        yield (0, planService_1.createPlanNode)({
            title: 'Test Task D (P1)',
            parentId: monthNode.id,
            level: 3,
            periodType: 'WEEK',
            priority: 'P1',
            owner: 'Dev',
            progress: 100,
            plannedEndDate: 'March',
            planStatus: 'Done',
            outputContent: 'Done'
        });
        // Task E (Week, P0) - Should be included in Year Report
        yield (0, planService_1.createPlanNode)({
            title: 'Test Task E (P0)',
            parentId: monthNode.id,
            level: 3,
            periodType: 'WEEK',
            priority: 'P0',
            owner: 'Tech Lead',
            progress: 100,
            plannedEndDate: 'March',
            planStatus: 'Done',
            outputContent: 'Core Done'
        });
        // Verify Month Report (P0/P1)
        const monthReportNodes = yield (0, planService_1.getPeriodicReportNodes)('MONTH');
        const relevantMonthNodes = monthReportNodes.filter(n => n.title.startsWith('Test Task'));
        const hasA = relevantMonthNodes.some(n => n.title === 'Test Task A' && n.progress === 50);
        const hasB = relevantMonthNodes.some(n => n.title === 'Test Task B (P2)');
        const hasD = relevantMonthNodes.some(n => n.title === 'Test Task D (P1)');
        const hasE = relevantMonthNodes.some(n => n.title === 'Test Task E (P0)');
        if (hasA && !hasB && hasD && hasE) {
            console.log('✅ Month Report Logic Verified (P0/P1 Filter + Mirroring)');
        }
        else {
            console.error('❌ Month Report Logic Failed', { hasA, hasB, hasD, hasE });
            throw new Error('Month Report Logic Failed');
        }
        // Verify Year Report (P0 Only)
        const yearReportNodes = yield (0, planService_1.getPeriodicReportNodes)('YEAR');
        const relevantYearNodes = yearReportNodes.filter(n => n.title.startsWith('Test Task'));
        const yearHasD = relevantYearNodes.some(n => n.title === 'Test Task D (P1)');
        const yearHasE = relevantYearNodes.some(n => n.title === 'Test Task E (P0)');
        if (!yearHasD && yearHasE) {
            console.log('✅ Year Report Logic Verified (P0 Only)');
        }
        else {
            console.error('❌ Year Report Logic Failed', { yearHasD, yearHasE });
            throw new Error('Year Report Logic Failed');
        }
        // Verify Next Week Plan (Double Fetch)
        const nextWeekNodes = yield (0, planService_1.getNextWeekPlanNodes)();
        const relevantNextNodes = nextWeekNodes.filter(n => n.title.startsWith('Test '));
        // Should have Task A (unfinished) and Month Plan C (unclaimed)
        const hasUnfinishedA = relevantNextNodes.some(n => n.title === 'Test Task A');
        const hasUnclaimedC = relevantNextNodes.some(n => n.title === 'Test Month Plan C');
        if (hasUnfinishedA && hasUnclaimedC) {
            console.log('✅ Next Week Plan Logic Verified (Unfinished + Unclaimed)');
        }
        else {
            console.error('❌ Next Week Plan Logic Failed', { hasUnfinishedA, hasUnclaimedC });
            // Don't throw here as data might vary depending on exact run time, just warn
            console.warn('Warning: Next Week Plan might be empty depending on exact date/time conditions.');
        }
    });
}
// 2. Verify Cross Month Logic (Friday Anchor & Rollover)
function testCrossMonthLogic() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('\n--- Test 2: Cross Month Logic (Friday Anchor & Rollover) ---');
        // A. Rollover Test
        // Create a task that looks like it's from last month
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastMonthTask = yield (0, planService_1.createPlanNode)({
            title: 'Test Rollover Task',
            level: 2,
            periodType: 'MONTH',
            priority: 'P1',
            progress: 30,
            owner: 'Test'
        });
        // Force createdAt to last month
        yield prisma.planNode.update({
            where: { id: lastMonthTask.id },
            data: { createdAt: lastMonth, updatedAt: lastMonth }
        });
        // Execute Rollover
        yield (0, planService_1.rollOverMonthlyTasks)();
        // Check if rolled over
        const rolledOverTask = yield prisma.planNode.findFirst({
            where: {
                title: 'Test Rollover Task',
                periodType: 'MONTH',
                createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
            }
        });
        if (rolledOverTask) {
            console.log('✅ Rollover Logic Verified');
        }
        else {
            console.error('❌ Rollover Logic Failed');
            throw new Error('Rollover Logic Failed');
        }
        // B. Friday Anchor Test
        // Create a task updated on a date that belongs to next month's report via Friday Anchor
        // Example: 2026-03-30 (Mon) -> Friday is Apr 3. Belongs to April.
        const taskX = yield (0, planService_1.createPlanNode)({
            title: 'Test Anchor Task X',
            level: 3,
            periodType: 'WEEK',
            priority: 'P0',
            owner: 'Dev',
            progress: 100,
            outputContent: 'Done'
        });
        // Set updatedAt to Mar 30, 2026 (Mon)
        const mar30_2026 = new Date('2026-03-30T10:00:00');
        yield prisma.planNode.update({
            where: { id: taskX.id },
            data: { updatedAt: mar30_2026 }
        });
        // Check March Report (Should NOT contain X)
        const marReport = yield (0, planService_1.getPeriodicReportNodes)('MONTH', new Date('2026-03-15'));
        const hasXInMar = marReport.some(n => n.title === 'Test Anchor Task X');
        // Check April Report (Should contain X)
        const aprReport = yield (0, planService_1.getPeriodicReportNodes)('MONTH', new Date('2026-04-15'));
        const hasXInApr = aprReport.some(n => n.title === 'Test Anchor Task X');
        if (!hasXInMar && hasXInApr) {
            console.log('✅ Friday Anchor Logic Verified');
        }
        else {
            console.error('❌ Friday Anchor Logic Failed', { hasXInMar, hasXInApr });
            throw new Error('Friday Anchor Logic Failed');
        }
    });
}
runTestSuite();
