import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';

// ==========================================
// 1. 进度递归回传逻辑
// ==========================================

/**
 * 更新 PlanNode 进度，并递归更新父节点进度 (支持事务)
 * @param nodeId 当前更新进度的节点 ID
 * @param newProgress 新进度值 (0-100)
 */
export async function updateNodeProgress(nodeId: number, newProgress: number) {
  // 使用事务确保原子性
  return await prisma.$transaction(async (tx) => {
    // 1. 更新当前节点进度
    const updatedNode = await tx.planNode.update({
      where: { id: nodeId },
      data: { progress: newProgress },
      include: { parent: true }, 
    });

    console.log(`[L${updatedNode.level}] Node [${updatedNode.title}] progress updated to ${newProgress}%`);

    // 2. 如果有父节点，触发向上递归更新
    if (updatedNode.parentId) {
      await updateParentProgressRecursive(updatedNode.parentId, tx);
    }

    return updatedNode;
  });
}

/**
 * 全量重新计算进度 (Admin: Recalculate All)
 * 从 L6 (Month) 开始，基于 L7 (Week) 的进度向上逐层汇总，直到 L1 (Category)。
 * 确保所有父节点的进度与子节点一致。
 */
export async function recalculateAllProgress() {
    console.log('Starting full progress recalculation...');
    let totalUpdated = 0;

    // Iterate from bottom-up: Level 6 down to Level 1
    // (Assuming L7 is the leaf execution layer)
    for (let level = 6; level >= 1; level--) {
        console.log(`Processing Level ${level}...`);
        
        // 1. Get all nodes at this level
        const nodes = await prisma.planNode.findMany({
            where: { level },
            include: { children: true }
        });

        // 2. Recalculate each node
        for (const node of nodes) {
            if (!node.children || node.children.length === 0) continue;

            // Calculate average from children
            const totalProgress = node.children.reduce((sum, child) => sum + child.progress, 0);
            const avgProgress = parseFloat((totalProgress / node.children.length).toFixed(2));

            // Update if different (Tolerance 0.01)
            if (Math.abs(node.progress - avgProgress) > 0.01) {
                await prisma.planNode.update({
                    where: { id: node.id },
                    data: { progress: avgProgress }
                });
                console.log(`[Recalc] Updated L${level} Node ${node.id} (${node.title}): ${node.progress}% -> ${avgProgress}%`);
                totalUpdated++;
            }
        }
    }

    console.log(`Recalculation complete. Total nodes updated: ${totalUpdated}`);
    return { success: true, totalUpdated };
}

/**
 * 获取每日上下文简报 (Daily Briefing Context)
 * 供 AI 解析时参考，包含本周/本月/本年的关键任务 (P0/P1)
 */
export async function getDailyContext() {
    const now = new Date();
    
    // 1. 本周关键任务 (Week P0/P1)
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    const weekNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
            updatedAt: { gte: startOfWeek },
            priority: { in: ['P0', 'P1'] },
            status: { not: 'CANCELLED' }
        },
        select: { title: true, priority: true, status: true }
    });

    // 2. 本月关键目标 (Month P0)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'MONTH',
            updatedAt: { gte: startOfMonth },
            priority: 'P0',
            status: { not: 'CANCELLED' }
        },
        select: { title: true, priority: true }
    });

    return {
        date: new Date().toISOString().split('T')[0],
        weekFocus: weekNodes.map(n => `[${n.priority}] ${n.title}`),
        monthFocus: monthNodes.map(n => `[${n.priority}] ${n.title}`)
    };
}

/**
 * 递归计算并更新父节点进度 (核心算法)
 * 规则：父节点进度 = 所有子节点进度的平均值
 * 终止条件：到达 L1 根节点 (无 parentId)
 */
async function updateParentProgressRecursive(parentId: number, tx?: Prisma.TransactionClient) {
  // 使用事务客户端或默认 prisma 实例
  const client = tx || prisma;
  
  // 获取父节点及其所有子节点
  const parent = await client.planNode.findUnique({
    where: { id: parentId },
    include: { 
      children: true,
      parent: true 
    },
  });

  if (!parent || parent.children.length === 0) return;

  // 算法：计算所有子节点的平均进度
  const totalProgress = parent.children.reduce((sum, child) => sum + child.progress, 0);
  const averageProgress = parseFloat((totalProgress / parent.children.length).toFixed(2));

  // 优化：仅当进度实际发生变化时才更新数据库
  if (parent.progress !== averageProgress) {
    await client.planNode.update({
      where: { id: parentId },
      data: { progress: averageProgress },
    });
    
    console.log(`[Recursion] Updated Parent L${parent.level} [${parent.title}] to ${averageProgress}% (based on ${parent.children.length} children)`);

    // 递归：继续向上更新更上层的父节点，直到 L1
    if (parent.parentId) {
      await updateParentProgressRecursive(parent.parentId, tx);
    }
  }
}


// ==========================================
// 2. 报表抓取逻辑 (通用)
// ==========================================

/**
 * 生成日报/周报/月报/年报内容 (Report Aggregator)
 * 逻辑：
 * 1. 抓取 actualEndDate (实际完成日期) 落在指定时间范围内的 L5/L6 节点.
 * 2. 自动筛选：如果是月报/年报 (rangeType >= 30 days)，仅提取优先级为 P0/P1 的任务.
 * 3. 格式化输出：带上完成日期、负责人、产出内容.
 */
export async function generateReport(startDate: Date, endDate: Date) {
  // 计算时间跨度天数，判断是否为月报/年报
  const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  const isLongTermReport = diffDays >= 28; // 月报及以上

  // 1. 构建查询条件
    const whereCondition: any = {
        level: { in: [5, 6] }, // 仅抓取执行层
        actualEndDate: {
            gte: startDate,
            lte: endDate,
        },
        dataFeedback: { not: null }, // 必须有产出内容 (原 outputContent)
    };

  // 2. 自动筛选：月报/年报仅看 P0/P1
  if (isLongTermReport) {
    whereCondition.priority = { in: ['P0', 'P1'] };
  }

  // 3. 查询符合条件的节点
  const nodes = await prisma.planNode.findMany({
    where: whereCondition,
    orderBy: {
      actualEndDate: 'asc', // 按完成时间正序排列
    },
    select: {
      title: true,
      dataFeedback: true, // Use dataFeedback
      actualEndDate: true,
      owner: true,
      priority: true,
      parent: {
        select: { title: true } // 获取父节点标题用于溯源
      }
    }
  });

  // 4. 格式化输出
  let reportTitle = isLongTermReport ? "=== 核心成果汇报 (P0/P1) ===" : "=== 阶段性工作汇报 ===";
  let reportContent = `${reportTitle}\n`;
  reportContent += `时间范围: ${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}\n`;
  reportContent += `筛选规则: ${isLongTermReport ? '仅展示高优先级 (P0/P1)' : '全量展示 (L5/L6)'}\n\n`;

  if (nodes.length === 0) {
    return reportContent + "该时间段内无符合条件的完成记录。";
  }

  nodes.forEach((node, index) => {
    // 格式化日期 MM/DD
    const dateStr = node.actualEndDate 
      ? `${node.actualEndDate.getMonth() + 1}/${node.actualEndDate.getDate()}`
      : '未知日期';
    
    // 格式化输出行
    // e.g. "03/09 [P0] 任务标题 (父任务: xxx)"
    const parentInfo = node.parent ? ` (所属: ${node.parent.title})` : "";
    reportContent += `${dateStr} 完成了 [${node.priority}] ${node.title}${parentInfo}\n`;
    
    if (node.dataFeedback) {
      reportContent += `   > 产出: ${node.dataFeedback}\n`;
    }
    if (node.owner) {
      reportContent += `   > 负责人: ${node.owner}\n`;
    }
    reportContent += `\n`;
  });

  return reportContent;
}


