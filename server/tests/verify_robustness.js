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
function verifyRobustness() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log('=== Starting Robustness Verification ===\n');
        try {
            // 1. Verify Title Cascade Update
            console.log('--- Test 1: Title Cascade Update ---');
            // Setup: Parent -> Child (Same Title)
            const parent = yield (0, planService_1.createPlanNode)({
                title: 'Original Title',
                level: 2,
                periodType: 'MONTH',
                priority: 'P1',
                owner: 'PM'
            });
            const child = yield (0, planService_1.createPlanNode)({
                title: 'Original Title', // Same Title (Claimed)
                parentId: parent.id,
                level: 3,
                periodType: 'WEEK',
                priority: 'P1',
                owner: 'Dev'
            });
            const diffChild = yield (0, planService_1.createPlanNode)({
                title: 'Different Title', // Different Title (Should NOT update)
                parentId: parent.id,
                level: 3,
                periodType: 'WEEK',
                priority: 'P1',
                owner: 'Dev'
            });
            // Update Parent Title
            yield (0, planService_1.updatePlanNode)(parent.id, { title: 'Updated Title' });
            // Check Children
            const updatedChild = yield prisma.planNode.findUnique({ where: { id: child.id } });
            const updatedDiffChild = yield prisma.planNode.findUnique({ where: { id: diffChild.id } });
            if ((updatedChild === null || updatedChild === void 0 ? void 0 : updatedChild.title) === 'Updated Title' && (updatedDiffChild === null || updatedDiffChild === void 0 ? void 0 : updatedDiffChild.title) === 'Different Title') {
                console.log('✅ Title Cascade Verified');
            }
            else {
                console.error('❌ Title Cascade Failed', {
                    child: updatedChild === null || updatedChild === void 0 ? void 0 : updatedChild.title,
                    diffChild: updatedDiffChild === null || updatedDiffChild === void 0 ? void 0 : updatedDiffChild.title
                });
                throw new Error('Title Cascade Failed');
            }
            // 2. Verify Empty Value Protection
            console.log('\n--- Test 2: Empty Value Protection ---');
            const nodeWithEmpty = Object.assign(Object.assign({}, updatedChild), { dataFeedback: '', issueLog: '   ', plannedEndDate: 'Test Date', planStatus: 'Normal' });
            const report = (0, reportGenerator_1.generateWeeklyReportCopy)(nodeWithEmpty, 1);
            console.log('Report Output:');
            console.log(report);
            if (!report.includes('[数据情况]') && !report.includes('[问题反馈]')) {
                console.log('✅ Empty Value Protection Verified');
            }
            else {
                console.error('❌ Empty Value Protection Failed');
                throw new Error('Empty Value Protection Failed');
            }
            // 3. Verify Holiday Gap Tracing
            console.log('\n--- Test 3: Holiday Gap Tracing (Backtracking) ---');
            // Create a task updated 3 weeks ago (Holiday Gap)
            // It is unfinished (50%)
            const holidayTask = yield (0, planService_1.createPlanNode)({
                title: 'Holiday Task (Gap)',
                level: 3,
                periodType: 'WEEK',
                priority: 'P0',
                owner: 'Dev',
                progress: 50,
                outputContent: 'Before Holiday'
            });
            const threeWeeksAgo = new Date();
            threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
            yield prisma.planNode.update({
                where: { id: holidayTask.id },
                data: { updatedAt: threeWeeksAgo }
            });
            // Generate Next Week Plan
            // Should pick up this task even though it's old
            const nextWeekNodes = yield (0, planService_1.getNextWeekPlanNodes)();
            const hasHolidayTask = nextWeekNodes.some(n => n.title === 'Holiday Task (Gap)');
            const preservedProgress = (_a = nextWeekNodes.find(n => n.title === 'Holiday Task (Gap)')) === null || _a === void 0 ? void 0 : _a.progress;
            if (hasHolidayTask && preservedProgress === 50) {
                console.log('✅ Holiday Gap Tracing Verified (Task found + Progress preserved)');
            }
            else {
                console.error('❌ Holiday Gap Tracing Failed', { hasHolidayTask, preservedProgress });
                throw new Error('Holiday Gap Tracing Failed');
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
verifyRobustness();
