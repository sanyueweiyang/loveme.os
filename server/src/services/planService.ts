import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ==========================================
// 1. 进度递归回传逻辑
// ==========================================

/**
 * 更新 PlanNode 进度，并递归更新父节点进度
 * @param nodeId 当前更新进度的节点 ID
 * @param newProgress 新进度值 (0-100)
 */
export async function updateNodeProgress(nodeId: number, newProgress: number) {
  // 1. 更新当前节点进度
  const updatedNode = await prisma.planNode.update({
    where: { id: nodeId },
    data: { progress: newProgress },
    include: { parent: true }, 
  });

  console.log(`[L${updatedNode.level}] Node [${updatedNode.title}] progress updated to ${newProgress}%`);

  // 2. 如果有父节点，触发向上递归更新
  if (updatedNode.parentId) {
    await updateParentProgressRecursive(updatedNode.parentId);
  }

  return updatedNode;
}

/**
 * 递归计算并更新父节点进度 (核心算法)
 * 规则：父节点进度 = 所有子节点进度的平均值
 * 终止条件：到达 L1 根节点 (无 parentId)
 */
async function updateParentProgressRecursive(parentId: number) {
  // 获取父节点及其所有子节点
  const parent = await prisma.planNode.findUnique({
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
    await prisma.planNode.update({
      where: { id: parentId },
      data: { progress: averageProgress },
    });
    
    console.log(`[Recursion] Updated Parent L${parent.level} [${parent.title}] to ${averageProgress}% (based on ${parent.children.length} children)`);

    // 递归：继续向上更新更上层的父节点，直到 L1
    if (parent.parentId) {
      await updateParentProgressRecursive(parent.parentId);
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
    outputContent: { not: null }, // 必须有产出内容
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
      outputContent: true,
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
    
    if (node.outputContent) {
      reportContent += `   > 产出: ${node.outputContent}\n`;
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
      outputContent: { not: null }, // 必须有产出内容
    },
    select: {
      title: true,
      outputContent: true,
      owner: true,
    },
    orderBy: {
      updatedAt: 'desc',
    }
  });

  // 3. 格式化输出
  return reportNodes.map(node => {
    const ownerStr = node.owner ? `[${node.owner}] ` : "";
    return `${ownerStr}${node.title}: ${node.outputContent}`;
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
  plannedEndDate?: string;
  periodType?: string; // YEAR / MONTH / WEEK
  planStatus?: string;
  outputContent?: string;
  progress?: number;
}) {
  let rootId: number | null = null;
  let parentId = data.parentId;

  // 0. 回溯机制：若在周报新增‘规划外任务’ (WEEK without parent)，逻辑需自动在 YEAR/MONTH 根节点创建对应节点
  if (data.periodType === 'WEEK' && !parentId) {
      console.log('Detected unplanned WEEK task, initiating backtracking...');
      
      // 1. 创建 MONTH 节点
      const monthNode = await prisma.planNode.create({
          data: {
              title: `${data.title} (Month)`,
              description: 'Auto-created by backtracking',
              level: data.level > 1 ? data.level - 1 : 1, // Assume WEEK is lower level, e.g., L3, so MONTH is L2
              owner: data.owner,
              priority: data.priority || 'P1',
              periodType: 'MONTH',
              planStatus: data.planStatus
          }
      });

      // 2. 创建 YEAR 节点
      const yearNode = await prisma.planNode.create({
          data: {
              title: `${data.title} (Year)`,
              description: 'Auto-created by backtracking',
              level: monthNode.level > 1 ? monthNode.level - 1 : 1, // Assume MONTH is L2, YEAR is L1
              owner: data.owner,
              priority: data.priority || 'P1',
              periodType: 'YEAR',
              planStatus: data.planStatus,
              rootId: undefined // Will be set to self
          }
      });
      
      // Fix Root ID for Year Node
      await prisma.planNode.update({
          where: { id: yearNode.id },
          data: { rootId: yearNode.id }
      });
      yearNode.rootId = yearNode.id;

      // Link Month to Year
      await prisma.planNode.update({
          where: { id: monthNode.id },
          data: { parentId: yearNode.id, rootId: yearNode.id }
      });

      // Set parentId for the new WEEK node
      parentId = monthNode.id;
      rootId = yearNode.id;
      
      console.log(`Backtracking complete. Created Month: ${monthNode.id}, Year: ${yearNode.id}`);
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
      periodType: data.periodType,
      planStatus: data.planStatus,
      outputContent: data.outputContent,
      progress: data.progress || 0,
      rootId,
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
    // 1. 获取本周任务
    const now = new Date();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    startOfWeek.setHours(0, 0, 0, 0);

    const currentWeekNodes = await prisma.planNode.findMany({
        where: {
            periodType: 'WEEK',
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
 */
export async function updatePlanNode(id: number, data: any) {
    const original = await prisma.planNode.findUnique({ where: { id } });
    
    const updated = await prisma.planNode.update({
        where: { id },
        data
    });

    // Check if title changed
    if (original && data.title && data.title !== original.title) {
        console.log(`Title changed for Node ${id} from "${original.title}" to "${data.title}". Cascading update...`);
        // We need to pass the OLD title to find which children to update
        await cascadeTitleUpdate(id, original.title, data.title);
    }

    return updated;
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
 * 删除节点
 */
export async function deletePlanNode(id: number) {
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
            consolidatedMap.set(trackId, node);
        } else {
            // 已存在，比较 progress
            const existing = consolidatedMap.get(trackId);
            // [Fix] Latest Update Rule: progress > existing OR (progress == existing AND updatedAt > existing)
            // 确保进度一致时，取最新修改的版本（描述、反馈等可能是新的）
            if (node.progress > existing.progress || 
               (node.progress === existing.progress && node.updatedAt > existing.updatedAt)) {
                consolidatedMap.set(trackId, node);
            }
        }
    }

    // 4. 转换回数组并排序 (按优先级 P0 -> P1)
    return Array.from(consolidatedMap.values()).sort((a, b) => {
        if (a.priority === b.priority) return 0;
        return a.priority === 'P0' ? -1 : 1;
    });
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
 * [New] 跨月滚动机制：每月1日自动检查上月未完成任务，滚动至本月
 * 建议由定时任务调用 (Cron Job)
 */
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
