import { PrismaClient } from '@prisma/client';
import { updatePlanNode, updateNodeProgress } from './planService';

const prisma = new PrismaClient();

/**
 * 业务天逻辑 (Business Day Logic)
 * 凌晨 04:00 前的记录归属于前一日
 */
function normalizeDate(dateStr: string, timeStr?: string): string {
    if (!timeStr) return dateStr;
    
    // Parse time
    const [hours, minutes] = timeStr.split(':').map(Number);
    if (hours < 4) {
        // Belong to previous day
        const date = new Date(dateStr);
        date.setDate(date.getDate() - 1);
        return date.toISOString().split('T')[0];
    }
    return dateStr;
}

/**
 * 获取单日日程数据 (Daily View)
 * @param date YYYY-MM-DD
 */
export async function getDailySchedule(date: string) {
    // 1. Get Time Slots
    // Note: Since we store by "business date", we just query by date.
    // However, when saving, we need to apply the logic.
    // For reading, we trust the `date` field in DB is already the business date.
    
    const nodes = await prisma.scheduleNode.findMany({
        where: { date },
        orderBy: { startTime: 'asc' },
        include: {
            relatedPlan: {
                select: {
                    id: true,
                    title: true,
                    progress: true,
                    owner: true,
                    planCategory: true
                }
            }
        }
    });

    // 2. Get Daily Summary (MIT & AI Audit)
    const summary = await prisma.dailySummary.findUnique({
        where: { date }
    });

    return {
        date,
        mit: summary?.mit || '',
        aiSummary: summary?.aiSummary || '',
        aiAudit: summary?.aiAudit || '',
        score: summary?.score || null,
        nodes: nodes.map(n => ({
            ...n,
            // If related plan exists, use its title for display if local title is missing
            displayTitle: n.title || n.relatedPlan?.title || '',
            relatedPlanTitle: n.relatedPlan?.title,
            relatedPlanProgress: n.relatedPlan?.progress,
            relatedPlanOwner: n.relatedPlan?.owner
        }))
    };
}

/**
 * 保存/更新单日日程 (Auto-Save / Silent Save)
 * 全量覆盖当天的 ScheduleNodes (简单且安全)
 * MIT 单独更新或一起更新
 * 
 * [Safety Guard] dryRun mode: Return expected changes without DB operations.
 */
export async function saveDailySchedule(date: string, data: { 
    mit?: string, 
    nodes: any[] 
}, dryRun: boolean = false) { // [New] dryRun param
    // 0. Business Day Logic is handled by Frontend passing the "Business Date"
    
    const validNodes = [];
    const completedPlanIds = new Set<number>(); // Track plans to mark as completed

    for (const n of data.nodes) {
        // [Constraint] Slot Mutex: Default 1 main task ID per slot.
        validNodes.push({
            date, // Use the business date
            startTime: n.startTime,
            endTime: n.endTime,
            title: n.title,
            remark: n.remark,
            category: n.category,
            relatedPlanId: n.relatedPlanId,
            isMerged: n.isMerged || false,
            span: n.span || 1
        });

        // [Feature] Quick Status Sync
        if (n.syncComplete && n.relatedPlanId) {
            completedPlanIds.add(n.relatedPlanId);
        }
    }

    // 0. Conflict Detection
    const existingNodes = await prisma.scheduleNode.findMany({
        where: { date }
    });

    const conflicts = [];
    for (const newNode of validNodes) {
        // Simple Overlap Detection
        // overlap = (start1 < end2) && (end1 > start2)
        const conflict = existingNodes.find(ex => 
            (newNode.startTime < ex.endTime) && (newNode.endTime > ex.startTime)
        );
        if (conflict) {
            conflicts.push({
                timeSlot: `${newNode.startTime}-${newNode.endTime}`,
                conflictsWith: conflict.title || conflict.id,
                existingSlot: `${conflict.startTime}-${conflict.endTime}` // Fix: ex -> conflict
            });
        }
    }

    if (dryRun) {
        return {
            status: 'dry-run',
            message: 'Preview of changes. No DB operations performed.',
            conflictFound: conflicts.length > 0,
            conflicts: conflicts,
            wouldDeleteDate: date,
            wouldCreateNodesCount: validNodes.length,
            wouldCreateNodes: validNodes,
            wouldUpdateMIT: data.mit,
            wouldCompletePlanIds: Array.from(completedPlanIds)
        };
    }

    // 1. Upsert Daily Summary (MIT)
    if (data.mit !== undefined) {
        await prisma.dailySummary.upsert({
            where: { date },
            create: { date, mit: data.mit },
            update: { mit: data.mit }
        });
    }

    // 2. Sync Schedule Nodes
    // Transaction: Delete old -> Create new
    const operations = [
        prisma.scheduleNode.deleteMany({ where: { date } })
    ];
    
    // Fallback: Loop create
    for (const nodeData of validNodes) {
        operations.push(prisma.scheduleNode.create({ data: nodeData }) as any);
    }

    await prisma.$transaction(operations);

    // 3. Process Status Sync (Async)
    if (completedPlanIds.size > 0) {
        // Update plans to 100% progress
        for (const planId of completedPlanIds) {
            await updateNodeProgress(planId, 100); // Use exported function
            await updatePlanNode(planId, { 
                status: 'COMPLETED',
                actualEndDate: new Date() // Mark completion time
            });
        }
    }

    return { status: 'success' };
}

