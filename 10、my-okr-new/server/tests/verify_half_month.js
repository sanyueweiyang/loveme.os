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
function verifyHalfMonthLogic() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('=== Starting Half-Month Report Verification ===\n');
        try {
            // 1. Prepare Data for Half-Month (H1: 1-15)
            console.log('--- Test 1: H1 Report (1st-15th) - Full Coverage ---');
            // Create Year/Month Root
            const yearNode = yield (0, planService_1.createPlanNode)({ title: '2026 Strategy', level: 1, periodType: 'YEAR', priority: 'P0' });
            const monthNode = yield (0, planService_1.createPlanNode)({ title: 'March Ops', parentId: yearNode.id, level: 2, periodType: 'MONTH', priority: 'P0' });
            // Task A (P2) - Should be INCLUDED in H1 (Full Coverage)
            const taskA = yield (0, planService_1.createPlanNode)({
                title: 'H1 Task A (P2)',
                parentId: monthNode.id,
                level: 3,
                periodType: 'WEEK',
                priority: 'P2',
                owner: 'Intern',
                progress: 100,
                outputContent: 'H1 Done'
            });
            // Set date to March 5th (H1)
            yield prisma.planNode.update({
                where: { id: taskA.id },
                data: { updatedAt: new Date('2026-03-05T10:00:00') }
            });
            // Task B (P0) - Should be INCLUDED
            const taskB = yield (0, planService_1.createPlanNode)({
                title: 'H1 Task B (P0)',
                parentId: monthNode.id,
                level: 3,
                periodType: 'WEEK',
                priority: 'P0',
                owner: 'Lead',
                progress: 100,
                outputContent: 'H1 Critical'
            });
            yield prisma.planNode.update({
                where: { id: taskB.id },
                data: { updatedAt: new Date('2026-03-10T10:00:00') }
            });
            // Task C (P0) - Date in H2 (March 20th) - Should be EXCLUDED from H1
            const taskC = yield (0, planService_1.createPlanNode)({
                title: 'H2 Task C (P0)',
                parentId: monthNode.id,
                level: 3,
                periodType: 'WEEK',
                priority: 'P0',
                owner: 'Lead',
                progress: 100,
                outputContent: 'H2 Critical'
            });
            yield prisma.planNode.update({
                where: { id: taskC.id },
                data: { updatedAt: new Date('2026-03-20T10:00:00') }
            });
            // Generate H1 Report
            const h1Nodes = yield (0, planService_1.getPeriodicReportNodes)('HALF_MONTH', new Date('2026-03-10')); // Any date in H1
            const h1Titles = h1Nodes.map(n => n.title);
            console.log('H1 Nodes:', h1Titles);
            if (h1Titles.includes('H1 Task A (P2)') && h1Titles.includes('H1 Task B (P0)') && !h1Titles.includes('H2 Task C (P0)')) {
                console.log('✅ H1 Logic Verified (Full Coverage + Date Range)');
            }
            else {
                console.error('❌ H1 Logic Failed');
                throw new Error('H1 Logic Failed');
            }
            // 2. Test Persistence
            console.log('\n--- Test 2: Report Persistence ---');
            const snapshot = JSON.stringify(h1Nodes);
            yield (0, planService_1.savePushHistory)('# Half Month Report', 'SUCCESS', 'WECHAT', 'HALF_MONTH', '2026-03-H1', snapshot);
            const history = yield (0, planService_1.getPushHistory)({ reportType: 'HALF_MONTH' });
            const latest = history[0];
            if (latest.reportType === 'HALF_MONTH' && latest.reportPeriod === '2026-03-H1' && latest.snapshotData === snapshot) {
                console.log('✅ Persistence Verified');
            }
            else {
                console.error('❌ Persistence Failed');
                throw new Error('Persistence Failed');
            }
            console.log('\n=== All Tests Passed ===');
        }
        catch (error) {
            console.error(error);
        }
        finally {
            yield prisma.$disconnect();
        }
    });
}
verifyHalfMonthLogic();