// ==========================================
// 3. 报表自动化聚合 (Report Aggregator) - 增强版
// ==========================================

/**
 * 递归抓取指定节点下所有 L5/L6 节点的报表内容
 * 并格式化为字符串数组: [负责人] 任务标题: 上线内容
 * @param nodeId 目标父节点 ID
 */
export async function getConsolidatedReport(nodeId: number, startDate: Date, endDate: Date): Promise<string[]> {
  // 1. 获取所有子孙节点 ID (优化：如果 rootId 存在，可以直接用 rootId 查询，这里暂用递归)
  const allChildIds = await getAllChildNodeIds(nodeId);
  
  // 2. 查询符合条件的节点 (Level 5/6, 时间范围内, 有 outputContent)
  const reportNodes = await prisma.planNode.findMany({
    where: {
      id: { in: allChildIds },
      // level: { in: [5, 6] }, // 暂时放宽 Level 限制，抓取所有子孙
      updatedAt: {
        gte: startDate,
        lte: endDate,
      },
      dataFeedback: { not: null }, // 必须有产出内容 (原 outputContent)
    },
    select: {
      title: true,
      dataFeedback: true, // Use dataFeedback
      owner: true,
    },
    orderBy: {
      updatedAt: 'desc',
    }
  });

  // 3. 格式化输出
  return reportNodes.map(node => {
    const ownerStr = node.owner ? `[${node.owner}] ` : "";
    return `${ownerStr}${node.title}: ${node.dataFeedback}`;
  });
}

/**
 * 辅助函数：递归获取所有子节点 ID
 */
async function getAllChildNodeIds(nodeId: number): Promise<number[]> {
  const children = await prisma.planNode.findMany({
    where: { parentId: nodeId },
    select: { id: true }
  });

  let ids = children.map(c => c.id);
  
  for (const child of children) {
    const grandChildIds = await getAllChildNodeIds(child.id);
    ids = [...ids, ...grandChildIds];
  }
  
  return ids;
}


// ==========================================
// 4. 工时统计逻辑 (Schedule Linker) - 增强版
// ==========================================

/**
 * 创建或更新 WorkLog，并自动计算 duration
 * @param content 日志内容
 * @param relatedNodeId 关联节点 ID
 * @param startTime 开始时间
 * @param endTime 结束时间
 */
export async function createOrUpdateWorkLog(
  content: string, 
  relatedNodeId: number | null, 
  startTime?: Date, 
  endTime?: Date,
  logId?: number
) {
  // 1. duration 字段已移除，不再计算存储

  // 2. 写入数据库
  if (logId) {
    return await prisma.workLog.update({
      where: { id: logId },
      data: { content, relatedNodeId, startTime, endTime },
    });
  } else {
    return await prisma.workLog.create({
      data: { content, relatedNodeId, startTime, endTime },
    });
  }
}

/**
 * 统计某个节点 (通常是 L6) 的实际投入工时
 */
export async function calculateActualDuration(nodeId: number) {
  // 由于 duration 字段已删除，我们通过 endTime - startTime 动态计算
  const logs = await prisma.workLog.findMany({
    where: { 
      relatedNodeId: nodeId,
      startTime: { not: null },
      endTime: { not: null }
    },
    select: { startTime: true, endTime: true }
  });

  let totalMinutes = 0;
  logs.forEach(log => {
    if (log.startTime && log.endTime) {
      const diffMs = log.endTime.getTime() - log.startTime.getTime();
      totalMinutes += Math.floor(diffMs / 1000 / 60);
    }
  });

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return {
    nodeId,
    totalMinutes,
    formattedDuration: `${hours}h ${minutes}m`
  };
}


// ==========================================
// 5. 节点创建与 rootId 维护 (性能优化)
// ==========================================

import { generateWBSNodeNumber, extractWBSCodes, LEVEL_PREFIX_MAP, CATEGORY_MAP } from './nodeNumberService';

/**
 * 创建新节点，自动维护 rootId，并支持回溯机制
 */
export async function createPlanNode(data: {
  title: string;
  description?: string;
  parentId?: number;
  level: number;
  owner?: string;
  priority?: string;
  targetDate?: Date;
  plannedEndDate?: string;
  periodType?: string; // YEAR / MONTH / WEEK
  planStatus?: string;
  outputContent?: string;
  progress?: number;
  dataFeedback?: string;
  issueLog?: string;
  planCategory?: string;
  evolutionTag?: string;
}) {
  let rootId: number | null = null;
  let parentId = data.parentId;

  // [New] Generate Node Number (WBS DNA)
  let category = data.planCategory || 'WORK';
  
  if (parentId) {
      const parent = await prisma.planNode.findUnique({ where: { id: parentId } });
      if (parent && parent.planCategory) {
          category = parent.planCategory;
      }
  }
  
  if (!parentId && data.planCategory && data.planCategory !== category) {
       category = data.planCategory;
  }
  
  // Safety Guard: planCategory must be valid
  const validCategories = Object.keys(CATEGORY_MAP).filter(k => isNaN(Number(k)));
  if (!validCategories.includes(category) && !validCategories.includes(category.toUpperCase())) {
      // Default to 'WORK' or '工作' if invalid? Or throw?
      // Let's assume user passes Chinese '工作', we need to map to code '01'.
      // But we store the STRING in planCategory.
      // Schema says: planCategory String? // 分类 (e.g. '工作', '生活')
      // nodeNumberService CATEGORY_MAP has: '工作': '01', 'WORK': '01'
      // So we should store what the user passed, as long as it maps to a code.
      if (!CATEGORY_MAP[category] && !CATEGORY_MAP[category.toUpperCase()]) {
          throw new Error(`Invalid planCategory: ${category}`);
      }
  }
  
  // [New] Management Audit: Automated Tagging (PLAN_OUTSIDE)
  // 规则：若当前日期不在年初定义的“规划窗口期” (1月)，且创建的是 YEAR/MONTH 规划层任务，标记为 PLAN_OUTSIDE
  let evolutionTag = 'ORIGINAL';
  
  if (data.level <= 6) { // 仅针对规划层 (L1-L6)
      const now = new Date();
      // 规划窗口期：每年 1月 (Month 0)
      const isPlanningWindow = now.getMonth() === 0; 
      
      if (!isPlanningWindow) {
          // 非窗口期创建的规划任务 -> 计划外新增
          evolutionTag = 'PLAN_OUTSIDE';
      }
  }
  
  // 0. [Strict Mode] Lock "Unplanned" Task Flow
  // 规则：周报 (WEEK) 仅负责认领，严禁创建无父级的新任务
  // Backtracking logic removed/disabled to enforce this.
  if (data.periodType === 'WEEK' && !parentId) {
      throw new Error("Weekly tasks must be claimed from Monthly plan. Cannot create standalone Week node.");
  }

  /* Backtracking Logic Disabled
  if (data.periodType === 'WEEK' && !parentId) {
      console.log('Detected unplanned WEEK task, initiating backtracking...');
      // ... (Code commented out)
  }
  */

  const nodeNumber = await generateWBSNodeNumber(category, parentId, data.periodType || undefined);
  const wbsCodes = extractWBSCodes(nodeNumber);

  // Safety Guard: Prefix Check (Implicitly handled by generator logic which uses parent.nodeNumber)
  // But let's verify if parentId exists.
  if (parentId) {
      const parent = await prisma.planNode.findUnique({ where: { id: parentId } });
      if (parent && parent.nodeNumber && !nodeNumber.startsWith(parent.nodeNumber)) {
           throw new Error(`Safety Guard Violation: Child node number ${nodeNumber} does not start with parent ${parent.nodeNumber}`);
      }
  }

  // 1. 如果有父节点，继承父节点的 rootId
  if (parentId && !rootId) {
    const parent = await prisma.planNode.findUnique({
      where: { id: parentId },
      select: { rootId: true, id: true } 
    });
    
    if (parent) {
      rootId = parent.rootId || parent.id; 
    }
  }

  // 2. 创建节点
  const newNode = await prisma.planNode.create({
    data: {
      title: data.title,
      description: data.description,
      parentId: parentId,
      level: data.level,
      owner: data.owner,
      priority: data.priority || 'P1',
      plannedEndDate: data.plannedEndDate,
      targetDate: data.targetDate,
      periodType: data.periodType,
      planStatus: data.planStatus,
      dataFeedback: data.dataFeedback || data.outputContent, // Compatible
      progress: data.progress || 0,
      issueLog: data.issueLog,
      rootId,
      planCategory: category,
      nodeNumber: nodeNumber,
      planCategoryCode: wbsCodes.planCategoryCode,
      objectiveCode: wbsCodes.objectiveCode,
      krCode: wbsCodes.krCode,
      detail1Code: wbsCodes.detail1Code,
      detail2Code: wbsCodes.detail2Code,
      monthCode: wbsCodes.monthCode,
      weekCode: wbsCodes.weekCode,
      evolutionTag: data.evolutionTag || evolutionTag // Allow override if passed (e.g. INHERITED)
    }
  });
  
  // 3. 特殊情况：如果是 L1 节点 (无 parentId)，更新其 rootId 指向自身
  if (!parentId && !rootId) {
     await prisma.planNode.update({
       where: { id: newNode.id },
       data: { rootId: newNode.id }
     });
     newNode.rootId = newNode.id;
  }

  return newNode;
}