/**
 * 获取周视图统计 (Weekly Stats)
 * 计算本周内每个周任务累计投入时长
 */
export async function getWeeklyScheduleStats(startDate: string, endDate: string) {
    // 1. Find all schedule nodes in range with related plan
    const nodes = await prisma.scheduleNode.findMany({
        where: {
            date: { gte: startDate, lte: endDate },
            relatedPlanId: { not: null }
        },
        select: {
            relatedPlanId: true,
            span: true
        }
    });

    // 2. Aggregate duration (30 mins per span)
    const stats: Record<number, number> = {}; // planId -> minutes
    
    nodes.forEach(n => {
        if (!n.relatedPlanId) return;
        const minutes = (n.span || 1) * 30;
        stats[n.relatedPlanId] = (stats[n.relatedPlanId] || 0) + minutes;
    });

    return stats;
}

/**
 * 触发每日"知行合一"AI 审计
 *
 * 审计逻辑：
 *   "谋" = L1 战略目标（PlanNode level=1）+ DailySummary.mit（每日核心意图）
 *   "行" = 当日 ScheduleNode（实际日程）+ L6 PlanNode（执行活动，progress/dataFeedback）
 *
 * AI 输出：
 *   highlights  — 今日与战略对齐的亮点（数组）
 *   deviation   — 偏离战略的行为描述
 *   suggestion  — 明日改进建议
 *   score       — 知行合一得分 0-100
 */
