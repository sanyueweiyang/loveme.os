// 1. 【核心修正】必须首先初始化环境变量，防止 Prisma 连接失败
import * as dotenv from 'dotenv';
dotenv.config();

// 2. 基础框架依赖
import express from 'express';
import cors from 'cors';
import prisma from './lib/prisma';

// [Deploy] 强制服务器统一使用上海时区
process.env.TZ = 'Asia/Shanghai';

// 3. 业务逻辑服务导入
import { 
  createPlanNode, 
  getAllNodes, 
  getNodesByLayer, 
  getAllUsers, 
  updatePlanNode, 
  deletePlanNode, 
  getWeeklyReportNodes,
  getClaimableTasks,
  claimTasksToWeeklyReport,
  initializeNextWeekReport,
  getCategorizedReport,
  claimTask,
  savePushHistory,
  getPushHistory,
  getDailyContext,
  recalculateAllProgress
} from './services/planService';

import { 
  getDailySchedule, 
  saveDailySchedule, 
  getWeeklyScheduleStats, 
  triggerDailyAIAudit, 
  getCalendarViewData 
} from './services/scheduleService';

import { interpretSchedule, generateDailyAudit } from './services/aiService';
import { generateWeeklyReportCopy, generateDayReport } from './utils/reportGenerator';

const app = express();
const port = process.env.PORT || 3000;

// 4. CORS 安全配置 (允许 Lovable 前端访问，完全放开以简化联调)
// 提示：在 Express 5 + path-to-regexp v6 中，显式注册通配符 OPTIONS 路由（如 '*' 或 '/*'）会触发语法错误，
// 因此前端预检由 cors 中间件自动处理，无需额外 app.options('*', ...)。
app.use(cors({
  origin: true,          // 允许任何来源
  credentials: true,
  methods: '*',          // 允许所有方法
  allowedHeaders: '*',   // 允许所有 Header
}));
app.use(express.json());

// --- 辅助函数 ---

interface TreeNode {
  id: number;
  title: string;
  level: number;
  owner: string | null;
  progress: number;
  parentId: number | null;
  children: TreeNode[];
}

function buildTree(nodes: any[], parentId: number | null = null): TreeNode[] {
  return nodes
    .filter(node => node.parentId === parentId)
    .map(node => ({
      id: node.id,
      title: node.title,
      level: node.level,
      owner: node.owner,
      progress: node.progress,
      parentId: node.parentId ?? null,
      children: buildTree(nodes, node.id)
    }));
}

function collectDescendantIds(allNodes: Array<{ id: number; parentId: number | null }>, startId: number): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const n of allNodes) {
    if (n.parentId == null) continue;
    const arr = childrenByParent.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenByParent.set(n.parentId, arr);
  }

  const result: number[] = [];
  const stack: number[] = [startId];
  const visited = new Set<number>();

  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    const children = childrenByParent.get(current) ?? [];
    for (const cid of children) stack.push(cid);
  }

  return result;
}