/**
 * 初始化下周周报 (Action: Week-to-Week Inheritance)
 * 逻辑：自动扫描本周进度 < 100% 的记录，将其克隆为下周的‘重点工作’
 * @param nextWeekCode 下周周次 (e.g. '02')
 */
export async function initializeNextWeekReport(nextWeekCode: string) {
    const nextWeekInt = parseInt(nextWeekCode, 10);
    if (isNaN(nextWeekInt) || nextWeekInt <= 1) {
        throw new Error('Invalid next week code. Must be > 01.');
    }
    
    // 1. Determine Current Week Code
    const currentWeekCode = (nextWeekInt - 1).toString().padStart(2, '0');
    console.log(`Initializing Week ${nextWeekCode} from Week ${currentWeekCode}...`);

    // 2. Fetch Current Week's Unfinished Tasks
    const unfinishedNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
            weekCode: currentWeekCode,
            progress: { lt: 100 },
            status: { notIn: ['COMPLETED', 'CANCELLED'] }
        }
    });

    const results = [];

    // 3. Clone to Next Week
    for (const node of unfinishedNodes) {
        if (!node.parentId) continue;

        // Use claimTasksToWeeklyReport logic to ensure consistency
        // But we need to handle single item.
        // Also, claimTasksToWeeklyReport expects Parent IDs (M nodes).
        // Here we have W nodes. We need their Parent IDs.
        
        // Check if already claimed for next week
        const existing = await prisma.planNode.findFirst({
            where: {
                parentId: node.parentId,
                weekCode: nextWeekCode,
                level: 7
            }
        });

        if (existing) {
            results.push({ id: node.id, status: 'SKIPPED', reason: 'Already exists' });
            continue;
        }

        // Call claim logic
        // We reuse the core logic of claimTasksToWeeklyReport but we might want to copy 'progress'?
        // Requirement: "Clone as Key Tasks". Usually starts fresh or continues?
        // User didn't specify keeping progress. Standard WBS practice for new period is often 0% action progress.
        // But "Inheritance" might imply keeping it.
        // However, since `claimTasksToWeeklyReport` is the "Claim" engine, let's use it.
        // Wait, `claimTasksToWeeklyReport` initializes description to empty.
        // Should we copy the description? "Clone... preserving parent genes".
        // If it's the *same* task continued, maybe description should be copied?
        // Let's manually create to be safe and flexible.

        // Get Parent to ensure it exists (and get nodeNumber)
        const parent = await prisma.planNode.findUnique({ where: { id: node.parentId } });
        if (!parent || !parent.nodeNumber) continue;

        const newNodeNumber = `${parent.nodeNumber}-W${nextWeekCode}`;

        const newNode = await prisma.planNode.create({
            data: {
                title: node.title, // Keep Title
                description: node.description, // Keep Description (Context is important for continued tasks)
                parentId: parent.id,
                rootId: parent.rootId || parent.id,
                level: 7,
                
                // Genes
                planCategory: parent.planCategory,
                planCategoryCode: parent.planCategoryCode,
                objectiveCode: parent.objectiveCode,
                krCode: parent.krCode,
                detail1Code: parent.detail1Code,
                detail2Code: parent.detail2Code,
                monthCode: parent.monthCode,
                weekCode: nextWeekCode, // NEW Week
                evolutionTag: parent.evolutionTag,
                
                nodeNumber: newNodeNumber,
                periodType: 'WEEK',
                planStatus: 'PLANNED', // Reset status to PLANNED
                priority: node.priority,
                owner: node.owner,
                
                progress: node.progress, // [Decision] Keep Progress for Continuity
                // dataFeedback/issueLog cleared for new week
            }
        });
        
        results.push({ id: node.id, status: 'SUCCESS', newNode });
    }

    return {
        sourceWeek: currentWeekCode,
        targetWeek: nextWeekCode,
        processed: results.length,
        details: results
    };
}

/**
 * 获取分类汇总报表 (Report Category Aggregation)
 * @param period 'MONTH' | 'YEAR'
 * @param date Target Date
 */
export async function getCategorizedReport(period: 'MONTH' | 'YEAR', date: Date = new Date()) {
    // 1. Get flat list of aggregated nodes
    const nodes = await getPeriodicReportNodes(period, date);
    
    // 2. Group by planCategory
    const grouped: Record<string, any[]> = {};
    
    // Initialize standard categories
    const categories = ['工作', '生活', '学习'];
    categories.forEach(c => grouped[c] = []);
    
    nodes.forEach(node => {
        // Map category code or string to key
        // planCategory field usually stores Chinese '工作', etc.
        const category = node.planCategory || '其他';
        
        if (!grouped[category]) {
            grouped[category] = [];
        }
        grouped[category].push(node);
    });
    
    return grouped;
}

/**
 * 认领执行任务到周报 (Claim Tasks to Weekly Report)
 * @param taskIds 选中的 M 节点 ID 列表
 * @param weekCode 周次编码 (e.g. '01', '02')
 * @param owner 认领人 (可选，默认继承)
 */
