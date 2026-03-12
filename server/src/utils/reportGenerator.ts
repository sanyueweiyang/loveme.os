
import { PlanNode } from '@prisma/client';

/**
 * 生成每日简报 (Context Briefing for AI)
 * 汇总当前年度/月度/周度的关键节点
 */
export async function generateDayReport(date: Date = new Date()) {
    // We need prisma access here. Usually utils are pure functions.
    // Refactor: Move this logic to a Service or pass data in.
    // For now, let's keep it simple and just export a helper string formatter, 
    // and do data fetching in the Service/Controller.
    // Wait, the requirement says "Implement GET /api/context/daily-briefing".
    // So let's implement the logic in `planService.ts` or `scheduleService.ts` and expose it.
    // This file is for "Copy Generation" (String formatting).
    return "Use getDailyContext() in planService instead.";
}

/**
 * 周报文案生成器 (Copywriter)
 */
export function generateWeeklyReportCopy(node: any, index: number): string {
  // 1. [序号]
  const seq = index;

  // 2. [项目标题]
  const title = node.title;

  // 3. [上线时间]
  const dateStr = node.plannedEndDate || '待定';

  // 4. [planStatus] - No brackets, directly concatenated
  const planStatusStr = node.planStatus || '';

  // 5. [描述]
  let desc = node.outputContent || node.description || '暂无描述';

  // 6. [进度] & [状态]
  const progress = node.progress;
  const statusText = progress >= 100 ? '已完成' : progress > 0 ? '开发中' : '未开始';

  // 7. [优先级]
  // 严格输出 P0/P1/P2/P3/P4 代码，不再映射为中文
  const priority = node.priority;

  // 8. [负责人]
  const owner = (node.owner || '待定').trim();

  // Main Line
  // [序号]、[项目标题]：[上线时间][planStatus]。内容：[描述]。【进度：[XX]%，[状态]】【优先级：[PX]】-[负责人]
  let report = `${seq}、${title}：${dateStr}${planStatusStr}。内容：${desc}。【进度：${progress}%，${statusText}】【优先级：${priority}】-${owner}`;
  
  // Append Data Feedback if exists (New line, indented)
  // [Robustness] Empty check: ensure not empty string or just spaces
  if (node.dataFeedback && node.dataFeedback.trim() !== '') {
    report += `\n   ↳ [数据情况]：${node.dataFeedback.trim()}`;
  }
  
  // Append Issue Log if exists (New line, indented)
  if (node.issueLog && node.issueLog.trim() !== '') {
    report += `\n   ↳ [问题反馈]：${node.issueLog.trim()}`;
  }

  return report;
}

// Test function
export function testGenerate() {
  const dummyNode: any = {
    id: 1,
    title: '气象服务AI化',
    description: 'Original Desc',
    progress: 80,
    level: 6,
    owner: '樊云川',
    priority: 'P0',
    parentId: null,
    rootId: 1,
    outputContent: '完成API对接',
    plannedEndDate: '3月下旬',
    actualEndDate: null,
    planStatus: '正常', // User example says '上线', '提测'. '正常' is also possible.
    periodType: 'WEEK',
    dataFeedback: 'QPS stable',
    issueLog: 'None',
    createdAt: new Date(),
    updatedAt: new Date()
  };

  console.log(generateWeeklyReportCopy(dummyNode, 1));
}