function simulateAuditFromLogs(logs: Array<{ id: number; content: string | null; createdAt?: Date | string; relatedNodeId: number | null }>) {
  const texts = logs.map(l => (l.content ?? '').trim()).filter(Boolean);
  const joined = texts.join('\n');

  const riskRules: Array<{ key: string; pattern: RegExp; risk: string; suggestion: string }> = [
    {
      key: 'typhoon_delay_2h',
      // 兼容“台风…延迟…2小时”与“台风…2小时…延迟”等语序
      pattern: /(台风|暴雨|极端天气)(?:(?:(?:.{0,40})(延迟|滞后|推迟)(?:.{0,20})(2\s*小时|两\s*小时|120\s*分钟))|(?:(?:.{0,40})(2\s*小时|两\s*小时|120\s*分钟)(?:.{0,20})(延迟|滞后|推迟)))/i,
      risk: '受台风等不可抗力影响导致关键数据/交付出现约 2 小时延迟，可能引发下游排期连锁延误与对外承诺偏差。',
      suggestion: '建立“极端天气/不可抗力”应急预案：关键链路设置缓冲窗口（建议 ≥ 2-4 小时）、触发阈值（如延迟 ≥ 30 分钟）自动升级通知；对外口径采用“预计恢复时间+下一次更新时间”；并为关键数据源准备备用渠道或降级方案。'
    },
    {
      key: 'blocking',
      pattern: /(阻塞|卡住|无法推进|依赖未就绪|等待|排队)/i,
      risk: '存在阻塞/依赖未就绪信号，任务流可能停滞并累积风险。',
      suggestion: '把依赖显式化：标注依赖方/交付物/时间点；设定 24h 依赖超时升级；每日站会优先清障，并用看板维护“阻塞原因-负责人-解除时间”。'
    },
    {
      key: 'quality_or_error',
      pattern: /(报错|错误|异常|失败|回滚|线上|故障|报警)/i,
      risk: '出现质量/稳定性异常信号，可能影响交付可靠性与用户体验。',
      suggestion: '补齐故障闭环：记录影响范围与根因；为关键接口加监控与告警；对同类问题建立回归用例并纳入发布门禁。'
    },
    {
      key: 'schedule_slip',
      pattern: /(延期|超期|来不及|赶工|压缩工期|晚于计划)/i,
      risk: '存在排期滑动迹象，可能导致里程碑失守。',
      suggestion: '建议滚动重排：将里程碑拆到周粒度；对关键路径任务加资源/拆分范围；同步风险给干系人并更新承诺。'
    }
  ];

  const matched = riskRules.filter(r => r.pattern.test(joined));
  const risks = matched.map((m, idx) => ({
    id: `R${idx + 1}`,
    title: m.key,
    description: m.risk,
    evidence: texts.filter(t => m.pattern.test(t)).slice(0, 3)
  }));

  const suggestions = matched.length
    ? matched.map(m => m.suggestion)
    : [
        '未在日志中检测到强风险关键词，但建议固定“延迟/阻塞/异常”三类信号的记录模板，便于后续自动审计。',
        '为关键节点建立 SLA 与升级机制，并在日报/周报中同步风险与缓解动作。'
      ];

  const summary = texts.length
    ? `本次审计基于 ${texts.length} 条工作日志（覆盖相关节点）。整体上已能看到推进记录，但需重点关注风险信号与应对闭环。`
    : '未找到与该节点及其子节点关联的工作日志，暂无法进行基于证据的审计。';

  return {
    mode: 'simulated',
    summary,
    risks,
    suggestions,
    highlights: texts.slice(0, 5),
  };
}

function buildAuditPreviewBrief(logs: Array<{ content: string | null }>) {
  const texts = logs.map(l => (l.content ?? '').trim()).filter(Boolean);
  const joined = texts.join('\n');

  const riskHints: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /(2\s*小时|两\s*小时|120\s*分钟).{0,20}(延迟|滞后|推迟)|(延迟|滞后|推迟).{0,20}(2\s*小时|两\s*小时|120\s*分钟)/i, label: '存在“2小时延迟”风险信号' },
    { pattern: /(台风|暴雨|极端天气)/i, label: '存在极端天气影响风险信号' },
    { pattern: /(阻塞|卡住|无法推进|依赖未就绪|等待)/i, label: '存在阻塞/依赖风险信号' },
    { pattern: /(报错|错误|异常|失败|回滚|线上|故障|报警)/i, label: '存在质量/稳定性风险信号' },
    { pattern: /(延期|超期|来不及|赶工|压缩工期|晚于计划)/i, label: '存在进度延期风险信号' },
  ];

  const hits = riskHints.filter(h => h.pattern.test(joined)).map(h => h.label);
  const riskText = hits.length ? hits.join('；') : '暂无明显高风险关键词命中（建议继续补充日志样本以提升识别准确性）';

  return {
    brief: `风险：${riskText}`,
    evidenceSamples: texts.slice(0, 3),
    totalLogs: texts.length,
  };
}