export async function claimTasksToWeeklyReport(taskIds: number[], weekCode: string, owner?: string) {
    const results = [];
    
    for (const parentId of taskIds) {
        // 1. Fetch Parent M Node
        const parent = await prisma.planNode.findUnique({
            where: { id: parentId }
        });
        
        if (!parent) {
            results.push({ id: parentId, status: 'FAILED', reason: 'Parent not found' });
            continue;
        }

        // 2. Anti-Duplication Check
        // Check if a W node with same weekCode already exists under this parent
        const existing = await prisma.planNode.findFirst({
            where: {
                parentId: parent.id,
                level: 7, // W Node
                weekCode: weekCode
            }
        });

        if (existing) {
            results.push({ id: parentId, status: 'SKIPPED', reason: 'Already claimed for this week', existingId: existing.id });
            continue;
        }

        // 3. Generate Node Number
        // Logic: Parent NodeNumber + '-W' + weekCode
        // e.g. F01O01KR01D101D201M01-W01
        // Note: We use manual construction to adhere to "Execution Layer" suffix rule.
        // But we should verify parent has a nodeNumber.
        if (!parent.nodeNumber) {
            results.push({ id: parentId, status: 'FAILED', reason: 'Parent has no nodeNumber' });
            continue;
        }
        const newNodeNumber = `${parent.nodeNumber}-W${weekCode}`;

        // 4. Create W Node
        const newNode = await prisma.planNode.create({
            data: {
                title: parent.title, // Inherit Title
                description: '', // Initial empty for user to fill
                parentId: parent.id,
                rootId: parent.rootId || parent.id, // Inherit Root ID
                level: 7, // W Level
                
                // Bloodline Cloning
                planCategory: parent.planCategory,
                planCategoryCode: parent.planCategoryCode,
                objectiveCode: parent.objectiveCode,
                krCode: parent.krCode,
                detail1Code: parent.detail1Code,
                detail2Code: parent.detail2Code,
                monthCode: parent.monthCode,
                weekCode: weekCode, // Set current week code
                evolutionTag: parent.evolutionTag, // Inherit Audit Tag
                
                nodeNumber: newNodeNumber,
                
                periodType: 'WEEK',
                planStatus: 'PLANNED',
                priority: parent.priority, // Inherit Priority
                owner: owner || parent.owner, // Assign Owner
                
                // Execution Fields Initialization
                // dataFeedback & issueLog are implicitly null (required to be filled later)
                progress: 0
            }
        });
        
        results.push({ id: parentId, status: 'SUCCESS', newNode });
    }
    
    return results;
}

/**
 * 认领任务：WEEK 认领 MONTH，MONTH 认领 YEAR
 * @param parentId 上级任务 ID
 * @param claimer 认领人
 * @param periodType 认领后的周期类型 (e.g. WEEK)
 */
export async function claimTask(parentId: number, claimer: string, periodType: string) {
    const parent = await prisma.planNode.findUnique({
        where: { id: parentId }
    });

    if (!parent) throw new Error('Parent task not found');

    // 创建子任务
    const childLevel = parent.level + 1; // 简单假设层级+1
    const childNode = await createPlanNode({
        title: parent.title, // 继承标题
        description: parent.description || undefined,
        parentId: parent.id,
        level: childLevel,
        owner: claimer,
        priority: parent.priority,
        plannedEndDate: parent.plannedEndDate || undefined, // 继承上线时间
        planStatus: parent.planStatus || undefined, // 继承计划状态
        periodType: periodType
    });

    return childNode;
}

/**
 * 获取本周周报需要展示的任务
 * 包括：本周新建/更新的任务 + 上周未完成自动继承的任务
 */
export async function getWeeklyReportNodes() {
    // 1. 获取本周任务 (仅限 WORK 分类)
    const now = new Date();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    startOfWeek.setHours(0, 0, 0, 0);

    const currentWeekNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
            planCategoryCode: '01', // [Safety Guard] 核心隔离：仅推送工作分类 (Code 01)
            updatedAt: { gte: startOfWeek }
        }
    });

    // 2. 获取上周未完成任务 (自动继承)
    // 假设上周是 startOfWeek - 7 days 到 startOfWeek
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
    
    const unfinishedLastWeekNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
            planCategoryCode: '01', // [Safety Guard] 核心隔离：仅推送工作分类 (Code 01)
            updatedAt: {
                gte: startOfLastWeek,
                lt: startOfWeek
            },
            progress: { lt: 100 }
        }
    });

    // 合并并去重
    const allNodes = [...currentWeekNodes, ...unfinishedLastWeekNodes];
    // Simple deduplication by id just in case
    const uniqueNodes = Array.from(new Map(allNodes.map(item => [item.id, item])).values());
    
    return uniqueNodes;
}

/**
 * 获取所有节点
 */
export async function getAllNodes() {
  return await prisma.planNode.findMany({
    orderBy: { createdAt: 'asc' }
  });
}

/**
 * 获取特定层级的节点
 */
export async function getNodesByLayer(layer: number) {
  return await prisma.planNode.findMany({
    where: { level: layer },
    orderBy: { priority: 'asc' } // P0 first (string sort works for P0, P1...)
  });
}

/**
 * 更新节点
 * [Refactor] Title Cascade: If title is updated, cascade to all children
 * [Refactor] Progress Feedback: If progress is updated, cascade to parent
 * [Refactor] WBS Cascade: If any code field is updated, cascade identity to all children
 */
export async function updatePlanNode(id: number, data: any) {
    const original = await prisma.planNode.findUnique({ where: { id } });
    if (!original) throw new Error('Node not found');

    // [New] Check if WBS fields changed
    const wbsFields = ['planCategory', 'planCategoryCode', 'objectiveCode', 'krCode', 'detail1Code', 'detail2Code', 'monthCode', 'weekCode'];
    const hasWBSChange = wbsFields.some(field => data[field] !== undefined && data[field] !== (original as any)[field]);

    if (hasWBSChange) {
        console.log(`WBS fields changed for Node ${id}. Recalculating identity...`);
        
        // 1. Determine new code for current level
        let newCode = '';
        
        // Special handling for Category (Level 1)
        if (original.level === 1) {
             if (data.planCategory) {
                 newCode = CATEGORY_MAP[data.planCategory] || '99';
             } else if (data.planCategoryCode) {
                 newCode = data.planCategoryCode;
             } else {
                 newCode = original.planCategoryCode || '99';
             }
        } else {
            // For L2-L7, get the code field corresponding to the level
            // Map Level to Field Name
            const levelFieldMap: Record<number, string> = {
                2: 'objectiveCode',
                3: 'krCode',
                4: 'detail1Code',
                5: 'detail2Code',
                6: 'monthCode',
                7: 'weekCode'
            };
            const fieldName = levelFieldMap[original.level];
            if (fieldName) {
                newCode = data[fieldName] || (original as any)[fieldName];
            }
        }
        
        // 2. Construct new Node Number
        let prefix = '';
        if (original.parentId) {
            const parent = await prisma.planNode.findUnique({ where: { id: original.parentId } });
            if (parent && parent.nodeNumber) {
                prefix = parent.nodeNumber;
            }
        }
        
        // Append type prefix (F, O, KR...)
        const typePrefix = LEVEL_PREFIX_MAP[original.level];
        if (typePrefix) {
            const newNodeNumber = original.level === 1 
                ? `F${newCode}` 
                : `${prefix}${typePrefix}${newCode}`;
                
            if (original.nodeNumber && newNodeNumber !== original.nodeNumber) {
                console.log(`Node Identity Changed: ${original.nodeNumber} -> ${newNodeNumber}`);
                data.nodeNumber = newNodeNumber;
                
                // Sync all code fields
                const newCodes = extractWBSCodes(newNodeNumber);
                Object.assign(data, newCodes);
            }
        }
    }

    const updated = await prisma.planNode.update({
        where: { id },
        data
    });

    // Check if nodeNumber changed (Cascade Children)
    if (original.nodeNumber && updated.nodeNumber && original.nodeNumber !== updated.nodeNumber) {
        await cascadeNodeNumberUpdate(id, original.nodeNumber, updated.nodeNumber);
    }

    // Check if title changed
    if (original && data.title && data.title !== original.title) {
        console.log(`Title changed for Node ${id} from "${original.title}" to "${data.title}". Cascading update...`);
        // We need to pass the OLD title to find which children to update
        await cascadeTitleUpdate(id, original.title, data.title);
    }

    // Check if progress changed
    if (data.progress !== undefined && original && data.progress !== original.progress) {
        console.log(`Progress changed for Node ${id}. Triggering parent update...`);
        if (original.parentId) {
            await updateParentProgressRecursive(original.parentId);
        }
    }

    // [New] Management Audit: Strategy Adjust (M Node Title/Content Change)
    if (original.level === 6) { // Month Node
        const isTitleChanged = data.title && data.title !== original.title;
        // Check content change (mapped to dataFeedback or description)
        const isContentChanged = (data.dataFeedback && data.dataFeedback !== original.dataFeedback) ||
                                 (data.description && data.description !== original.description);

        if (isTitleChanged || isContentChanged) {
            console.log(`[Audit] Strategy Adjustment detected for M Node ${id}`);
            // Only update tag if it's not already something else specific? 
            // Or overwrite? Requirement: "System automatically changes evolutionTag to STRATEGY_ADJUST"
            await prisma.planNode.update({
                where: { id },
                data: { evolutionTag: 'STRATEGY_ADJUST' }
            });
        }
    }

    return updated;
}

