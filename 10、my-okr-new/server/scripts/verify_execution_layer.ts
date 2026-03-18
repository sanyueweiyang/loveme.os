
import { PrismaClient } from '@prisma/client';
import { createPlanNode, updateNodeProgress } from '../src/services/planService';

const prisma = new PrismaClient();

async function main() {
    console.log('=== START EXECUTION LAYER TEST ===');

    // 1. Cleanup
    await prisma.planNode.deleteMany({
        where: {
            OR: [
                { title: { startsWith: '[EXEC-TEST]' } },
                { nodeNumber: { startsWith: 'F01' } }
            ]
        }
    });

    // 2. Create Planning Hierarchy (L1-L6)
    // L1: F01
    const l1 = await createPlanNode({
        title: '[EXEC-TEST] Root',
        level: 1,
        planCategory: 'WORK'
    });
    console.log(`L1: ${l1.nodeNumber}`);

    // L2-L6 Chain (Skipping details for brevity, jumping to M)
    // Create L2
    const l2 = await createPlanNode({ title: '[EXEC-TEST] Obj', level: 2, parentId: l1.id });
    const l3 = await createPlanNode({ title: '[EXEC-TEST] KR', level: 3, parentId: l2.id });
    const l4 = await createPlanNode({ title: '[EXEC-TEST] D1', level: 4, parentId: l3.id });
    const l5 = await createPlanNode({ title: '[EXEC-TEST] D2', level: 5, parentId: l4.id });
    const m = await createPlanNode({ 
        title: '[EXEC-TEST] Month Target', 
        level: 6, 
        parentId: l5.id,
        periodType: 'MONTH'
    });
    console.log(`L6 (Month): ${m.nodeNumber} (DNA END)`);

    // 3. Create Execution Nodes (L7)
    // Week 1
    const w1 = await createPlanNode({
        title: '[EXEC-TEST] Week 1 Report',
        level: 7,
        parentId: m.id,
        periodType: 'WEEK',
        progress: 0
    });
    console.log(`L7 (Week 1): ${w1.nodeNumber} (Expected: ...M01-W01)`);

    // Week 2
    const w2 = await createPlanNode({
        title: '[EXEC-TEST] Week 2 Report',
        level: 7,
        parentId: m.id,
        periodType: 'WEEK',
        progress: 0
    });
    console.log(`L7 (Week 2): ${w2.nodeNumber} (Expected: ...M01-W02)`);

    // Half Month
    const h1 = await createPlanNode({
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
    await updateNodeProgress(w1.id, 50);
    // Set W2 to 100%
    await updateNodeProgress(w2.id, 100);
    // H1 is 0%
    
    // Average: (50 + 100 + 0) / 3 = 50%
    const mUpdated = await prisma.planNode.findUnique({ where: { id: m.id } });
    console.log(`Month Progress: ${mUpdated?.progress}% (Expected: 50)`);

    if (w1.nodeNumber?.includes('-W01') && h1.nodeNumber?.includes('-H01') && mUpdated?.progress === 50) {
        console.log('✅ Execution Layer Logic Verified!');
    } else {
        console.error('❌ Verification Failed!');
    }

    // Cleanup
    await prisma.planNode.deleteMany({
        where: { title: { startsWith: '[EXEC-TEST]' } }
    });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