function formatLocalYYYYMMDD(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// 业务天：以凌晨 04:00 作为日期切换点（00:00-03:59 归属前一日）
function getBusinessDate(input?: Date | null, cutoffHour = 4): string {
  const base = input ? new Date(input) : new Date();
  if (base.getHours() < cutoffHour) base.setDate(base.getDate() - 1);
  return formatLocalYYYYMMDD(base);
}

function adjustCreatedAtForBusinessDay(input?: Date | null, cutoffHour = 4): Date {
  const base = input ? new Date(input) : new Date();
  if (base.getHours() < cutoffHour) base.setDate(base.getDate() - 1);
  return base;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function extractTokens(s: string): string[] {
  const norm = normalizeText(s);
  const raw = norm.split(' ').filter(Boolean);
  // 保留：中文 2+ 字、字母数字 3+、或类似 F01O01... 的编码片段
  const tokens = raw.filter(t => /[\u4e00-\u9fff]{2,}/.test(t) || /[a-z0-9]{3,}/.test(t));

  // 中文连续文本（无空格）时，补充基于关键词词表的切分
  const keywordLexicon = [
    '台风', '暴雨', '极端天气', '延迟', '滞后', '推迟', '补偿', '纠偏', '算法', '路径',
    '数据', '数据源', '清洗', '格式', '转换', '对接', '上线', '回归', '报警', '故障', '阻塞'
  ];
  for (const kw of keywordLexicon) {
    if (norm.includes(kw)) tokens.push(kw);
  }

  // 去重，限制数量避免过多计算
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    uniq.push(t);
    if (uniq.length >= 30) break;
  }
  return uniq;
}

type NodeForSemantic = { id: number; title: string; nodeNumber: string | null };

function inferRelatedNodeIdByContent(content: string, nodes: NodeForSemantic[]) {
  const raw = content ?? '';
  const tokens = extractTokens(raw);
  const normContent = normalizeText(raw);

  // 1) 精确命中 nodeNumber（若日志里直接带了编码）
  for (const n of nodes) {
    if (!n.nodeNumber) continue;
    const nn = n.nodeNumber.toLowerCase();
    if (nn && normContent.includes(nn)) {
      return { relatedNodeId: n.id, reason: 'matched_nodeNumber', confidence: 1.0, matched: n.nodeNumber };
    }
  }

  // 2) 标题强命中（去符号后包含）
  const scored: Array<{ id: number; score: number; matched: string[]; title: string }> = [];
  for (const n of nodes) {
    const normTitle = normalizeText(n.title);
    let score = 0;
    const matched: string[] = [];

    // 2.1 若日志包含一段较长的标题片段，直接加高分
    const compactTitle = n.title.replace(/\s+/g, '');
    if (compactTitle.length >= 6 && raw.replace(/\s+/g, '').includes(compactTitle)) {
      score += 10;
      matched.push('title_exact');
    }

    // 2.2 关键词 token 命中标题
    for (const t of tokens) {
      if (t.length < 2) continue;
      if (normTitle.includes(t)) {
        score += Math.min(3, t.length / 2);
        matched.push(t);
      }
    }

    if (score > 0) scored.push({ id: n.id, score, matched, title: n.title });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return { relatedNodeId: null as number | null, reason: 'no_match', confidence: 0, matched: null as string | null };

  // 简单阈值：避免误关联
  const confidence = Math.min(0.95, best.score / 10);
  if (best.score < 3) {
    return { relatedNodeId: null as number | null, reason: 'low_confidence', confidence, matched: best.matched.slice(0, 3).join(',') };
  }
  return { relatedNodeId: best.id, reason: 'matched_title_keywords', confidence, matched: best.matched.slice(0, 5).join(',') };
}

function parseDurationMinutes(text: string): number | null {
  const t = text ?? '';
  // 2小时 / 2 小时 / 2h / 2.5小时
  const mHour = t.match(/(\d+(?:\.\d+)?)\s*(小时|h|hour|hours)/i);
  if (mHour) return Math.round(parseFloat(mHour[1]) * 60);
  // 30分钟 / 30 分钟 / 30min
  const mMin = t.match(/(\d+(?:\.\d+)?)\s*(分钟|min|mins|minute|minutes)/i);
  if (mMin) return Math.round(parseFloat(mMin[1]));
  return null;
}

function parsePriority(text: string): string | null {
  const m = (text ?? '').match(/\bP([0-4])\b/i);
  return m ? `P${m[1]}`.toUpperCase() : null;
}

function extractCoreContent(text: string): string {
  let t = (text ?? '').trim();
  // 去掉常见的时间/优先级表达，保留核心描述
  t = t.replace(/\bP[0-4]\b/gi, '').trim();
  t = t.replace(/(\d+(?:\.\d+)?)\s*(小时|h|hour|hours)\b/gi, '').trim();
  t = t.replace(/(\d+(?:\.\d+)?)\s*(分钟|min|mins|minute|minutes)\b/gi, '').trim();
  // 去掉口头时间前缀
  t = t.replace(/^(刚才|刚刚|方才|今天|昨晚|昨夜|凌晨|早上|上午|中午|下午|晚上)\s*/g, '').trim();
  return t || (text ?? '').trim();
}

function generateWeeklyReportText(nodes: any[]): string {
  let report = '## 🚀 本周项目进度汇报\n\n';
  let index = 1;
  if (nodes.length === 0) return '本周暂无认领任务。';
  nodes.forEach(node => {
    const line = generateWeeklyReportCopy(node, index);
    report += `${line}\n\n`;
    index++;
  });
  report += `\n*数据截止时间：${new Date().toLocaleString('zh-CN')}*`;
  return report;
}

async function pushToWeChat(content: string): Promise<boolean> {
  const key = process.env.WECHAT_ROBOT_KEY;
  if (!key || key === 'YOUR_KEY_HERE') {
    console.warn('⚠️ 缺少 WECHAT_ROBOT_KEY，跳过推送。');
    return false;
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } })
    });
    const result = await response.json();
    return result.errcode === 0;
  } catch (error) {
    console.error('❌ 网络请求错误:', error);
    return false;
  }
}

