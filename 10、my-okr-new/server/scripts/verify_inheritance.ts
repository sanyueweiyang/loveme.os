
import { PrismaClient } from '@prisma/client';
import { generateNextMonthPlan, createPlanNode } from '../src/services/planService';

const prisma = new PrismaClient();

async function main() {
    console.log('=== 任务继承逻辑验证 (Task Inheritance) ===');

    // 1. Cleanup
    await prisma.planNode.deleteMany({
        where: { 
            OR: [
                { title: { startsWith: '[INHERIT-TEST]' } },
                { nodeNumber: { startsWith: 'F99' } } // Use 'Other' category to avoid conflicts
            ]
        }
    });

    // 2. Setup Hierarchy (L1-L5) to support M nodes
    const root = await createPlanNode({ title: '[INHERIT-TEST] Root', level: 1, planCategory: '其他' });
    const l2 = await createPlanNode({ title: '[INHERIT-TEST] O', level: 2, parentId: root.id, planCategory: '其他' });
    const l3 = await createPlanNode({ title: '[INHERIT-TEST] KR', level: 3, parentId: l2.id, planCategory: '其他' });
    const l4 = await createPlanNode({ title: '[INHERIT-TEST] D1', level: 4, parentId: l3.id, planCategory: '其他' });
    const l5 = await createPlanNode({ title: '[INHERIT-TEST] D2', level: 5, parentId: l4.id, planCategory: '其他' });

    // 3. Setup: Current Month (March) Tasks
    // Unfinished Original Task
    const t1 = await createPlanNode({
        title: '[INHERIT-TEST] Unfinished Original',
        level: 6,
        parentId: l5.id,
        periodType: 'MONTH',
        progress: 50,
        evolutionTag: 'ORIGINAL',
        planCategory: '其他'
    });
    await prisma.planNode.update({ where: { id: t1.id }, data: { monthCode: '03' } });

    // Unfinished Plan Outside Task
    const t2 = await createPlanNode({
        title: '[INHERIT-TEST] Unfinished Outside',
        level: 6,
        parentId: l5.id,
        periodType: 'MONTH',
        progress: 30,
        evolutionTag: 'PLAN_OUTSIDE',
        planCategory: '其他'
    });
    await prisma.planNode.update({ where: { id: t2.id }, data: { monthCode: '03' } });

    // Finished Task (Should not inherit)
    const t3 = await createPlanNode({
        title: '[INHERIT-TEST] Finished Task',
        level: 6,
        parentId: l5.id,
        periodType: 'MONTH',
        progress: 100,
        evolutionTag: 'ORIGINAL',
        planCategory: '其他'
    });
    await prisma.planNode.update({ where: { id: t3.id }, data: { monthCode: '03' } });

    // 4. Setup: Next Month (April) Targets
    // Existing Target from Annual Plan
    const t4 = await createPlanNode({
        title: '[INHERIT-TEST] April Target',
        level: 6,
        parentId: l5.id,
        periodType: 'MONTH',
        progress: 0,
        evolutionTag: 'ORIGINAL',
        planCategory: '其他'
    });
    await prisma.planNode.update({ where: { id: t4.id }, data: { monthCode: '04' } });

    // 4. Trigger Inheritance (Generate Plan for April)
    console.log('\nGenerating Plan for April (Month 4)...');
    const result = await generateNextMonthPlan(2026, 4);

    console.log('\n--- Result ---');
    console.log(`Originals Found: ${result.originalCount}`);
    console.log(`Inherited Tasks: ${result.inheritedCount}`);
    
    result.inheritedTasks.forEach((t: any) => {
        console.log(`> Inherited: ${t.title} [${t.evolutionTag}] (${t.progress}%)`);
    });

    // 5. Verify
    // Should have 2 inherited tasks (Unfinished Original + Unfinished Outside)
    // Should NOT have Finished Task
    const titles = result.inheritedTasks.map((t: any) => t.title);
    
    if (titles.includes('[INHERIT-TEST] Unfinished Original') && 
        titles.includes('[INHERIT-TEST] Unfinished Outside') &&
        !titles.includes('[INHERIT-TEST] Finished Task')) {
        console.log('✅ Inheritance Logic Verified: All unfinished tasks carried over.');
    } else {
        console.error('❌ Inheritance Logic Failed!');
    }

    // Cleanup
    await prisma.planNode.deleteMany({
        where: { title: { startsWith: '[INHERIT-TEST]' } }
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
