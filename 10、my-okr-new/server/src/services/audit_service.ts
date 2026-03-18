/**
 * audit_service.ts — 周报 AI 审计服务
 *
 * 职责：
 *   1. getAuditContext  — 聚合本期 L5 计划与 L6 执行数据
 *   2. generateWeekAudit — 调用 DeepSeek，输出 200 字教练点评
 *
 * 审计维度：
 *   - 计划 vs 实施偏差（哪些 L5 目标未被 L6 覆盖）
 *   - 跨周原因分析（IN_PROGRESS_CROSS_WEEK 节点的 issueLog）
 *   - 维度平衡（工作 / 生活 / 成长 的实际工时占比）
 *   - 教练点评（200 字，中文，直接可用于周报）
 */

import prisma from '../lib/prisma';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface L6AuditItem {
  id: number;
  title: string;
  planStatus: string | null;
  progress: number;
  priority: string | null;
  planCategory: string | null;
  dataFeedback: string | null;  // 执行结果
  issueLog: string | null;      // 问题记录 / 复盘
  actualHours: number | null;   // 实际工时（小时）
  l5Title: string | null;
  l5Id: number | null;
  l4Title: string | null;
}

export interface L5AuditItem {
  id: number;
  title: string;
  planStatus: string | null;
  progress: number;
  priority: string | null;
  planCategory: string | null;
  monthCode: string | null;
  l4Title: string | null;
  l6Items: L6AuditItem[];
  totalActualHours: number;
}

export interface AuditContext {
  weekCode: string;
  weekRange: { start: string; end: string };
  l5Plans: L5AuditItem[];
  dimensionStats: {
    工作: { count: number; hours: number };
    生活: { count: number; hours: number };
    成长: { count: number; hours: number };
    未分类: { count: number; hours: number };
  };
  crossWeekItems: L6AuditItem[];   // 跨周进行中的节点
  completedItems: L6AuditItem[];   // 本周已完成
  deferredItems: L6AuditItem[];    // 延后
  cancelledItems: L6AuditItem[];   // 废弃
  totalHours: number;
  completionRate: number;          // 已完成 / 总数 * 100
}

// ── 工具：ISO 周编码 ──────────────────────────────────────────────────────────

function getISOWeekCode(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** 根据 weekCode（如 "2026-W11"）计算该周的周一和周日日期 */
function getWeekRange(weekCode: string): { start: string; end: string } {
  const [yearStr, weekStr] = weekCode.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  // 找到该年第一个周四（ISO 周规则）
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end:   sunday.toISOString().slice(0, 10),
  };
}

// ── 核心函数：聚合审计上下文 ──────────────────────────────────────────────────

/**
 * getAuditContext
 * 提取指定周的所有 L5 计划与 L6 执行数据，构建完整的审计上下文。
 *
 * @param weekCode  ISO 周编码，如 "2026-W11"（默认当前周）
 */
