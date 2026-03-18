
import { PrismaClient } from '@prisma/client';
import { createPlanNode, getPeriodicReportNodes, savePushHistory, getPushHistory } from '../src/services/planService';
import { generateWeeklyReportCopy } from '../src/utils/reportGenerator';

const prisma = new PrismaClient();

async function verifyHalfMonthLogic() {
  console.log('=== Starting Half-Month Report Verification ===\n');

  try {
    // 1. Prepare Data for Half-Month (H1: 1-15)
    console.log('--- Test 1: H1 Report (1st-15th) - Full Coverage ---');
    
    // Create Year/Month Root
    const yearNode = await createPlanNode({ title: '2026 Strategy', level: 1, periodType: 'YEAR', priority: 'P0' });
    const monthNode = await createPlanNode({ title: 'March Ops', parentId: yearNode.id, level: 2, periodType: 'MONTH', priority: 'P0' });

    // Task A (P2) - Should be INCLUDED in H1 (Full Coverage)
    const taskA = await createPlanNode({
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
    await prisma.planNode.update({
        where: { id: taskA.id },
        data: { updatedAt: new Date('2026-03-05T10:00:00') }
    });

    // Task B (P0) - Should be INCLUDED
    const taskB = await createPlanNode({
        title: 'H1 Task B (P0)',
        parentId: monthNode.id,
        level: 3,
        periodType: 'WEEK',
        priority: 'P0',
        owner: 'Lead',
        progress: 100,
        outputContent: 'H1 Critical'
    });
    await prisma.planNode.update({
        where: { id: taskB.id },
        data: { updatedAt: new Date('2026-03-10T10:00:00') }
    });

    // Task C (P0) - Date in H2 (March 20th) - Should be EXCLUDED from H1
    const taskC = await createPlanNode({
        title: 'H2 Task C (P0)',
        parentId: monthNode.id,
        level: 3,
        periodType: 'WEEK',
        priority: 'P0',
        owner: 'Lead',
        progress: 100,
        outputContent: 'H2 Critical'
    });
    await prisma.planNode.update({
        where: { id: taskC.id },
        data: { updatedAt: new Date('2026-03-20T10:00:00') }
    });

    // Generate H1 Report
    const h1Nodes = await getPeriodicReportNodes('HALF_MONTH', new Date('2026-03-10')); // Any date in H1
    const h1Titles = h1Nodes.map(n => n.title);
    
    console.log('H1 Nodes:', h1Titles);

    if (h1Titles.includes('H1 Task A (P2)') && h1Titles.includes('H1 Task B (P0)') && !h1Titles.includes('H2 Task C (P0)')) {
        console.log('✅ H1 Logic Verified (Full Coverage + Date Range)');
    } else {
        console.error('❌ H1 Logic Failed');
        throw new Error('H1 Logic Failed');
    }

    // 2. Test Persistence
    console.log('\n--- Test 2: Report Persistence ---');
    const snapshot = JSON.stringify(h1Nodes);
    await savePushHistory(
        '# Half Month Report',
        'SUCCESS',
        'WECHAT',
        'HALF_MONTH',
        '2026-03-H1',
        snapshot
    );

    const history = await getPushHistory({ reportType: 'HALF_MONTH' });
    const latest = history[0];

    if (latest.reportType === 'HALF_MONTH' && latest.reportPeriod === '2026-03-H1' && latest.snapshotData === snapshot) {
        console.log('✅ Persistence Verified');
    } else {
        console.error('❌ Persistence Failed');
        throw new Error('Persistence Failed');
    }

    console.log('\n=== All Tests Passed ===');

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyHalfMonthLogic();
