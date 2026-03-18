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
const reportGenerator_1 = require("../src/utils/reportGenerator");
const prisma = new client_1.PrismaClient();
function verifyCrossMonthLogic() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('--- 开始跨月归属与滚动验证 ---');
        // 1. 模拟时间场景
        // 假设当前是 4月3日 (周五)，属于4月。
        // 上个月是 3月。
        // 清理数据 (Optional, but let's rely on new data)
        // A. 造数据：3月未完成的任务 (Month Node)
        // Create Year Node
        const yearNode = yield (0, planService_1.createPlanNode)({
            title: '2026 年度计划',
            level: 1,
            periodType: 'YEAR',
            priority: 'P0',
            owner: 'CEO'
        });
        // Create March Month Node (Unfinished)
        // Manually set createdAt to March 1st
        const marchDate = new Date('2026-03-01');
        const marchTask = yield (0, planService_1.createPlanNode)({
            title: '3月未完任务 (P0)',
            parentId: yearNode.id,
            level: 2,
            periodType: 'MONTH',
            priority: 'P0',
            owner: 'PM',
            progress: 50,
            planStatus: '进行中'
        });
        // Update createdAt to March
        yield prisma.planNode.update({
            where: { id: marchTask.id },
            data: { createdAt: marchDate, updatedAt: new Date('2026-03-20') }
        });
        console.log('Created March Unfinished Task (50%)');
        // B. 验证跨月滚动 (Rollover)
        // 假设现在是 4月1日，触发滚动
        // Mock Date for the function? The function uses `new Date()`.
        // We can't easily mock `new Date()` inside the service without dependency injection or system time change.
        // Workaround: We will manually call the logic or modify the service temporarily? 
        // No, `rollOverMonthlyTasks` uses `new Date()`. 
        // Let's assume the system time is correct (today is 2026-03-11).
        // Wait, if today is 2026-03-11, last month is Feb.
        // The user requirement is logic verification.
        // Let's modify `rollOverMonthlyTasks` to accept a `date` parameter for testing, or trust the logic logic I wrote.
        // actually, I can just create a "Feb" task and see if it rolls to "March" (Current).
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const lastMonthTask = yield (0, planService_1.createPlanNode)({
            title: '上月遗留任务 (Test)',
            parentId: yearNode.id,
            level: 2,
            periodType: 'MONTH',
            priority: 'P1',
            progress: 30,
            owner: 'Test'
        });
        yield prisma.planNode.update({
            where: { id: lastMonthTask.id },
            data: { createdAt: lastMonth, updatedAt: lastMonth }
        });
        console.log(`Created Last Month Task: ${lastMonth.getMonth() + 1}月任务`);
        console.log('Executing Rollover...');
        yield (0, planService_1.rollOverMonthlyTasks)();
        // Verify Rollover
        const currentMonthTasks = yield prisma.planNode.findMany({
            where: {
                title: '上月遗留任务 (Test)',
                periodType: 'MONTH',
                createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
            }
        });
        if (currentMonthTasks.length > 0) {
            console.log('✅ Success: Task rolled over to current month.');
        }
        else {
            console.log('❌ Failed: Task did not roll over.');
        }
        // C. 验证周报归属 (Friday Anchor)
        // Scenario: 
        // Task X updated on Mar 30 (Mon). Friday is Apr 3.
        // Should appear in April Report, NOT March Report.
        // Create Task X (Week)
        const taskX = yield (0, planService_1.createPlanNode)({
            title: '跨月周报任务 X',
            parentId: marchTask.id, // Parent doesn't matter much for aggregation
            level: 3,
            periodType: 'WEEK',
            priority: 'P0',
            owner: 'Dev',
            progress: 100,
            outputContent: '跨月测试完成'
        });
        // Set updatedAt to Mar 30, 2026 (Mon)
        // 2026-03-30 is Monday.
        const mar30_2026 = new Date('2026-03-30T10:00:00');
        yield prisma.planNode.update({
            where: { id: taskX.id },
            data: { updatedAt: mar30_2026 }
        });
        // Get March Report (Should NOT contain Task X)
        // March 2026
        const marDate = new Date('2026-03-15');
        const marReport = yield (0, planService_1.getPeriodicReportNodes)('MONTH', marDate);
        const hasXInMar = marReport.some(n => n.title === '跨月周报任务 X');
        console.log(`March Report contains Task X? ${hasXInMar} (Expected: false)`);
        // Get April Report (Should contain Task X)
        // April 2026
        const aprDate = new Date('2026-04-15');
        const aprReport = yield (0, planService_1.getPeriodicReportNodes)('MONTH', aprDate);
        const hasXInApr = aprReport.some(n => n.title === '跨月周报任务 X');
        console.log(`April Report contains Task X? ${hasXInApr} (Expected: true)`);
        // Output report for visual check
        if (hasXInApr) {
            console.log('April Report Output:');
            console.log((0, reportGenerator_1.generateWeeklyReportCopy)(aprReport.find(n => n.title === '跨月周报任务 X'), 1));
        }
        console.log('--- 验证结束 ---');
    });
}
verifyCrossMonthLogic()
    .catch(console.error)
    .finally(() => __awaiter(void 0, void 0, void 0, function* () { return yield prisma.$disconnect(); }));