export async function getAuditContext(weekCode?: string): Promise<AuditContext> {
  const wc = weekCode || getISOWeekCode(new Date());
  const weekRange = getWeekRange(wc);

  // ── 1. 查询本周所有 L6 节点 ──────────────────────────────────
  const l6Nodes = await prisma.planNode.findMany({
    where: { level: 6, weekCode: wc },
    select: {
      id: true, title: true, planStatus: true, progress: true,
      priority: true, planCategory: true,
      dataFeedback: true, issueLog: true, actualHours: true,
      parentId: true,
    },
    orderBy: [{ priority: 'asc' }, { planStatus: 'asc' }],
  });

  // ── 2. 查询关联的 L5 节点 ─────────────────────────────────────
  const l5Ids = [...new Set(l6Nodes.map((n: any) => n.parentId).filter(Boolean))] as number[];
  const l5Nodes = l5Ids.length > 0
    ? await prisma.planNode.findMany({
        where: { id: { in: l5Ids } },
        select: { id: true, title: true, planStatus: true, progress: true, priority: true, planCategory: true, monthCode: true, parentId: true },
      })
    : [];

  // ── 3. 查询关联的 L4 节点 ─────────────────────────────────────
  const l4Ids = [...new Set(l5Nodes.map((n: any) => n.parentId).filter(Boolean))] as number[];
  const l4Nodes = l4Ids.length > 0
    ? await prisma.planNode.findMany({
        where: { id: { in: l4Ids } },
        select: { id: true, title: true },
      })
    : [];

  const l5Map = new Map(l5Nodes.map((n: any) => [n.id, n]));
  const l4Map = new Map(l4Nodes.map((n: any) => [n.id, n]));

  // ── 4. 构建 L6 审计条目（附加 L5/L4 标题）────────────────────
  const enrichL6 = (n: any): L6AuditItem => {
    const l5 = l5Map.get(n.parentId) as any;
    const l4 = l5 ? l4Map.get(l5.parentId) as any : null;
    return {
      id: n.id,
      title: n.title,
      planStatus: n.planStatus,
      progress: n.progress ?? 0,
      priority: n.priority,
      planCategory: n.planCategory,
      dataFeedback: n.dataFeedback,
      issueLog: n.issueLog,
      actualHours: n.actualHours ?? null,
      l5Title: l5?.title ?? null,
      l5Id:    l5?.id    ?? null,
      l4Title: l4?.title ?? null,
    };
  };

  const allL6: L6AuditItem[] = l6Nodes.map(enrichL6);

  // ── 5. 按状态分组 ─────────────────────────────────────────────
  const completedItems  = allL6.filter(n => n.planStatus === 'DONE');
  const crossWeekItems  = allL6.filter(n => n.planStatus === 'IN_PROGRESS_CROSS_WEEK');
  const deferredItems   = allL6.filter(n => n.planStatus === 'DEFERRED');
  const cancelledItems  = allL6.filter(n => n.planStatus === 'CANCELLED');

  // ── 6. 构建 L5 审计条目 ───────────────────────────────────────
  const l5Plans: L5AuditItem[] = l5Nodes.map((l5: any) => {
    const l4 = l4Map.get(l5.parentId) as any;
    const l6Items = allL6.filter(n => n.l5Id === l5.id);
    const totalActualHours = l6Items.reduce((s, n) => s + (n.actualHours ?? 0), 0);
    return {
      id: l5.id,
      title: l5.title,
      planStatus: l5.planStatus,
      progress: l5.progress ?? 0,
      priority: l5.priority,
      planCategory: l5.planCategory,
      monthCode: l5.monthCode,
      l4Title: l4?.title ?? null,
      l6Items,
      totalActualHours: Math.round(totalActualHours * 100) / 100,
    };
  });

  // ── 7. 维度工时统计 ───────────────────────────────────────────
  const dimensionStats: AuditContext['dimensionStats'] = {
    工作: { count: 0, hours: 0 },
    生活: { count: 0, hours: 0 },
    成长: { count: 0, hours: 0 },
    未分类: { count: 0, hours: 0 },
  };
  for (const n of allL6) {
    const dim = (n.planCategory as keyof typeof dimensionStats) || '未分类';
    const key = dim in dimensionStats ? dim : '未分类';
    dimensionStats[key].count++;
    dimensionStats[key].hours += n.actualHours ?? 0;
  }
  // 保留两位小数
  for (const k of Object.keys(dimensionStats) as (keyof typeof dimensionStats)[]) {
    dimensionStats[k].hours = Math.round(dimensionStats[k].hours * 100) / 100;
  }

  const totalHours = Math.round(
    Object.values(dimensionStats).reduce((s, d) => s + d.hours, 0) * 100
  ) / 100;

  const completionRate = allL6.length > 0
    ? Math.round(completedItems.length / allL6.length * 100)
    : 0;

  return {
    weekCode: wc,
    weekRange,
    l5Plans,
    dimensionStats,
    crossWeekItems,
    completedItems,
    deferredItems,
    cancelledItems,
    totalHours,
    completionRate,
  };
}

// ── AI 审计：生成教练点评 ─────────────────────────────────────────────────────

/**
 * buildAuditPrompt
 * 根据审计上下文构建 DeepSeek Prompt，要求输出 200 字教练点评。
 */
