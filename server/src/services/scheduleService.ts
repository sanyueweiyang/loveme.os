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
 * 触发 AI 审计 (Placeholder for Yearly/Monthly AI View)
 * 每日凌晨或手动触发
 */
export async function triggerDailyAIAudit(date: string) {
    // 1. Fetch Data
    const dayData = await getDailySchedule(date);
    const mit = dayData.mit;
    const scheduleContent = dayData.nodes.map(n => 
        `[${n.startTime}-${n.endTime}] ${n.displayTitle} (${n.remark || ''})`
    ).join('\n');

    if (!scheduleContent) return null;

    // [New] AI Exception Handling
    // 若某日日程记录少于 10 条，AI 审计应提示‘数据样本不足’，而非给出定性评价。
    // Counts distinct slots (nodes)
    if (dayData.nodes.length < 10) {
        const mockAISummary = `数据样本不足（仅 ${dayData.nodes.length} 条记录），无法生成有效总结。`;
        const mockAIAudit = `数据样本不足，无法评价。`;
        const mockScore = null; // No score
        
        return await prisma.dailySummary.upsert({
            where: { date },
            create: {
                date,
                mit,
                aiSummary: mockAISummary,
                aiAudit: mockAIAudit,
                score: mockScore
            },
            update: {
                aiSummary: mockAISummary,
                aiAudit: mockAIAudit,
                score: mockScore
            }
        });
    }

    // 2. Call AI Service (Mock for now)
    // Prompt: "Based on MIT: {mit} and Schedule: {scheduleContent}, summarize actions and score alignment."
    
    const mockAISummary = `AI Summary for ${date}: Focused on ${mit || 'various tasks'}.`;
    const mockAIAudit = `Alignment Score: High. You adhered well to your MIT.`;
    const mockScore = 85;

    // 3. Save Result
    const result = await prisma.dailySummary.upsert({
        where: { date },
        create: {
            date,
            mit,
            aiSummary: mockAISummary,
            aiAudit: mockAIAudit,
            score: mockScore
        },
        update: {
            aiSummary: mockAISummary,
            aiAudit: mockAIAudit,
            score: mockScore
        }
    });

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