export async function triggerDailyAIAudit(date: string) {
    // ── 1. 拉取当日日程 ──────────────────────────────────────────
    const dayData = await getDailySchedule(date);
    const mit = dayData.mit || '';

    if (dayData.nodes.length < 3) {
        const insufficientMsg = `数据样本不足（仅 ${dayData.nodes.length} 条日程记录），无法生成有效审计。`;
        return await prisma.dailySummary.upsert({
            where: { date },
            create: { date, mit, aiSummary: insufficientMsg, aiAudit: insufficientMsg, score: null },
            update: { aiSummary: insufficientMsg, aiAudit: insufficientMsg, score: null }
        });
    }

    // ── 2. 拉取 L1 战略目标（"谋"的顶层锚点）────────────────────
    const l1Goals = await prisma.planNode.findMany({
        where: { level: 1 },
        select: { title: true, planCategory: true, progress: true },
        orderBy: { priority: 'asc' },
        take: 5,
    });
    const l1Summary = l1Goals.length > 0
        ? l1Goals.map((g: any) => `- ${g.title}（${g.planCategory ?? '未分类'}，进度 ${g.progress ?? 0}%）`).join('\n')
        : '（暂无 L1 战略目标）';

    // ── 3. 拉取当日 L6 执行活动（"行"的执行层）──────────────────
    const l6Activities = await prisma.planNode.findMany({
        where: { level: 6, weekCode: { not: null } },
        select: { title: true, progress: true, dataFeedback: true, planCategory: true },
        take: 20,
    });
    const l6Summary = l6Activities.length > 0
        ? l6Activities.map((a: any) => `- ${a.title}（进度 ${a.progress ?? 0}%${a.dataFeedback ? `，反馈：${a.dataFeedback}` : ''}）`).join('\n')
        : '（暂无 L6 执行活动）';

    // ── 4. 构建日程摘要 ──────────────────────────────────────────
    const scheduleLog = dayData.nodes.map((n: any) => {
        const planInfo = n.relatedPlan ? `[关联：${n.relatedPlan.title} ${n.relatedPlan.progress ?? 0}%]` : '[未关联计划]';
        return `- ${n.startTime}-${n.endTime}: ${n.displayTitle} ${planInfo} (${n.remark || ''})`;
    }).join('\n');

    // ── 5. 调用 AI 生成审计报告 ──────────────────────────────────
    const DEEPSEEK_API_KEY = process.env.OPENAI_API_KEY;
    const DEEPSEEK_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.deepseek.com';

    let auditResult: { highlights: string[]; deviation: string; suggestion: string; score: number };

    const systemPrompt = `你是"知行合一审计官"，负责评估用户每日的"谋"（战略意图）与"行"（实际执行）的一致性。

【战略层 L1 目标（谋）】
${l1Summary}

【今日核心意图 MIT（谋）】
${mit || '（未设置）'}

【今日实际日程（行）】
${scheduleLog}

【今日 L6 执行活动（行）】
${l6Summary}

请从以下维度评估知行合一程度，并以 JSON 格式返回：
1. highlights: 今日与战略目标对齐的亮点（数组，最多 3 条，中文，每条不超过 30 字）
2. deviation: 偏离战略意图的行为描述（中文，不超过 60 字；若无偏差则写"无明显偏差"）
3. suggestion: 明日改进建议（中文，不超过 60 字）
4. score: 知行合一得分（0-100 整数，100=完全对齐，0=完全偏离）

评分参考：80-100 高度对齐 / 60-79 基本对齐 / 40-59 偏差明显 / 0-39 严重脱节

只返回 JSON，不要有任何额外文字。`;

    if (!DEEPSEEK_API_KEY) {
        auditResult = {
            highlights: ['已完成今日核心任务', '日程记录完整'],
            deviation: '（未配置 AI Key，使用模拟结果）',
            suggestion: '请在 .env 中配置 OPENAI_API_KEY 以启用真实 AI 审计。',
            score: 70,
        };
    } else {
        try {
            const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
                body: JSON.stringify({
                    model: 'deepseek-chat',
                    messages: [{ role: 'user', content: systemPrompt }],
                    temperature: 0.3,
                    response_format: { type: 'json_object' },
                }),
            });
            if (!response.ok) throw new Error(`AI API Error: ${response.status}`);
            const data = await response.json() as any;
            const raw = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
            auditResult = JSON.parse(raw);
        } catch (e) {
            console.error('❌ 知行合一 AI 审计失败:', e);
            auditResult = { highlights: ['日程数据已记录'], deviation: 'AI 服务暂时不可用', suggestion: '请检查 API Key 或网络连接。', score: 0 };
        }
    }

    // ── 6. 格式化并写入 DailySummary ─────────────────────────────
    const formattedAudit = [
        `【知行合一审计】得分：${auditResult.score} / 100`,
        '',
        '✨ 今日亮点：',
        ...auditResult.highlights.map((h: string) => `  - ${h}`),
        '',
        `⚠️ 偏差分析：${auditResult.deviation}`,
        '',
        `💡 明日建议：${auditResult.suggestion}`,
    ].join('\n');

    const aiSummary = `${date} 共记录 ${dayData.nodes.length} 条日程，L6 执行活动 ${l6Activities.length} 条。MIT：${mit || '未设置'}。`;

    const result = await prisma.dailySummary.upsert({
        where: { date },
        create: { date, mit, aiSummary, aiAudit: formattedAudit, score: auditResult.score },
        update: { aiSummary, aiAudit: formattedAudit, score: auditResult.score },
    });

    console.log(`✅ [triggerDailyAIAudit] date=${date} score=${auditResult.score}`);
    return result;
}


/**
 * 获取月度/年度 AI 视图数据
 */
export async function getCalendarViewData(startDate: string, endDate: string) {
    return await prisma.dailySummary.findMany({
        where: {
            date: { gte: startDate, lte: endDate }
        }
    });
}