// --- 路由接口 ---

// NLP 解析预览：POST /api/nlp/parse
// 输入自然语言，输出槽位结构（供前端确认弹窗预览）
app.post('/api/nlp/parse', async (req, res) => {
  try {
    const { text, at } = req.body ?? {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const atDate = at ? new Date(at) : new Date();
    const businessDate = getBusinessDate(atDate, 4);
    const durationMinutes = parseDurationMinutes(text);
    const priority = parsePriority(text);
    const content = extractCoreContent(text);

    const nodes = await prisma.planNode.findMany({
      select: { id: true, title: true, nodeNumber: true }
    });

    // 模糊匹配“台风数据/纠偏/路径”等关键词到 PlanNode 标题
    const inferred = inferRelatedNodeIdByContent(text, nodes);
    const matchedNode = inferred.relatedNodeId
      ? nodes.find(n => n.id === inferred.relatedNodeId) ?? null
      : null;

    res.json([
      {
        originalText: text,
        content,
        durationMinutes,
        priority,
        relatedNodeId: inferred.relatedNodeId,
        relatedNodeTitle: matchedNode?.title ?? null,
        match: { reason: inferred.reason, confidence: inferred.confidence, matched: inferred.matched },
        businessDate,
      }
    ]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to parse text' });
  }
});

// NLP 确认入库：POST /api/nlp/confirm
// 前端用户点击“准”后，将解析结果落库到 WorkLog，并同步更新 PlanNode（优先级/状态等）
app.post('/api/nlp/confirm', async (req, res) => {
  try {
    const payload = req.body;
    const items = Array.isArray(payload) ? payload : [payload];
    if (!items.length) return res.status(400).json({ error: 'empty payload' });

    const results: any[] = [];

    for (const item of items) {
      const text = (item?.originalText ?? item?.text ?? '').toString();
      const content = (item?.content ?? '').toString().trim() || extractCoreContent(text);
      if (!content) {
        results.push({ ok: false, error: 'content is required', item });
        continue;
      }

      const relatedNodeId = item?.relatedNodeId != null ? Number(item.relatedNodeId) : null;
      const priority = item?.priority ? String(item.priority).toUpperCase() : null;
      const durationMinutes = item?.durationMinutes != null ? Number(item.durationMinutes) : null;
      const confidence = item?.match?.confidence != null
        ? Number(item.match.confidence)
        : (item?.confidence != null ? Number(item.confidence) : null);

      const atDate = item?.at ? new Date(item.at) : (item?.startTime ? new Date(item.startTime) : new Date());
      const createdAt = adjustCreatedAtForBusinessDay(atDate, 4);
      const canonicalBusinessDate = getBusinessDate(atDate, 4);
      const incomingBusinessDate = typeof item?.businessDate === 'string' && item.businessDate.trim()
        ? item.businessDate.trim()
        : null;
      // 字段映射：允许前端传入 businessDate，但仍以 getBusinessDate 作为强约束标准
      const businessDate = incomingBusinessDate && incomingBusinessDate === canonicalBusinessDate
        ? incomingBusinessDate
        : canonicalBusinessDate;

      const newLog = await prisma.workLog.create({
        data: {
          content: content,
          relatedNodeId,
          startTime: item?.startTime ? new Date(item.startTime) : null,
          endTime: item?.endTime ? new Date(item.endTime) : null,
          createdAt,
          businessDate,
          durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : null,
          priority,
          confidence: Number.isFinite(confidence as number) ? confidence : null,
        }
      });

      // 同步更新 PlanNode：priority / status / progress（仅在提供或可安全推断时）
      let updatedNode: any = null;
      if (relatedNodeId) {
        const current = await prisma.planNode.findUnique({
          where: { id: relatedNodeId },
          select: { id: true, title: true, priority: true, status: true, progress: true }
        });
        if (current) {
          const dataToUpdate: any = {};
          if (priority) dataToUpdate.priority = priority;
          if (item?.status) dataToUpdate.status = String(item.status);
          if (item?.progress != null && Number.isFinite(Number(item.progress))) dataToUpdate.progress = Number(item.progress);
          // 若未显式传 status，且当前为 PLANNED，则有日志即视为开始推进
          if (!dataToUpdate.status && current.status === 'PLANNED') dataToUpdate.status = 'IN_PROGRESS';

          if (Object.keys(dataToUpdate).length) {
            updatedNode = await prisma.planNode.update({ where: { id: relatedNodeId }, data: dataToUpdate });
          } else {
            updatedNode = current;
          }
        }
      }

      results.push({
        ok: true,
        workLog: newLog,
        businessDate,
        planNode: updatedNode,
      });
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to confirm logs' });
  }
});

// 1. 获取 WBS 树形结构
app.get('/api/nodes/tree', async (req, res) => {
  try {
    const allNodes = await prisma.planNode.findMany({ orderBy: { createdAt: 'asc' } });
    const tree = buildTree(allNodes, null);
    res.json(tree);
  } catch (error) { res.status(500).json({ error: 'Failed to fetch tree' }); }
});

// 1.1 获取完整节点树（给 Lovable 下钻用）：GET /api/nodes
app.get('/api/nodes', async (req, res) => {
  try {
    const allNodes = await prisma.planNode.findMany({ orderBy: { createdAt: 'asc' } });
    const tree = buildTree(allNodes, null);
    res.json({
      data: tree,
      meta: { totalNodes: allNodes.length, generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nodes' });
  }
});

// 2. 工作日志接口
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await prisma.workLog.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(logs);
  } catch (error) { res.status(500).json({ error: 'Failed to fetch logs' }); }
});

app.post('/api/logs', async (req, res) => {
  try {
    const { content, relatedNodeId, startTime, endTime, durationMinutes, priority, confidence } = req.body;
    if (!content || typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: 'content is required' });
    }

    const parsedStart = startTime ? new Date(startTime) : null;
    const parsedEnd = endTime ? new Date(endTime) : null;

    // 业务天计算：优先用 startTime，其次用当前时间
    const businessDate = getBusinessDate(parsedStart ?? new Date(), 4);

    // 语义解析（关键词匹配）自动关联节点：仅在未显式传 relatedNodeId 时启用
    let resolvedRelatedNodeId: number | null = relatedNodeId ?? null;
    let semantic: { reason: string; confidence: number; matched: string | null } | null = null;
    if (resolvedRelatedNodeId == null) {
      const nodes = await prisma.planNode.findMany({
        select: { id: true, title: true, nodeNumber: true }
      });
      const inferred = inferRelatedNodeIdByContent(content, nodes);
      resolvedRelatedNodeId = inferred.relatedNodeId;
      semantic = { reason: inferred.reason, confidence: inferred.confidence, matched: inferred.matched };
    } else {
      semantic = { reason: 'explicit_relatedNodeId', confidence: 1.0, matched: String(resolvedRelatedNodeId) };
    }

    const newLog = await prisma.workLog.create({
      data: {
        content: content.trim(),
        relatedNodeId: resolvedRelatedNodeId,
        startTime: parsedStart,
        endTime: parsedEnd,
        businessDate,
        durationMinutes: durationMinutes != null ? Number(durationMinutes) : null,
        priority: priority ? String(priority).toUpperCase() : null,
        confidence: confidence != null ? Number(confidence) : null,
      }
    });
    res.json({
      ...newLog,
      businessDate,
      semantic,
    });
  } catch (error) { res.status(500).json({ error: 'Failed to create log' }); }
});

// 2.1 查询指定节点的工作日志：GET /api/nodes/:id/logs
app.get('/api/nodes/:id/logs', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid node id' });

    const node = await prisma.planNode.findUnique({
      where: { id },
      select: { id: true, title: true, level: true }
    });
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const logs = await prisma.workLog.findMany({
      where: { relatedNodeId: id },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      node,
      logs
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch node logs' });
  }
});

// 2.2 知行合一一致性审计：GET /api/audit/consistency?date=YYYY-MM-DD
// Plan：指定业务日下状态为 IN_PROGRESS 的所有 PlanNode（全局维度）
// Actual：该 businessDate 下所有 WorkLog
// - 若某个 Plan 当日没有任何关联日志 => 标记为「失信」
// - 若某条 Log 所关联的 Plan 不在当日 IN_PROGRESS 集合中（或无关联 Plan）=> 标记为「杂事占用」
app.get('/api/audit/consistency', async (req, res) => {
  try {
    console.log('Audit Request received for date:', req.query.date);

    const rawDate = (req.query.date as string | undefined) ?? '';
    let date = rawDate.trim();

    // 宽容处理 ISO 日期格式：如 2026-03-13T00:00:00.000Z => 截取为 YYYY-MM-DD
    if (date.includes('T')) {
      date = date.split('T')[0];
    }
    if (date.includes('Z')) {
      date = date.split('Z')[0];
    }

    if (!date) {
      return res.status(400).json({ error: 'date (businessDate, YYYY-MM-DD) is required' });
    }

    // 1) 取当日业务日下的全部 WorkLog
    const logs = await prisma.workLog.findMany({
      where: { businessDate: date },
      orderBy: { createdAt: 'asc' },
    });

    // 2) 取全局状态为 IN_PROGRESS 的 PlanNode（当前视为“当日计划”集合）
    const inProgressPlans = await prisma.planNode.findMany({
      where: { status: 'IN_PROGRESS' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        level: true,
        owner: true,
        priority: true,
        planStatus: true,
        periodType: true,
      },
    });

    const planIdSet = new Set(inProgressPlans.map(p => p.id));

    // 3) 统计「失信」：当日无任何关联日志的进行中 Plan
    const logIdsByPlan = new Map<number, number[]>();
    for (const log of logs) {
      if (log.relatedNodeId == null) continue;
      const arr = logIdsByPlan.get(log.relatedNodeId) ?? [];
      arr.push(log.id);
      logIdsByPlan.set(log.relatedNodeId, arr);
    }

    const unfulfilledPlans = inProgressPlans
      .filter(p => !(logIdsByPlan.get(p.id)?.length))
      .map(p => ({
        id: p.id,
        title: p.title,
        level: p.level,
        owner: p.owner,
        priority: p.priority,
      }));

    // 4) 统计「杂事占用」：日志关联节点不在 IN_PROGRESS 集合中，或完全未关联任何节点
    const incidentalLogs = logs.map(log => {
      const relatedId = log.relatedNodeId ?? null;
      const inPlan = relatedId != null && planIdSet.has(relatedId);
      if (inPlan) return null;
      return {
        id: log.id,
        content: log.content,
        relatedNodeId: relatedId,
        businessDate: log.businessDate,
        durationMinutes: log.durationMinutes,
        priority: log.priority,
        confidence: log.confidence,
      };
    }).filter(Boolean);

    res.json({
      date,
      plan: {
        inProgressCount: inProgressPlans.length,
        unfulfilledCount: unfulfilledPlans.length,
        unfulfilledPlans,
      },
      actual: {
        logCount: logs.length,
      },
      consistency: {
        unfulfilledPlans,
        incidentalLogs,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to audit consistency' });
  }
});

// 3. 周报认领与汇总
app.get('/api/plans/claimable', async (req, res) => {
    try {
        const year = parseInt(req.query.year as string) || new Date().getFullYear();
        const month = parseInt(req.query.month as string) || (new Date().getMonth() + 1);
        const tasks = await getClaimableTasks(year, month);
        res.json(tasks);
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/plans/claim-batch', async (req, res) => {
    try {
        const { taskIds, weekCode, owner } = req.body;
        const results = await claimTasksToWeeklyReport(taskIds, weekCode, owner);
        res.json(results);
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// 4. 节点更新 (含进度自动递归)
app.patch('/api/nodes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const updatedNode = await updatePlanNode(id, req.body);
    res.json(updatedNode);
  } catch (error) { res.status(500).json({ error: 'Failed to update node' }); }
});

app.post('/api/nodes', async (req, res) => {
  try {
    const data = req.body;
    let rootId = null;
    let parentNode = null;
    if (data.parentId) {
      parentNode = await prisma.planNode.findUnique({ where: { id: data.parentId } });
      if (parentNode) rootId = parentNode.rootId || parentNode.id;
    }
    const newNode = await prisma.planNode.create({
      data: {
        title: data.title,
        parentId: data.parentId,
        level: data.level,
        owner: data.owner || (parentNode ? parentNode.owner : null),
        priority: data.priority || (parentNode ? parentNode.priority : 'P1'),
        planStatus: data.planStatus || (parentNode ? parentNode.planStatus : null),
        periodType: data.periodType,
        dataFeedback: data.dataFeedback,
        plannedEndDate: data.plannedEndDate,
        rootId,
      }
    });
    if (!data.parentId && !rootId) {
       await prisma.planNode.update({ where: { id: newNode.id }, data: { rootId: newNode.id } });
    }
    res.json(newNode);
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// 4.1 节点 AI 审计：聚合该节点及所有子节点 WorkLog
app.post('/api/nodes/:id/audit', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid node id' });

    const node = await prisma.planNode.findUnique({ where: { id } });
    if (!node) return res.status(404).json({ error: 'Node not found' });

    // 取全量节点做内存递归（避免 Prisma 递归查询限制）
    const allNodes = await prisma.planNode.findMany({
      select: { id: true, parentId: true, level: true, title: true },
      orderBy: { createdAt: 'asc' }
    });
    const descendantIds = collectDescendantIds(allNodes, id);

    // 仅取 L5/L6/L7（以及其它更深/更浅也不报错），按需求聚合子层 WorkLog
    const leafLikeIds = allNodes
      .filter(n => descendantIds.includes(n.id) && (n.level === 5 || n.level === 6 || n.level === 7))
      .map(n => n.id);

    const targetIds = leafLikeIds.length ? leafLikeIds : descendantIds;

    const logs = await prisma.workLog.findMany({
      where: { relatedNodeId: { in: targetIds } },
      orderBy: { createdAt: 'asc' }
    });

    // 暂时模拟 AI：基于关键词输出结构化审计
    const audit = simulateAuditFromLogs(
      logs.map(l => ({ id: l.id, content: l.content, createdAt: l.createdAt, relatedNodeId: l.relatedNodeId }))
    );

    res.json({
      node: { id: node.id, title: node.title, level: node.level },
      scope: {
        requestedNodeId: id,
        descendantNodeIds: descendantIds,
        auditedNodeIds: targetIds,
        logCount: logs.length
      },
      prompt: '请总结这些 WorkLog，识别风险并给出管理建议（模拟输出，后续可接真实 AI API）。',
      audit
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to audit node' });
  }
});

// 4.2 AI 审计预览（不接 AI）：聚合该节点下所有 L6 的日志并产出“风险”简报
app.get('/api/nodes/:id/audit-preview', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid node id' });

    const node = await prisma.planNode.findUnique({
      where: { id },
      select: { id: true, title: true, level: true }
    });
    if (!node) return res.status(404).json({ error: 'Node not found' });

    const allNodes = await prisma.planNode.findMany({
      select: { id: true, parentId: true, level: true, title: true },
      orderBy: { createdAt: 'asc' }
    });
    const descendantIds = collectDescendantIds(allNodes, id);
    const l6Ids = allNodes.filter(n => descendantIds.includes(n.id) && n.level === 6).map(n => n.id);

    const logs = await prisma.workLog.findMany({
      where: { relatedNodeId: { in: l6Ids.length ? l6Ids : descendantIds } },
      orderBy: { createdAt: 'desc' }
    });

    const preview = buildAuditPreviewBrief(logs.map(l => ({ content: l.content })));

    res.json({
      node,
      scope: {
        requestedNodeId: id,
        descendantNodeIds: descendantIds,
        l6NodeIds: l6Ids,
        auditedNodeIds: l6Ids.length ? l6Ids : descendantIds,
      },
      preview
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to build audit preview' });
  }
});

// 5. 日程管理与 AI 审计
app.get('/api/schedule/:date', async (req, res) => {
    try {
        const data = await getDailySchedule(req.params.date);
        res.json(data);
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/schedule', async (req, res) => {
    try {
        const { date, mit, nodes } = req.body;
        const dryRun = req.query.dryRun === 'true';
        const result = await saveDailySchedule(date, { mit, nodes }, dryRun);
        res.json(result);
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/ai/interpret', async (req, res) => {
    try {
        const { text, dateContext } = req.body;
        const result = await interpretSchedule(text, dateContext);
        res.json(result);
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

// 6. 系统工具
// 6.1 联调握手接口：用于 Lovable/隧道快速探测后端连通性
app.get('/api/handshake', (req, res) => {
  res.json({
    status: 'ready',
    timestamp: new Date(),
    message: 'LoveMe OS is listening',
  });
});

app.get('/api/admin/recalc-all', async (req, res) => {
    try {
        const result = await recalculateAllProgress();
        res.json(result);
    } catch (error) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/', (req, res) => {
  res.send('LoveMe OS API Running (Fixed Dotenv Order for Zeabur)');
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});