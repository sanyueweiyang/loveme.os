
import { PrismaClient } from '@prisma/client';
import { createPlanNode, getPeriodicReportNodes, getNextWeekPlanNodes } from '../src/services/planService';
import { generateWeeklyReportCopy } from '../src/utils/reportGenerator';

const prisma = new PrismaClient();

async function verifyAggregation() {
  console.log('--- 开始真本事验证 ---');

  // 1. 场景准备：任务 A, B, C
  // 创建共同的 root (Year Node)
  const yearNode = await createPlanNode({
      title: '2026 核心战略',
      level: 1,
      periodType: 'YEAR',
      priority: 'P0',
      owner: 'CEO'
  });
  
  // 创建 Month Node (for Task A & B)
  const monthNode = await createPlanNode({
      title: '3月攻坚',
      parentId: yearNode.id,
      level: 2,
      periodType: 'MONTH',
      priority: 'P0',
      owner: 'PM'
  });

  // Task A (Week 1): Progress 20%, P1
  const taskA_Week1 = await createPlanNode({
      title: '任务 A', // Same Title
      parentId: monthNode.id,
      level: 3,
      periodType: 'WEEK',
      priority: 'P1',
      owner: 'Dev',
      progress: 20,
      plannedEndDate: '第一周',
      planStatus: '开发中',
      outputContent: '第一周只完成了20%'
  });
  // Manually set update time to 7 days ago
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  await prisma.planNode.update({ where: { id: taskA_Week1.id }, data: { updatedAt: lastWeek } });
  console.log(`Created Task A (W1): 20%`);

  // Task A (Week 2): Progress 50%, P1
  const taskA_Week2 = await createPlanNode({
      title: '任务 A', // Same Title -> Should aggregate
      parentId: monthNode.id,
      level: 3,
      periodType: 'WEEK',
      priority: 'P1',
      owner: 'Dev',
      progress: 50,
      plannedEndDate: '第二周',
      planStatus: '开发中',
      outputContent: '第二周进度到了50%'
  });
  console.log(`Created Task A (W2): 50%`);

  // Task B (Week X): P2
  const taskB = await createPlanNode({
      title: '任务 B',
      parentId: monthNode.id,
      level: 3,
      periodType: 'WEEK',
      priority: 'P2', // Should be filtered out in Month Report
      owner: 'Intern',
      progress: 10,
      plannedEndDate: '本周',
      planStatus: '待定'
  });
  console.log(`Created Task B: P2 (Should be filtered)`);

  // Task C (Month Plan): P1, No Week Child
  const taskC_Month = await createPlanNode({
      title: '月度计划 C',
      parentId: yearNode.id,
      level: 2,
      periodType: 'MONTH',
      priority: 'P1',
      owner: 'PM',
      progress: 0,
      plannedEndDate: '3月',
      planStatus: '规划中'
  });
  console.log(`Created Task C (Month): No Week Child`);

  // Task D (Week, P1): For Year Report Test (Should be excluded)
  const taskD = await createPlanNode({
      title: '任务 D (P1)',
      parentId: monthNode.id,
      level: 3,
      periodType: 'WEEK',
      priority: 'P1',
      owner: 'Dev',
      progress: 100,
      plannedEndDate: '3月',
      planStatus: '上线',
      outputContent: 'P1 任务完成'
  });
  console.log(`Created Task D (P1): Should be excluded from Year Report`);

  // Task E (Week, P0): For Year Report Test (Should be included)
  const taskE = await createPlanNode({
      title: '任务 E (P0)',
      parentId: monthNode.id,
      level: 3,
      periodType: 'WEEK',
      priority: 'P0',
      owner: 'Tech Lead',
      progress: 100,
      plannedEndDate: '3月',
      planStatus: '上线',
      outputContent: 'P0 核心任务完成'
  });
  console.log(`Created Task E (P0): Should be included in Year Report`);


  // Task F (Week, CANCELLED): Should be excluded from Next Week Plan
  await createPlanNode({
      title: '任务 F (CANCELLED)',
      parentId: monthNode.id,
      level: 3,
      periodType: 'WEEK',
      priority: 'P1',
      owner: 'Dev',
      progress: 50,
      plannedEndDate: 'Week X',
      planStatus: '已取消',
      outputContent: 'Cancelled task'
  });
  // Update status to CANCELLED manually (createPlanNode doesn't support status param fully yet?)
  // Actually createPlanNode schema update might need to support status.
  // Let's update it via prisma directly to be sure.
  const taskF = await prisma.planNode.findFirst({ where: { title: '任务 F (CANCELLED)' } });
  if (taskF) {
      await prisma.planNode.update({
          where: { id: taskF.id },
          data: { status: 'CANCELLED' }
      });
      console.log('Created Task F: CANCELLED (Should be excluded)');
  }

  // --- 验证 1: 月报汇总 ---
  console.log('\n--- 验证 1: 月报汇总 (Filter P0/P1 + Aggregate Task A) ---');
  const monthReportNodes = await getPeriodicReportNodes('MONTH');
  
  // Filter only our test nodes
  const testIds = [taskA_Week1.id, taskA_Week2.id, taskB.id];
  // Note: getPeriodicReportNodes returns aggregated nodes, so ID might be one of them.
  // We filter by title to check correctness.
  const relevantMonthNodes = monthReportNodes.filter(n => ['任务 A', '任务 B', '任务 D (P1)', '任务 E (P0)'].includes(n.title));
  
  if (relevantMonthNodes.length === 0) {
      console.log('No relevant nodes found.');
  } else {
      relevantMonthNodes.forEach((node, index) => {
          console.log(generateWeeklyReportCopy(node, index + 1));
      });
  }

  // --- 验证 2: 年报汇总 (仅 P0) ---
  console.log('\n--- 验证 2: 年报汇总 (Only P0) ---');
  const yearReportNodes = await getPeriodicReportNodes('YEAR');
  
  const relevantYearNodes = yearReportNodes.filter(n => ['任务 A', '任务 B', '任务 D (P1)', '任务 E (P0)'].includes(n.title));
  
  if (relevantYearNodes.length === 0) {
      console.log('No relevant nodes found.');
  } else {
      relevantYearNodes.forEach((node, index) => {
          console.log(generateWeeklyReportCopy(node, index + 1));
      });
  }


  // --- 验证 3: 下周计划 (双重抓取) ---
  console.log('\n--- 验证 3: 下周计划 (Unfinished A + Unclaimed C) ---');
  const nextWeekNodes = await getNextWeekPlanNodes();
  
  // Filter test nodes
  const relevantNextNodes = nextWeekNodes.filter(n => ['任务 A', '月度计划 C', '任务 F (CANCELLED)'].includes(n.title));
  
  if (relevantNextNodes.length === 0) {
      console.log('No relevant nodes found.');
  } else {
      // De-duplicate Task A manually here if multiple versions exist in unfinished list
      // getNextWeekPlanNodes fetches raw unfinished nodes.
      // Task A (W1) and Task A (W2) are both unfinished.
      // Usually, we pick the latest one. Let's see what comes out.
      // If the logic simply fetches all unfinished, both might appear.
      // Let's refine the display to show unique titles if needed, but let's see raw output first.
      
      const seenTitles = new Set();
      let index = 1;
      
      // Sort by UpdatedAt desc to pick latest A
      relevantNextNodes.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      for (const node of relevantNextNodes) {
          if (!seenTitles.has(node.title)) {
              console.log(generateWeeklyReportCopy(node, index));
              seenTitles.add(node.title);
              index++;
          }
      }
  }

  console.log('--- 验证结束 ---');
}

verifyAggregation()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