/**
 * Recursive function to update children's nodeNumber and WBS codes
 * Updates children that have the nodeNumber starting with oldPrefix
 */
async function cascadeNodeNumberUpdate(parentId: number, oldPrefix: string, newPrefix: string) {
    // Find all descendants that start with oldPrefix
    // Note: Since we already updated the parent, it won't be found here (good).
    const descendants = await prisma.planNode.findMany({
        where: {
            nodeNumber: { startsWith: oldPrefix }
        }
    });
    
    // Reverse Map for Category Sync
    const CODE_TO_CATEGORY: Record<string, string> = {};
    for (const [key, value] of Object.entries(CATEGORY_MAP)) {
        CODE_TO_CATEGORY[value] = key;
    }

    for (const child of descendants) {
        if (!child.nodeNumber) continue;
        
        // Replace prefix
        const newChildNodeNumber = child.nodeNumber.replace(oldPrefix, newPrefix);
        
        // Extract codes
        const newCodes = extractWBSCodes(newChildNodeNumber);
        
        const updateData: any = {
            nodeNumber: newChildNodeNumber,
            ...newCodes
        };

        // Sync Category String if code changed
        if (newCodes.planCategoryCode && CODE_TO_CATEGORY[newCodes.planCategoryCode]) {
             updateData.planCategory = CODE_TO_CATEGORY[newCodes.planCategoryCode];
        }
        
        await prisma.planNode.update({
            where: { id: child.id },
            data: updateData
        });
        
        console.log(`Cascaded WBS Update: Child ${child.id} ${child.nodeNumber} -> ${newChildNodeNumber}`);
    }
}

/**
 * Recursive function to update children's title
 * Updates children that have the EXACT SAME title as the old parent title.
 */
async function cascadeTitleUpdate(parentId: number, oldTitle: string, newTitle: string) {
    // 1. Find children that match the OLD title (e.g., claimed tasks)
    const children = await prisma.planNode.findMany({
        where: {
            parentId: parentId,
            title: oldTitle
        }
    });

    if (children.length === 0) return;

    // 2. Update them
    for (const child of children) {
        await prisma.planNode.update({
            where: { id: child.id },
            data: { title: newTitle }
        });
        console.log(`Cascaded update: Child Node ${child.id} renamed to "${newTitle}"`);

        // 3. Recurse (Grandchildren)
        await cascadeTitleUpdate(child.id, oldTitle, newTitle);
    }
}


/**
 * 删除节点 (Safety Guard: Cascade Protection & Logic Cleanup)
 * 1. Check children (Block if exists)
 * 2. Unlink ScheduleNodes (Set relatedPlanId = null)
 * 3. Unlink WorkLogs (Set relatedNodeId = null)
 * 4. Delete Node
 */
export async function deletePlanNode(id: number) {
  // 1. Check for children
  const node = await prisma.planNode.findUnique({
      where: { id },
      include: { children: true }
  });

  if (!node) {
      throw new Error('Node not found');
  }

  if (node.children && node.children.length > 0) {
      throw new Error('请先删除下级关联任务，以确保 WBS 基因链完整');
  }

  // 2. Unlink ScheduleNodes
  await prisma.scheduleNode.updateMany({
      where: { relatedPlanId: id },
      data: { relatedPlanId: null }
  });

  // 3. Unlink WorkLogs (Logical association)
  await prisma.workLog.updateMany({
      where: { relatedNodeId: id },
      data: { relatedNodeId: null }
  });

  // 4. Safe to delete
  return await prisma.planNode.delete({
    where: { id }
  });
}

/**
 * 获取所有用户 (确保特定用户存在)
 */
export async function getAllUsers() {
  const targetUsers = [
    { email: 'fan@loveme.os', name: '樊云川' },
    { email: 'huang@loveme.os', name: '黄心怡' },
    { email: 'pending@loveme.os', name: '待分配' },
  ];

  for (const u of targetUsers) {
    const existing = await prisma.user.findFirst({
        where: { name: u.name }
    });
    if (!existing) {
        try {
             await prisma.user.create({ data: u });
        } catch (e) {
            console.log(`User ${u.name} might already exist or email conflict`);
        }
    }
  }

  return await prisma.user.findMany();
}

/**
 * 记录推送历史 (Enhanced for Persistence)
 */
export async function savePushHistory(
    content: string, 
    status: string, 
    platform: string,
    reportType?: string,
    reportPeriod?: string,
    snapshotData?: string
) {
    return await prisma.pushHistory.create({
        data: {
            content,
            status,
            platform,
            reportType,
            reportPeriod,
            snapshotData
        }
    });
}

/**
 * 获取推送历史 (Supported filtering)
 */
export async function getPushHistory(filters?: {
    reportType?: string;
    year?: number;
    month?: number;
}) {
    const whereCondition: any = {};
    
    if (filters?.reportType) {
        whereCondition.reportType = filters.reportType;
    }

    if (filters?.year) {
        const start = new Date(filters.year, filters.month ? filters.month - 1 : 0, 1);
        const end = filters.month 
            ? new Date(filters.year, filters.month, 0, 23, 59, 59)
            : new Date(filters.year, 11, 31, 23, 59, 59);
            
        whereCondition.createdAt = {
            gte: start,
            lte: end
        };
    }

    return await prisma.pushHistory.findMany({
        where: whereCondition,
        orderBy: { createdAt: 'desc' },
        take: 50
    });
}

/**
 * 聚合周期性报表 (月报/年报) - 核心镜像算法
 * 
 * 逻辑：
 * 1. 月报 (MONTH): 聚合本月内的所有 WEEK 节点，仅保留 P0/P1
 * 2. 年报 (YEAR): 聚合本年内的所有 WEEK 节点，仅保留 P0
 * 3. 镜像去重: 同一 rootId 的节点，取 progress 最高的一条；若 progress 相同，取 updatedAt 最新的一条
 */
