
import { PrismaClient } from '@prisma/client';
import { updatePlanNode, getNextWeekPlanNodes, createPlanNode } from '../src/services/planService';
import { generateWeeklyReportCopy } from '../src/utils/reportGenerator';

const prisma = new PrismaClient();

async function verifyRobustness() {
  console.log('=== Starting Robustness Verification ===\n');

  try {
    // 1. Verify Title Cascade Update
    console.log('--- Test 1: Title Cascade Update ---');
    
    // Setup: Parent -> Child (Same Title)
    const parent = await createPlanNode({
        title: 'Original Title',
        level: 2,
        periodType: 'MONTH',
        priority: 'P1',
        owner: 'PM'
    });
    
    const child = await createPlanNode({
        title: 'Original Title', // Same Title (Claimed)
        parentId: parent.id,
        level: 3,
        periodType: 'WEEK',
        priority: 'P1',
        owner: 'Dev'
    });

    const diffChild = await createPlanNode({
        title: 'Different Title', // Different Title (Should NOT update)
        parentId: parent.id,
        level: 3,
        periodType: 'WEEK',
        priority: 'P1',
        owner: 'Dev'
    });

    // Update Parent Title
    await updatePlanNode(parent.id, { title: 'Updated Title' });

    // Check Children
    const updatedChild = await prisma.planNode.findUnique({ where: { id: child.id } });
    const updatedDiffChild = await prisma.planNode.findUnique({ where: { id: diffChild.id } });

    if (updatedChild?.title === 'Updated Title' && updatedDiffChild?.title === 'Different Title') {
        console.log('✅ Title Cascade Verified');
    } else {
        console.error('❌ Title Cascade Failed', { 
            child: updatedChild?.title, 
            diffChild: updatedDiffChild?.title 
        });
        throw new Error('Title Cascade Failed');
    }

    // 2. Verify Empty Value Protection
    console.log('\n--- Test 2: Empty Value Protection ---');
    const nodeWithEmpty = {
        ...updatedChild,
        dataFeedback: '', // Empty string
        issueLog: '   ', // Spaces
        plannedEndDate: 'Test Date',
        planStatus: 'Normal'
    };
    
    const report = generateWeeklyReportCopy(nodeWithEmpty, 1);
    console.log('Report Output:');
    console.log(report);
    
    if (!report.includes('[数据情况]') && !report.includes('[问题反馈]')) {
        console.log('✅ Empty Value Protection Verified');
    } else {
        console.error('❌ Empty Value Protection Failed');
        throw new Error('Empty Value Protection Failed');
    }

    // 3. Verify Holiday Gap Tracing
    console.log('\n--- Test 3: Holiday Gap Tracing (Backtracking) ---');
    
    // Create a task updated 3 weeks ago (Holiday Gap)
    // It is unfinished (50%)
    const holidayTask = await createPlanNode({
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
    await prisma.planNode.update({
        where: { id: holidayTask.id },
        data: { updatedAt: threeWeeksAgo }
    });

    // Generate Next Week Plan
    // Should pick up this task even though it's old
    const nextWeekNodes = await getNextWeekPlanNodes();
    const hasHolidayTask = nextWeekNodes.some(n => n.title === 'Holiday Task (Gap)');
    const preservedProgress = nextWeekNodes.find(n => n.title === 'Holiday Task (Gap)')?.progress;

    if (hasHolidayTask && preservedProgress === 50) {
        console.log('✅ Holiday Gap Tracing Verified (Task found + Progress preserved)');
    } else {
        console.error('❌ Holiday Gap Tracing Failed', { hasHolidayTask, preservedProgress });
        throw new Error('Holiday Gap Tracing Failed');
    }

    console.log('\n=== All Tests Passed ===');

  } catch (error) {
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyRobustness();