export function buildAuditPrompt(ctx: AuditContext): string {
  const { weekCode, completedItems, crossWeekItems, deferredItems, dimensionStats, totalHours, completionRate, l5Plans } = ctx;

  // 构建 L5 计划 vs L6 执行的对比摘要
  const planVsExec = l5Plans.map(l5 => {
    const doneCount = l5.l6Items.filter(n => n.planStatus === 'DONE').length;
    const crossCount = l5.l6Items.filter(n => n.planStatus === 'IN_PROGRESS_CROSS_WEEK').length;
    return `  - [${l5.planCategory ?? '未分类'}] ${l5.title}（L4依据：${l5.l4Title ?? '无'}）\n    完成 ${doneCount}/${l5.l6Items.length} 项，跨周 ${crossCount} 项，实际工时 ${l5.totalActualHours}h`;
  }).join('\n');

  // 跨周原因摘要
  const crossWeekSummary = crossWeekItems.length > 0
    ? crossWeekItems.map(n => `  - ${n.title}：${n.issueLog ?? '（未填写问题记录）'}`).join('\n')
    : '  无跨周任务';

  // 维度工时分布
  const dimSummary = Object.entries(dimensionStats)
    .filter(([, v]) => v.count > 0)
    .map(([k, v]) => `${k} ${v.hours}h（${v.count}项）`)
    .join(' / ');

  return `你是一位专业的个人效能教练，正在对用户的周报进行审计。请基于以下数据，输出一段 200 字以内的中文教练点评。

【本周基本信息】
- 周次：${weekCode}
- 完成率：${completionRate}%（已完成 ${completedItems.length} 项）
- 跨周任务：${crossWeekItems.length} 项
- 延后任务：${deferredItems.length} 项
- 实际总工时：${totalHours}h
- 维度分布：${dimSummary || '无数据'}

【L5 计划 vs L6 执行对比】
${planVsExec || '  无数据'}

【跨周原因分析】
${crossWeekSummary}

【审计要求】
1. 指出本周计划与实施的主要偏差（1-2 句）
2. 分析跨周任务的根本原因（若有）
3. 评价工作/生活/成长三个维度的时间分配是否平衡
4. 给出下周最重要的 1 条改进建议

请直接输出点评正文，不要加标题或序号，语气专业但温暖，200 字以内。`;
}

/**
 * generateWeekAudit
 * 调用 DeepSeek API，生成本周教练点评。
 * 若未配置 API Key，返回结构化的 Mock 点评。
 *
 * @param weekCode  ISO 周编码（默认当前周）
 */
export async function generateWeekAudit(weekCode?: string): Promise<{
  weekCode: string;
  context: AuditContext;
  coaching: string;
  generatedAt: string;
}> {
  const ctx = await getAuditContext(weekCode);
  const prompt = buildAuditPrompt(ctx);

  const DEEPSEEK_API_KEY  = process.env.OPENAI_API_KEY;
  const DEEPSEEK_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.deepseek.com';

  let coaching = '';

  if (!DEEPSEEK_API_KEY) {
    // Mock 点评（未配置 API Key 时）
    coaching = `本周完成率 ${ctx.completionRate}%，${ctx.crossWeekItems.length > 0 ? `有 ${ctx.crossWeekItems.length} 项任务跨周延续，建议在下周初优先处理。` : '无跨周任务，执行节奏良好。'}维度分布方面，${ctx.totalHours > 0 ? `实际投入 ${ctx.totalHours} 小时` : '工时数据待补充'}。建议下周在录入 L6 任务时同步填写 issueLog，以便获得更精准的 AI 审计。（未配置 OPENAI_API_KEY，当前为模拟点评）`;
  } else {
    try {
      const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.5,
          max_tokens: 400,
        }),
      });
      if (!response.ok) throw new Error(`AI API Error: ${response.status}`);
      const data = await response.json() as any;
      coaching = data.choices[0].message.content.trim();
    } catch (e) {
      console.error('❌ [generateWeekAudit] AI 调用失败:', e);
      coaching = '（AI 服务暂时不可用，请检查 OPENAI_API_KEY 配置）';
    }
  }

  console.log(`✅ [generateWeekAudit] weekCode=${ctx.weekCode} completionRate=${ctx.completionRate}%`);

  return {
    weekCode: ctx.weekCode,
    context: ctx,
    coaching,
    generatedAt: new Date().toISOString(),
  };
}
