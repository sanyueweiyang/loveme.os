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
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        console.log('=== START EXECUTION LAYER TEST ===');
        // 1. Cleanup
        yield prisma.planNode.deleteMany({
            where: {
                OR: [
                    { title: { startsWith: '[EXEC-TEST]' } },
                    { nodeNumber: { startsWith: 'F01' } }
                ]
            }
        });
        // 2. Create Planning Hierarchy (L1-L6)
        // L1: F01
        const l1 = yield (0, planService_1.createPlanNode)({
            title: '[EXEC-TEST] Root',
            level: 1,
            planCategory: 'WORK'
        });
        console.log(`L1: ${l1.nodeNumber}`);
        // L2-L6 Chain (Skipping details for brevity, jumping to M)
        // Create L2
        const l2 = yield (0, planService_1.createPlanNode)({ title: '[EXEC-TEST] Obj', level: 2, parentId: l1.id });
        const l3 = yield (0, planService_1.createPlanNode)({ title: '[EXEC-TEST] KR', level: 3, parentId: l2.id });
        const l4 = yield (0, planService_1.createPlanNode)({ title: '[EXEC-TEST] D1', level: 4, parentId: l3.id });
        const l5 = yield (0, planService_1.createPlanNode)({ title: '[EXEC-TEST] D2', level: 5, parentId: l4.id });
        const m = yield (0, planService_1.createPlanNode)({
            title: '[EXEC-TEST] Month Target',
            level: 6,
            parentId: l5.id,
            periodType: 'MONTH'
        });
        console.log(`L6 (Month): ${m.nodeNumber} (DNA END)`);
        // 3. Create Execution Nodes (L7)
        // Week 1
        const w1 = yield (0, planService_1.createPlanNode)({
            title: '[EXEC-TEST] Week 1 Report',
            level: 7,
            parentId: m.id,
            periodType: 'WEEK',
            progress: 0
        });
        console.log(`L7 (Week 1): ${w1.nodeNumber} (Expected: ...M01-W01)`);
        // Week 2
        const w2 = yield (0, planService_1.createPlanNode)({
            title: '[EXEC-TEST] Week 2 Report',
            level: 7,
            parentId: m.id,
            periodType: 'WEEK',
            progress: 0
        });
        console.log(`L7 (Week 2): ${w2.nodeNumber} (Expected: ...M01-W02)`);
        // Half Month
        const h1 = yield (0, planService_1.createPlanNode)({
            title: '[EXEC-TEST] Half Month Report',
            level: 7,
            parentId: m.id,
            periodType: 'HALF_MONTH',
            progress: 0
        });
        console.log(`L7 (Half Month): ${h1.nodeNumber} (Expected: ...M01-H01)`);
        // 4. Test Progress Feedback
        console.log('\n--- Progress Feedback Test ---');
        // Set W1 to 50%
        yield (0, planService_1.updateNodeProgress)(w1.id, 50);
        // Set W2 to 100%
        yield (0, planService_1.updateNodeProgress)(w2.id, 100);
        // H1 is 0%
        // Average: (50 + 100 + 0) / 3 = 50%
        const mUpdated = yield prisma.planNode.findUnique({ where: { id: m.id } });
        console.log(`Month Progress: ${mUpdated === null || mUpdated === void 0 ? void 0 : mUpdated.progress}% (Expected: 50)`);
        if (((_a = w1.nodeNumber) === null || _a === void 0 ? void 0 : _a.includes('-W01')) && ((_b = h1.nodeNumber) === null || _b === void 0 ? void 0 : _b.includes('-H01')) && (mUpdated === null || mUpdated === void 0 ? void 0 : mUpdated.progress) === 50) {
            console.log('✅ Execution Layer Logic Verified!');
        }
        else {
            console.error('❌ Verification Failed!');
        }
        // Cleanup
        yield prisma.planNode.deleteMany({
            where: { title: { startsWith: '[EXEC-TEST]' } }
        });
    });
}
main()
    .catch(e => {
    console.error(e);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