export async function getPeriodicReportNodes(period: 'HALF_MONTH' | 'MONTH' | 'YEAR', date: Date = new Date()) {
    let startDate: Date;
    let endDate: Date;
    let priorityFilter: string[] | undefined;

    // 1. 确定时间范围和筛选策略
    if (period === 'HALF_MONTH') {
        // [New] 半月报范围：1-15 (H1) 或 16-月底 (H2)
        // 判定 H1 还是 H2
        const day = date.getDate();
        if (day <= 15) {
            // H1: 1st - 15th
            startDate = new Date(date.getFullYear(), date.getMonth(), 1);
            endDate = new Date(date.getFullYear(), date.getMonth(), 15, 23, 59, 59);
        } else {
            // H2: 16th - End of Month
            startDate = new Date(date.getFullYear(), date.getMonth(), 16);
            endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);
        }
        // [Full Coverage] 不进行优先级过滤
        priorityFilter = undefined;

    } else if (period === 'MONTH') {
        // [Refactor] 归属判定：以周五所在月份为准 (Friday Anchor Method)
        // 计算本月包含的所有“周报周”的时间范围
        // 逻辑：本月的“周报周”是指：该周的周五必须落在本月内
        
        // Find the first Friday of the month
        const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
        let firstFriday = new Date(firstDayOfMonth);
        while (firstFriday.getDay() !== 5) {
            firstFriday.setDate(firstFriday.getDate() + 1);
        }
        
        // Find the last Friday of the month
        const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        let lastFriday = new Date(lastDayOfMonth);
        while (lastFriday.getDay() !== 5) {
            lastFriday.setDate(lastFriday.getDate() - 1);
        }

        // 确定查询的起止时间：
        // Start: First Friday's Monday (Friday - 4 days)
        // End: Last Friday's Sunday (Friday + 2 days)
        // 注意：updatedAt 是任务更新时间。
        // 我们需要抓取的是：在这个“Reporting Month”时间段内活跃的任务。
        // 为了简化查询，我们放宽查询范围，然后在内存中根据 "Friday Anchor" 再次过滤。
        
        startDate = new Date(firstFriday);
        startDate.setDate(startDate.getDate() - 4); // The Monday of the first valid week
        startDate.setHours(0, 0, 0, 0);

        endDate = new Date(lastFriday);
        endDate.setDate(endDate.getDate() + 2); // The Sunday of the last valid week
        endDate.setHours(23, 59, 59, 999);

        priorityFilter = ['P0', 'P1'];
    } else {
        // 本年第一天 ~ 本年最后一天
        startDate = new Date(date.getFullYear(), 0, 1);
        endDate = new Date(date.getFullYear(), 11, 31, 23, 59, 59);
        priorityFilter = ['P0'];
    }

    // 2. 抓取所有符合条件的底层 WEEK 节点
    const whereCondition: any = {
        periodType: 'WEEK',
        updatedAt: { gte: startDate, lte: endDate },
        // [New] Filter CANCELLED
        status: { not: 'CANCELLED' }
    };

    if (priorityFilter) {
        whereCondition.priority = { in: priorityFilter };
    }

    const rawNodes = await prisma.planNode.findMany({
        where: whereCondition,
        orderBy: { updatedAt: 'desc' } // 默认按时间倒序，方便后续处理
    });

    // 3. 镜像去重算法
    // Map key: title (按标题聚合，视为同一任务) -> value: PlanNode
    const consolidatedMap = new Map<string, any>();

    for (const node of rawNodes) {
        // [Refactor] 再次校验 "Friday Anchor" (因为 rawNodes 查询范围可能稍微宽泛)
        // 确保该任务的最后更新时间所在的“周报周”确实归属于本月
        if (period === 'MONTH') {
            const updateDate = new Date(node.updatedAt);
            const friday = new Date(updateDate);
            // Find Friday of this week:
            // Day 0 (Sun) -> +5
            // Day 1 (Mon) -> +4 ...
            // Day 5 (Fri) -> +0
            // Day 6 (Sat) -> -1
            const day = friday.getDay();
            const diff = 5 - day; 
            // Note: If updateDate is Sunday, day=0. Fri is updateDate + 5 days?
            // Week starts Mon. So Sun is end of week. Fri is updateDate - 2.
            // Let's standardise: Week is Mon-Sun.
            // If Sun(0): Fri is -2.
            // If Mon(1): Fri is +4.
            // Formula: diff = 5 - (day === 0 ? 7 : day)
            const dayAdjusted = day === 0 ? 7 : day;
            friday.setDate(friday.getDate() + (5 - dayAdjusted));
            
            // Check if this Friday falls in the target month
            if (friday.getMonth() !== date.getMonth()) {
                continue; // Skip this node, it belongs to another month's report
            }
        }

        // 使用 title 作为唯一标识
        const trackId = node.title;
        
        if (!consolidatedMap.has(trackId)) {
            // 首次遇到，直接存入
            consolidatedMap.set(trackId, { 
                ...node, 
                aggregatedFeedback: node.dataFeedback ? [node.dataFeedback] : [],
                aggregatedIssues: node.issueLog ? [node.issueLog] : [] 
            });
        } else {
            // 已存在，比较 progress
            const existing = consolidatedMap.get(trackId);
            
            // [Fix] Aggregate dataFeedback regardless of who is latest
            if (node.dataFeedback && !existing.aggregatedFeedback.includes(node.dataFeedback)) {
                 existing.aggregatedFeedback.push(node.dataFeedback);
            }
            // [New] Aggregate issueLog
            if (node.issueLog && !existing.aggregatedIssues.includes(node.issueLog)) {
                 existing.aggregatedIssues.push(node.issueLog);
            }

            // [Fix] Latest Update Rule: progress > existing OR (progress == existing AND updatedAt > existing)
            // 确保进度一致时，取最新修改的版本（描述、反馈等可能是新的）
            if (node.progress > existing.progress || 
               (node.progress === existing.progress && node.updatedAt > existing.updatedAt)) {
                // Update fields but keep aggregatedFeedback & aggregatedIssues
                const aggregatedFeedback = existing.aggregatedFeedback;
                const aggregatedIssues = existing.aggregatedIssues;
                consolidatedMap.set(trackId, { ...node, aggregatedFeedback, aggregatedIssues });
            }
        }
    }

    // 4. 转换回数组并排序 (按优先级 P0 -> P1)
    const sortedNodes = Array.from(consolidatedMap.values()).map(n => ({
        ...n,
        // Join feedback for display
        dataFeedback: n.aggregatedFeedback.length > 0 ? n.aggregatedFeedback.join('; ') : n.dataFeedback,
        issueLog: n.aggregatedIssues.length > 0 ? n.aggregatedIssues.join('; ') : n.issueLog
    })).sort((a, b) => {
        if (a.priority === b.priority) return 0;
        return a.priority === 'P0' ? -1 : 1;
    });

    // 5. [New] Health Diagnosis (健康度诊断)
    const now = new Date();
    const tenDays = 10 * 24 * 60 * 60 * 1000;

    return await Promise.all(sortedNodes.map(async (node) => {
        let healthStatus = 'HEALTHY';

        // Check 1: STAGNANT (停滞)
        // P0/P1 & No update in 10 days
        const lastUpdate = new Date(node.updatedAt);
        if ((node.priority === 'P0' || node.priority === 'P1') && (now.getTime() - lastUpdate.getTime() > tenDays)) {
            healthStatus = 'STAGNANT';
        }

        // Check 2: DISCREPANCY (进度严重不符)
        // Check if node has children and if their average progress matches parent
        // We need to fetch children to verify this
        const nodeWithChildren = await prisma.planNode.findUnique({
            where: { id: node.id },
            include: { children: true }
        });

        if (nodeWithChildren && nodeWithChildren.children.length > 0) {
            const totalProgress = nodeWithChildren.children.reduce((sum, child) => sum + child.progress, 0);
            const avgProgress = totalProgress / nodeWithChildren.children.length;
            
            // Allow 5% deviation (floating point issues or manual minor adjustment)
            if (Math.abs(node.progress - avgProgress) > 5) {
                healthStatus = 'DISCREPANCY';
            }
        }

        return {
            ...node,
            healthStatus
        };
    }));
}

/**
 * 获取下周计划 (Next Week Plan)
 * 逻辑：
 * 1. 自动继承本周未完成的 P0/P1 任务 (Progress < 100)
 * 2. 抓取从未在周报中认领过的 Monthly 任务 (P0/P1)
 *    [Refactor] 必须抓取“当前 Reporting Month”的月度任务
 */
export async function getNextWeekPlanNodes() {
    // 1. 本周未完成 (Week Tasks, Progress < 100, P0/P1)
    const now = new Date();
    
    // Calculate Reporting Month (Friday Anchor)
    const todayDay = now.getDay() === 0 ? 7 : now.getDay();
    const friday = new Date(now);
    friday.setDate(now.getDate() + (5 - todayDay));
    // The Month tasks we can claim MUST belong to the Reporting Month of this Friday
    const reportingMonth = friday.getMonth();
    const reportingYear = friday.getFullYear();

    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    startOfWeek.setHours(0, 0, 0, 0);

    const unfinishedWeekNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
            updatedAt: { gte: startOfWeek },
            progress: { lt: 100 }
            // [Fix] Full Process Coverage: No Priority Filter
            // 下周计划属于过程管理，必须包含所有未完成任务 (P0-P4)
        }
    });

    // 2. 未认领的月度计划 (Month Tasks, Progress < 100, P0/P1, No Week Children)
    // Month Plan (Claim Pool) usually focuses on P0/P1.
    // But user requirement says "Full Process Coverage" for Next Week Plan.
    // Does "Full Process Coverage" apply to Claim Pool too?
    // "周报和下周计划属于“过程管理”，必须全量继承所有 progress < 100 的任务"
    // Usually Month Plans are strategic. Let's assume Claim Pool also shows all P0-P4 Month Tasks?
    // Or keep P0/P1 filter for Month tasks to avoid clutter?
    // User explicitly mentioned "delete priority: { in: ['P0', 'P1'] }".
    // Let's remove it for consistency.
    
    // [Cross-Year Logic] If reportingMonth is Jan (0), and we are in Dec, we might look ahead?
    // Current Requirement: "检测到跨年周时，支持从下一年度的 YEAR 规划中认领任务"
    // Actually, `claimTask` logic supports claiming from parent. 
    // Here we are fetching "Unclaimed Monthly Tasks".
    // If we are in the last week of Dec, the "Friday Anchor" might already be in Jan next year.
    // In that case, `reportingYear` will be next year, and we will fetch next year's Month tasks.
    // So the existing "Friday Anchor" logic ALREADY handles picking the correct month/year bucket.
    // However, if we need to claim from *Year* tasks directly (Year -> Month -> Week),
    // we need to ensure we can see Next Year's Year Plan if we are near the end of year.
    // But `getNextWeekPlanNodes` currently fetches `MONTH` tasks to claim into `WEEK`.
    // It doesn't fetch `YEAR` tasks to claim into `MONTH`.
    // Assuming the user means "When generating next week plan, if next week belongs to Jan, show Jan Month Tasks".
    // My code already does `const reportingMonth = friday.getMonth()`. 
    // If Friday is Jan 2nd, reportingMonth is Jan.
    
    const monthStart = new Date(reportingYear, reportingMonth, 1);
    const monthEnd = new Date(reportingYear, reportingMonth + 1, 0, 23, 59, 59);

    const activeMonthNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'MONTH',
            updatedAt: { gte: monthStart }, 
            progress: { lt: 100 },
            // [New] Status Filter
            status: { notIn: ['COMPLETED', 'CANCELLED'] }
        },
        include: { children: true }
    });

    const unclaimedMonthNodes = activeMonthNodes.filter(mNode => {
        // Check if any child is a WEEK node
        const hasWeekChild = mNode.children.some(child => child.periodType === 'WEEK');
        return !hasWeekChild;
    });

    // [Robustness] "Backtracking Inheritance" for Holiday Gap
    // "如果上一自然周没有周报记录（放假），系统须自动向后追溯"
    // Current logic: `unfinishedWeekNodes` fetches `updatedAt` >= `startOfWeek`.
    // If I didn't write report last week, `updatedAt` will be old (2 weeks ago).
    // So `startOfWeek` filter excludes them.
    // FIX: Instead of `updatedAt >= startOfWeek`, we should find:
    // 1. All Unfinished Week Tasks (P0/P1).
    // 2. That are the "Latest Version" (Leaf nodes in Week chain).
    // 3. And exclude those that are already "closed" or "too old" (optional, but "unfinished" implies active).
    
    // Revised Logic for `unfinishedWeekNodes`:
    // Fetch ALL unfinished WEEK tasks (P0/P1) regardless of time?
    // Maybe restrict to "updated in last 30 days" to cover long holidays.
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - 45); // 45 days buffer for long holidays

    const allUnfinishedWeekNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
            updatedAt: { gte: lookbackDate }, // Look back 45 days
            progress: { lt: 100 },
            // [New] Status Filter: Not COMPLETED or CANCELLED
            status: { notIn: ['COMPLETED', 'CANCELLED'] }
            // priority: { in: ['P0', 'P1'] } // [Fix] Removed Priority Filter
        },
        orderBy: { updatedAt: 'desc' }
    });

    // Deduplicate to keep only the LATEST version of each task chain
    // How to identify "Task Chain"? By Title? Or by RootId?
    // User emphasizes "Mirror Deduplication" by Title.
    // So we group by Title and take the latest one.
    const uniqueUnfinishedMap = new Map<string, any>();
    for (const node of allUnfinishedWeekNodes) {
        if (!uniqueUnfinishedMap.has(node.title)) {
            uniqueUnfinishedMap.set(node.title, node);
        } else {
            // Already have one (since we sorted by desc, the first one is latest)
            // But wait, what if the latest one is FINISHED?
            // The query only fetches `progress < 100`.
            // So if the latest version is finished, it won't be in `allUnfinishedWeekNodes`.
            // Then we might pick up an older unfinished version?
            // RISK: Task A (W1) 50%, Task A (W2) 100%.
            // Query returns only Task A (W1). We show Task A (W1) as "Next Week Plan"? NO.
            // We must ensure we don't pick up an old ghost if a newer version exists and is done.
        }
    }
    
    // To solve the "Ghost" issue:
    // We need to check if a "newer, finished" version exists.
    // So we should fetch ALL Week nodes in lookback period, then group by title, pick latest.
    // IF latest is unfinished, THEN include it.
    
    const allRecentWeekNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
            updatedAt: { gte: lookbackDate },
            // priority: { in: ['P0', 'P1'] } // [Fix] Removed Priority Filter
            // [New] Status Filter: Not COMPLETED or CANCELLED
            // We need to fetch ALL statuses to check if latest is COMPLETED/CANCELLED
            // If latest is COMPLETED, we exclude it.
            // If latest is CANCELLED, we exclude it.
            // So we don't strictly filter here, we filter in the loop logic below.
            // Or better: We fetch everything, and then check status.
        },
        orderBy: { updatedAt: 'desc' }
    });

    const finalUnfinishedWeekNodes: any[] = [];
    const processedTitles = new Set<string>();

    for (const node of allRecentWeekNodes) {
        if (processedTitles.has(node.title)) continue;
        processedTitles.add(node.title);

        // This is the latest version. Check if unfinished AND not cancelled.
        // If status is COMPLETED, it means finished (progress should be 100, but trust status more)
        // If status is CANCELLED, exclude.
        
        // Check status
        if (node.status === 'COMPLETED' || node.status === 'CANCELLED') {
            continue; // Task chain is finished or cancelled
        }

        if (node.progress < 100) {
            // [Robustness] Status Protection
            // "长假后的第一份周报应自动保持 50%"
            // Since we pick this node, its progress (e.g. 50) is preserved.
            finalUnfinishedWeekNodes.push(node);
        }
    }

    // Combine
    return [...finalUnfinishedWeekNodes, ...unclaimedMonthNodes];
}

/**
 * 获取可认领的月度任务 (Claimable Month Tasks)
 * 供周报 (Week) 认领使用
 * @param year 目标年份
 * @param month 目标月份
 */
export async function getClaimableTasks(year: number, month: number) {
    const monthCode = month.toString().padStart(2, '0');
    
    // 确定年份范围 (考虑到跨年问题，最好结合 createdAt 或 parent 的年份)
    // 目前简化处理：假设 createdAt 在该年份内
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31, 23, 59, 59);

    return await prisma.planNode.findMany({
        where: {
            level: 6, // M 节点
            monthCode: monthCode,
            createdAt: {
                gte: startDate,
                lte: endDate
            },
            status: { not: 'CANCELLED' } // 仅列出未取消的任务
        },
        orderBy: {
            nodeNumber: 'asc' // 按 WBS 顺序排列
        }
    });
}

/**
 * [New] 手动生成下月计划 (Action Interface)
 * 逻辑：将下一月度的原始规划与本月未完成的 PLAN_OUTSIDE 任务合并生成
 * @param year 目标年份
 * @param month 目标月份 (1-12)
 */
export async function generateNextMonthPlan(year: number, month: number) {
    console.log(`Generating Plan for ${year}-${month}...`);
    
    // 1. 获取目标月份的原始规划 (Original M Nodes)
    // Assuming "Original" means nodes created during Planning Window (Jan)
    // or just nodes that already exist for that month period.
    // Actually, "Original Plan" is M nodes that have evolutionTag='ORIGINAL' (or null/default).
    // Wait, the requirement says "Merge Next Month's Original Plan with This Month's Unfinished PLAN_OUTSIDE".
    // This implies Next Month's plan might already be partially populated (from Annual Plan).
    
    // Target Month Code (e.g. 04 for April)
    const targetMonthCode = month.toString().padStart(2, '0');
    
    // Find existing M nodes for next month
    // We can filter by `monthCode` and `periodType='MONTH'`?
    // But `monthCode` is unique per parent... no, `monthCode` is just '04'.
    // We need to find nodes that *belong* to that month.
    // The `periodType` is MONTH. And we check `createdAt`? No, `targetDate`?
    // Schema doesn't strictly bind M nodes to a calendar month except via `title` or `targetDate` or `monthCode`.
    // But `monthCode` '01' usually means Jan, '02' Feb in standard WBS?
    // Yes, let's assume `monthCode` corresponds to calendar month.
    
    const nextMonthOriginals = await prisma.planNode.findMany({
        where: {
            level: 6, // Month Node
            monthCode: targetMonthCode,
            evolutionTag: 'ORIGINAL'
        }
    });
    
    console.log(`Found ${nextMonthOriginals.length} original tasks for Month ${month}.`);
    
    // 2. 获取本月未完成的任务 (All Unfinished, regardless of source)
    // "This Month" = Target Month - 1
    let currentMonth = month - 1;
    let currentYear = year;
    if (currentMonth === 0) {
        currentMonth = 12;
        currentYear = year - 1;
    }
    const currentMonthCode = currentMonth.toString().padStart(2, '0');
    
    const unfinishedTasks = await prisma.planNode.findMany({
        where: {
            level: 6,
            monthCode: currentMonthCode,
            // [Fix] Removed evolutionTag filter to include ALL unfinished tasks
            progress: { lt: 100 },
            status: { not: 'CANCELLED' }
        }
    });
    
    console.log(`Found ${unfinishedTasks.length} unfinished tasks from Month ${currentMonth}.`);
    
    // 3. Merge: Inherit Unfinished Tasks
    // Create COPY of unfinished tasks in the Target Month
    const inheritedTasks = [];
    
    for (const task of unfinishedTasks) {
        // Check if already inherited (avoid duplicates)
        // How to check? Maybe check title + target month?
        // Or check if we have an INHERITED task with same title in target month.
        const exists = await prisma.planNode.findFirst({
            where: {
                level: 6,
                monthCode: targetMonthCode,
                title: task.title, // Assuming title uniqueness for check
                evolutionTag: 'INHERITED'
            }
        });
        
        if (!exists) {
            // Create Inherited Node
            // We need a Parent (D2) for this new M node.
            // Requirement: "Inherited tasks must keep their original nodeNumber association"
            // This is tricky. 
            // If the original task is F01...D201M03 (March),
            // The new task should be F01...D201M04 (April)?
            // Yes, it should hang under the SAME Parent (D2).
            
            // 1. Get Parent
            if (!task.parentId) continue; // Should have parent
            
            // 2. Generate new NodeNumber for Target Month
            // We need to force the `monthCode` to be `targetMonthCode`?
            // `generateWBSNodeNumber` generates sequential M01, M02... 
            // It doesn't force a specific month code (e.g. M04).
            // But if we want it to be "Month 4 Plan", we should probably manually construct it 
            // OR ensure `monthCode` field is set to '04'.
            // However, WBS logic usually means "1st Month Node", "2nd Month Node", not "April Node".
            // BUT, user's logic implies `monthCode` IS the calendar month (e.g. M03 = March).
            // If so, we can try to force it.
            
            // Let's assume we just create it under the same parent.
            // But we tag it INHERITED.
            
            const descriptionPrefix = `【继承自${currentMonth}月】`;
            const newDescription = task.description ? `${descriptionPrefix} ${task.description}` : descriptionPrefix;

            const newNode = await createPlanNode({
                title: task.title,
                description: newDescription,
                parentId: task.parentId, // Keep same parent
                level: 6,
                owner: task.owner || undefined,
                priority: task.priority,
                periodType: 'MONTH',
                planStatus: '自动继承',
                progress: task.progress, // Keep progress? Or reset? Usually keep.
                planCategory: task.planCategory || undefined,
                evolutionTag: 'INHERITED'
            });
            
            // [Fix] Force update monthCode to targetMonthCode if strict calendar mapping is required?
            // If our WBS generator just does +1, M03 -> M04 (if M03 was last).
            // If M04 already exists (Original), generator might give M05.
            // If we want Strict Calendar Mapping (M04 = April), we might need to override.
            // But let's stick to standard generator for now to avoid collision.
            
            inheritedTasks.push(newNode);
            console.log(`Inherited Task: ${task.title} -> ${newNode.nodeNumber}`);
        }
    }
    
    return {
        originalCount: nextMonthOriginals.length,
        inheritedCount: inheritedTasks.length,
        inheritedTasks
    };
}
export async function rollOverMonthlyTasks() {
    const now = new Date();
    // Assuming this runs on 1st of Month.
    // Target: Last Month
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    console.log(`Checking rollover from ${lastMonth.toLocaleDateString()} to ${now.toLocaleDateString()}`);

    // 1. Find unfinished Month Tasks from last month
    const unfinishedNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'MONTH',
            createdAt: { gte: lastMonth, lte: lastMonthEnd }, // Created last month
            progress: { lt: 100 }
        }
    });

    if (unfinishedNodes.length === 0) {
        console.log('No unfinished tasks to rollover.');
        return;
    }

    // 2. Clone to current month
    for (const node of unfinishedNodes) {
        // Check if already rolled over (simple check by title + current month)
        // This prevents double rollover if script runs multiple times
        const exists = await prisma.planNode.findFirst({
            where: {
                title: node.title,
                periodType: 'MONTH',
                createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) }
            }
        });

        if (!exists) {
            await createPlanNode({
                title: node.title,
                description: node.description || '',
                parentId: node.parentId || undefined, // Keep same Year parent
                level: node.level,
                owner: node.owner || undefined,
                priority: node.priority,
                periodType: 'MONTH',
                planStatus: '自动延期',
                progress: node.progress
            });
            console.log(`Rolled over task: ${node.title}`);
        }
    }
}
