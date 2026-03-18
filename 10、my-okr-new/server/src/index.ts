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
  recalculateAllProgress,
  updateNodeProgress,
} from './services/planService';

import { 
  getDailySchedule, 
  saveDailySchedule, 
  getWeeklyScheduleStats, 
  triggerDailyAIAudit, 
  getCalendarViewData 
} from './services/scheduleService';

import { interpretSchedule, generateDailyAudit, parseTaskWithAI } from './services/aiService';
import { generateWeeklyReportCopy, generateDayReport } from './utils/reportGenerator';

const app = express();
const PORT_NUMBER = Number(process.env.PORT) || 3000;

// 4. CORS 暴力通行（必须放在所有路由之前）：允许所有来源，解决 8082 访问 3000 被拦截；OPTIONS 预检由 cors 自动响应
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// 请求日志：便于确认前端 8080 的请求是否到达后端
app.use((req, res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// --- 辅助函数 ---

interface TreeNode {
  id: number | string;
  title: string;
  level: number;
  owner: string | null;
  progress: number;
  parentId: number | string | null;
  status?: string;
  priority?: string | null;
  planCategory?: string | null;
  description?: string | null;
  targetDate?: string | null;   // ISO 字符串，前端按需格式化
  dataFeedback?: string | null; // L6 专用
  issueLog?: string | null;     // L6 专用
  actualHours?: number | null;  // L6 专用
  monthCode?: string | null;
  weekCode?: string | null;
  children: TreeNode[];
}

function buildTree(nodes: any[], parentId: number | null = null): TreeNode[] {
  return nodes
    .filter((node) => {
      // 顶层：parentId 为 null/undefined 的都视为根节点
      if (parentId === null) {
        return node.parentId === null || node.parentId === undefined;
      }
      // 其它层级：用字符串弱比较，兼容 number/string 混用的情况
      return String(node.parentId) === String(parentId);
    })
    .map((node) => ({
      id: node.id,
      title: node.title,
      level: Number(node.level) || 1,
      owner: node.owner ?? null,
      progress: typeof node.progress === 'number' ? node.progress : 0,
      parentId: node.parentId ?? null,
      status: node.planStatus ?? node.status ?? 'PLANNED',
      priority: node.priority ?? null,
      planCategory: node.planCategory ?? null,
      description: node.description ?? null,
      targetDate: node.targetDate ? new Date(node.targetDate).toISOString().slice(0, 10) : null,
      dataFeedback: node.dataFeedback ?? null,
      issueLog: node.issueLog ?? null,
      actualHours: node.actualHours ?? null,
      monthCode: node.monthCode ?? null,
      weekCode: node.weekCode ?? null,
      children: buildTree(nodes, node.id),
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

// 1. 获取 WBS 树形结构（基于 PlanNode 表构建树）
// 注意：手机端通过 POST /api/nodes 写入的是 PlanNode，因此这里应当查询 PlanNode，
// 并使用 buildTree 按 parentId 组装成树，parentId 为 null 的节点视为根节点。
app.get('/api/nodes/tree', async (req, res) => {
  try {
    // 1) 全量查岗：不带任何 where 条件，拿到 PlanNode 表的“全家福”
    const rawNodes = await prisma.planNode.findMany();
    console.log('【数据库查岗】当前 PlanNode 表里总共有多少条数据:', rawNodes.length);
    console.log('【原始数据快照】(PlanNode):', JSON.stringify(rawNodes, null, 2));

    // 2) 按 parentId 构建树：parentId 为 null/undefined 的视为根节点
    const tree = buildTree(rawNodes, null);
    console.log('构建出的树形结构:', JSON.stringify(tree, null, 2));
    console.log('Tree 返回数据量:', Array.isArray(tree) ? tree.length : -1);

    // 3) 若树构建失败（比如 tree 为空但表里有数据），暴力返回所有 level=1 的节点
    if (Array.isArray(tree) && tree.length === 0 && rawNodes.length > 0) {
      const level1 = rawNodes.filter((n: any) => Number(n.level) === 1);
      console.log('⚠️ 树为空但表有数据，改为暴力返回所有 level=1 节点，数量:', level1.length);
      const fallback = level1.map((n: any) => ({
        id: n.id,
        title: n.title,
        level: Number(n.level) || 1,
        owner: n.owner ?? null,
        progress: n.progress ?? 0,
        parentId: n.parentId ?? null,
        status: n.planStatus ?? 'PLANNED',
        children: [],
      }));
      return res.json(fallback);
    }

    res.json(tree);
  } catch (error) {
    console.error('Error in /api/nodes/tree mock handler:', error);
    res.json([]);
  }
});

// 1.1 获取完整节点树（给 Lovable 下钻用）：GET /api/nodes
app.get('/api/nodes', async (req, res) => {
  try {
    const { priority, targetDate, level, planCategory, planStatus, weekCode, monthCode, mode } = req.query;

    // ── 特殊模式：L1 浅层查询（mode=L1）────────────────────────────
    // 仅返回 level=1 节点及其直接子节点（level=2），不递归更深层级
    if (mode === 'L1') {
      const l1Nodes = await prisma.planNode.findMany({
        where: { level: 1 },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, title: true, level: true, priority: true,
          progress: true, planStatus: true, planCategory: true,
          owner: true, targetDate: true, parentId: true, rootId: true,
          children: {
            where: { level: 2 },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true, title: true, level: true, priority: true,
              progress: true, planStatus: true, planCategory: true,
              owner: true, targetDate: true, parentId: true, rootId: true,
            },
          },
        },
      });
      return res.json({
        data: l1Nodes,
        meta: { mode: 'L1', totalL1: l1Nodes.length, generatedAt: new Date().toISOString() },
      });
    }

    // ── 特殊模式：每周重点（mode=weekly）────────────────────────────
    // 逻辑：先找当前活跃的 L5 节点，再级联查询其下的 L6 任务
    if (mode === 'weekly') {
      const wc = weekCode ? String(weekCode) : getISOWeekCode(new Date());

      // 1. 找活跃的 L5 节点（planStatus 不是 DONE，或有 weekCode 关联）
      const l5Where: any = { level: 5, planStatus: { not: 'DONE' } };
      if (planCategory) l5Where.planCategory = String(planCategory);
      const activeL5 = await prisma.planNode.findMany({
        where: l5Where,
        select: { id: true, title: true, priority: true, progress: true, planStatus: true, planCategory: true },
      });
      const l5Ids = activeL5.map((n: any) => n.id);

      // 2. 查询属于这些 L5 的 L6 任务，同时匹配 weekCode
      const l6Where: any = { level: 6, weekCode: wc };
      if (l5Ids.length > 0) l6Where.parentId = { in: l5Ids };
      if (priority) l6Where.priority = { in: String(priority).split(',') };
      if (planStatus) l6Where.planStatus = String(planStatus);

      const l6Nodes = await prisma.planNode.findMany({
        where: l6Where,
        orderBy: [{ priority: 'asc' }, { progress: 'desc' }],
      });

      console.log(`📋 [GET /api/nodes?mode=weekly] weekCode=${wc} activeL5=${l5Ids.length} l6=${l6Nodes.length}`);
      return res.json({
        data: l6Nodes,
        meta: {
          mode: 'weekly',
          weekCode: wc,
          activeL5Count: activeL5.length,
          totalNodes: l6Nodes.length,
          generatedAt: new Date().toISOString(),
        },
      });
    }

    // ── 通用筛选模式 ──────────────────────────────────────────────
    const where: any = {};
    if (priority)     where.priority     = { in: String(priority).split(',') };
    if (level)        where.level        = { in: String(level).split(',').map(Number) };
    if (planCategory) where.planCategory = String(planCategory);
    if (planStatus)   where.planStatus   = String(planStatus);
    if (weekCode)     where.weekCode     = String(weekCode);
    if (monthCode)    where.monthCode    = String(monthCode);

    // targetDate 支持精确日期或年份前缀匹配（如 "2026" 匹配全年）
    if (targetDate) {
      const td = String(targetDate);
      if (/^\d{4}$/.test(td)) {
        where.targetDate = { gte: new Date(`${td}-01-01`), lte: new Date(`${td}-12-31`) };
      } else {
        const d = new Date(td);
        if (!Number.isNaN(d.getTime())) {
          where.targetDate = d;
        }
      }
    }

    const allNodes = await prisma.planNode.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      // 查询 L5 时，include 父节点（L4）信息，方便前端做"依据展示"
      include: where.level && String(where.level.in ?? '').includes('5')
        ? { parent: { select: { id: true, title: true, level: true } } }
        : undefined,
    });

    // 有筛选条件时返回扁平数组，无筛选时返回树形结构
    const hasFilter = Object.keys(where).length > 0;
    if (hasFilter) {
      return res.json({
        data: allNodes,
        meta: { totalNodes: allNodes.length, generatedAt: new Date().toISOString() },
      });
    }

    const tree = buildTree(allNodes, null);
    res.json({
      data: tree,
      meta: { totalNodes: allNodes.length, generatedAt: new Date().toISOString() },
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

// 4. 节点更新：支持修改 title / owner / priority / status / planCategory / targetDate / progress / dataFeedback
app.patch('/api/nodes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid node id' });
    }

    const { title, owner, priority, status, planCategory, targetDate, progress, dataFeedback } = req.body ?? {};
    const data: any = {};

    if (title !== undefined) data.title = String(title);
    if (owner !== undefined) data.owner = owner === null ? null : String(owner);
    if (priority !== undefined) data.priority = String(priority);
    if (status !== undefined) data.planStatus = String(status);

    // planCategory 枚举校验
    if (planCategory !== undefined) {
      const VALID = ['工作', '生活', '成长'];
      if (planCategory !== null && !VALID.includes(planCategory)) {
        return res.status(400).json({ error: 'INVALID_PLAN_CATEGORY', message: `planCategory 必须是 ${VALID.join(' | ')}` });
      }
      data.planCategory = planCategory ?? null;
    }

    // targetDate 类型转换
    if (targetDate !== undefined) {
      if (targetDate === null) {
        data.targetDate = null;
      } else {
        const d = new Date(targetDate);
        data.targetDate = Number.isNaN(d.getTime()) ? null : d;
      }
    }

    // progress 范围限制 0-100
    if (progress !== undefined) {
      data.progress = Math.min(100, Math.max(0, Number(progress) || 0));
    }

    // dataFeedback（L6 专用，但 PATCH 不限制层级，由前端控制）
    if (dataFeedback !== undefined) {
      data.dataFeedback = dataFeedback === null ? null : String(dataFeedback);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    // 若更新了 progress，使用 updateNodeProgress 触发向上递归汇总
    if (data.progress !== undefined) {
      // progress=100 时自动将 planStatus 设为 DONE，支持前端置顶框圆圈点击切换
      if (data.progress >= 100 && data.planStatus === undefined) {
        data.planStatus = 'DONE';
      }
      // progress 从 100 降回时，若状态仍是 DONE 则自动回退为 IN_PROGRESS
      if (data.progress < 100 && data.planStatus === undefined) {
        const current = await prisma.planNode.findUnique({ where: { id }, select: { planStatus: true } });
        if ((current as any)?.planStatus === 'DONE') {
          data.planStatus = 'IN_PROGRESS';
        }
      }

      const result = await updateNodeProgress(id, data.progress);
      // 其余字段（planStatus 等）单独更新
      const otherFields = { ...data };
      delete otherFields.progress;
      if (Object.keys(otherFields).length > 0) {
        await prisma.planNode.update({ where: { id }, data: otherFields });
      }
      console.log('✅ 节点进度已更新并向上递归汇总:', result.id, result.progress, '→ planStatus:', data.planStatus ?? '不变');
      return res.json({ ...result, planStatus: data.planStatus ?? (result as any).planStatus });
    }

    const updatedNode = await prisma.planNode.update({
      where: { id },
      data,
    });

    console.log('✅ 节点已更新:', updatedNode);
    res.json(updatedNode);
  } catch (error) {
    console.error('❌ 更新节点失败:', error);
    res.status(500).json({ error: 'Failed to update node' });
  }
});

// ── 节点编码自动生成工具函数 ──────────────────────────────────────────────────
/**
 * buildNodeNumber
 * 根据父节点的编码字段，自动拼接当前节点的 nodeNumber。
 *
 * 编码规则（L1→L6）：
 *   L1: F{planCategoryCode}
 *   L2: F{..}O{objectiveCode}
 *   L3: F{..}O{..}KR{krCode}
 *   L4: F{..}O{..}KR{..}D1{detail1Code}
 *   L5: F{..}O{..}KR{..}D1{..}D2{detail2Code}
 *   L6: F{..}O{..}KR{..}D1{..}D2{..}W{weekCode}
 *
 * 若父节点编码不完整，则返回 null（不强制，避免阻塞创建）。
 */
async function buildNodeNumber(
  level: number,
  parentNode: any | null,
  ownCode: string | null,
): Promise<string | null> {
  try {
    /* 从父节点继承所有上层编码 */
    const p = parentNode as any;
    const f  = p?.planCategoryCode ?? null;
    const o  = p?.objectiveCode    ?? null;
    const kr = p?.krCode           ?? null;
    const d1 = p?.detail1Code      ?? null;
    const d2 = p?.detail2Code      ?? null;

    const pad = (v: string | null) => v ? String(v).padStart(2, '0') : null;
    const own = pad(ownCode);

    if (level === 1) return own ? `F${own}` : null;
    if (level === 2) return (f && own) ? `F${f}O${own}` : null;
    if (level === 3) return (f && o && own) ? `F${f}O${o}KR${own}` : null;
    if (level === 4) return (f && o && kr && own) ? `F${f}O${o}KR${kr}D1${own}` : null;
    if (level === 5) return (f && o && kr && d1 && own) ? `F${f}O${o}KR${kr}D1${d1}D2${own}` : null;
    if (level === 6) {
      /* L6 用 weekCode 作为末段，ownCode 可为 null */
      const wk = p?.weekCode ?? null;
      return (f && o && kr && d1 && d2 && wk)
        ? `F${f}O${o}KR${kr}D1${d1}D2${d2}W${wk}`
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * getNextSiblingCode
 * 查询同一父节点下已有的同层节点数量，返回下一个序号（两位字符串，如 "03"）。
 */
async function getNextSiblingCode(parentId: number | null, level: number): Promise<string> {
  const count = await prisma.planNode.count({
    where: { parentId: parentId ?? undefined, level },
  });
  return String(count + 1).padStart(2, '0');
}

app.post('/api/nodes', async (req, res) => {
  try {
    const data = req.body;
    let rootId = null;
    let parentNode = null;

    // 统一处理 parentId：前端可能传 string，这里强制转为 number 或 null
    let parentId: number | null = null;
    if (data.parentId !== undefined && data.parentId !== null && data.parentId !== '') {
      const parsed = parseInt(String(data.parentId), 10);
      parentId = Number.isNaN(parsed) ? null : parsed;
    }

    // 逻辑约束：除 L1 外，其它层级节点必须挂在父节点下面
    if (data.level > 1 && !parentId) {
      console.error('❌ 非 L1 节点缺少 parentId，被拦截:', data);
      return res.status(400).json({
        error: 'INVALID_NODE_HIERARCHY',
        message: '非 L1 节点必须指定 parentId 才能创建',
      });
    }

    if (parentId) {
      parentNode = await prisma.planNode.findUnique({ where: { id: parentId } });
      if (parentNode) rootId = parentNode.rootId || parentNode.id;
    }

    // 父子级差校验：子节点的 level 必须恰好等于父节点 level + 1
    if (parentNode && data.level !== parentNode.level + 1) {
      return res.status(400).json({
        error: 'INVALID_LEVEL_GAP',
        message: `层级差必须为 1：父节点是 L${parentNode.level}，子节点只能是 L${parentNode.level + 1}，但收到了 L${data.level}`,
      });
    }
    const VALID_PLAN_CATEGORY = ['工作', '生活', '成长'];
    const VALID_PRIORITY      = ['P0', 'P1', 'P2', 'P3', 'P4'];
    const VALID_PLAN_STATUS   = ['PLANNED', 'IN_PROGRESS', 'IN_PROGRESS_CROSS_WEEK', 'DONE', 'DEFERRED', 'CANCELLED'];

    if (data.planCategory && !VALID_PLAN_CATEGORY.includes(data.planCategory)) {
      return res.status(400).json({ error: 'INVALID_PLAN_CATEGORY', message: `planCategory 必须是 ${VALID_PLAN_CATEGORY.join(' | ')}` });
    }
    if (data.priority && !VALID_PRIORITY.includes(data.priority)) {
      return res.status(400).json({ error: 'INVALID_PRIORITY', message: `priority 必须是 ${VALID_PRIORITY.join(' | ')}` });
    }
    if (data.planStatus && !VALID_PLAN_STATUS.includes(data.planStatus)) {
      return res.status(400).json({ error: 'INVALID_PLAN_STATUS', message: `planStatus 必须是 ${VALID_PLAN_STATUS.join(' | ')}` });
    }

    // ── 三字段强制继承：category / owner / priority ────────────────
    // 规则：前端若未传（null/undefined/空串），强制从父节点继承；L1 无父节点时使用兜底值
    const planCategory: string | null =
      (data.planCategory != null && data.planCategory !== '')
        ? data.planCategory
        : (parentNode ? (parentNode as any).planCategory : null) ?? null;

    const resolvedOwner: string | null =
      (data.owner != null && data.owner !== '')
        ? data.owner
        : (parentNode ? (parentNode as any).owner : (data.level === 1 ? null : 'Owner')) ?? null;

    const resolvedPriority: string =
      (data.priority != null && data.priority !== '')
        ? data.priority
        : (parentNode ? (parentNode as any).priority : 'P1') ?? 'P1';

    // ── targetDate 类型转换 ────────────────────────────────────────
    let targetDate: Date | null = null;
    if (data.targetDate) {
      const d = new Date(data.targetDate);
      targetDate = Number.isNaN(d.getTime()) ? null : d;
    }

    // ── progress：L6 录入，其他层级默认 0 ─────────────────────────
    const progress = data.level === 6 && data.progress != null
      ? Math.min(100, Math.max(0, Number(data.progress) || 0))
      : 0;

    // L5 专项校验：父节点必须是 L4（模块），确保 L5 工作包有明确的模块依据
    if (data.level === 5) {
      if (!parentNode) {
        return res.status(400).json({
          error: 'L5_REQUIRES_L4_PARENT',
          message: 'L5 工作包必须关联到一个有效的 L4 模块节点',
        });
      }
      if (parentNode.level !== 4) {
        return res.status(400).json({
          error: 'L5_PARENT_MUST_BE_L4',
          message: `L5 工作包的父节点必须是 L4（模块），当前父节点层级为 L${parentNode.level}`,
        });
      }
      // monthCode：前端未传时自动补当前月份，确保月报聚合有时间轴索引
      if (!data.monthCode || !String(data.monthCode).trim()) {
        const now = new Date();
        data.monthCode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        console.log(`ℹ️ L5 未传 monthCode，自动补充为当前月份: ${data.monthCode}`);
      }
      // monthCode 格式校验：YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(String(data.monthCode))) {
        return res.status(400).json({
          error: 'INVALID_MONTH_CODE_FORMAT',
          message: 'monthCode 格式必须为 YYYY-MM（如 2026-03）',
        });
      }
    }

    // L6 专项校验：父节点必须是 L5（月度工作包），确保 L6 执行活动有明确的月度来源
    if (data.level === 6) {
      if (!parentNode) {
        return res.status(400).json({
          error: 'L6_REQUIRES_L5_PARENT',
          message: 'L6 执行活动必须关联到一个有效的 L5 工作包节点',
        });
      }
      if (parentNode.level !== 5) {
        return res.status(400).json({
          error: 'L6_PARENT_MUST_BE_L5',
          message: `L6 执行活动的父节点必须是 L5（工作包），当前父节点层级为 L${parentNode.level}`,
        });
      }
      // weekCode：前端未传时自动补当前周，确保周报聚合有时间轴索引
      if (!data.weekCode || !String(data.weekCode).trim()) {
        data.weekCode = getISOWeekCode(new Date());
        console.log(`ℹ️ L6 未传 weekCode，自动补充为当前周: ${data.weekCode}`);
      }
      // monthCode：前端未传时从父节点 L5 继承，或自动补当前月
      if (!data.monthCode || !String(data.monthCode).trim()) {
        const parentMonthCode = (parentNode as any).monthCode;
        if (parentMonthCode) {
          data.monthCode = parentMonthCode;
        } else {
          const now = new Date();
          data.monthCode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        console.log(`ℹ️ L6 未传 monthCode，自动补充为: ${data.monthCode}`);
      }
    }

    /* ── 自动生成节点编码 ──────────────────────────────────────────────── */
    // 1. 计算当前节点在同级中的序号（用于拼接编码）
    const siblingCode = await getNextSiblingCode(parentId, data.level);
    // 2. 继承父节点的各层编码字段
    const inheritedCodes = {
      planCategoryCode: (parentNode as any)?.planCategoryCode ?? null,
      objectiveCode:    (parentNode as any)?.objectiveCode    ?? null,
      krCode:           (parentNode as any)?.krCode           ?? null,
      detail1Code:      (parentNode as any)?.detail1Code      ?? null,
      detail2Code:      (parentNode as any)?.detail2Code      ?? null,
    };
    // 3. 根据层级，将 siblingCode 写入对应字段
    const ownCodeField: Record<number, string> = {
      1: 'planCategoryCode', 2: 'objectiveCode', 3: 'krCode',
      4: 'detail1Code',      5: 'detail2Code',
    };
    const levelCodeField = ownCodeField[data.level];
    const levelCodes = { ...inheritedCodes };
    if (levelCodeField) (levelCodes as any)[levelCodeField] = siblingCode;
    // 4. 拼接 nodeNumber（失败时为 null，不阻塞创建）
    const autoNodeNumber = await buildNodeNumber(data.level, { ...parentNode, ...inheritedCodes }, siblingCode);
    /* ─────────────────────────────────────────────────────────────────── */

    const newNode = await prisma.planNode.create({
      data: {
        title: data.title,
        parentId,
        level: data.level,
        owner: resolvedOwner,
        priority: resolvedPriority,
        // 子节点状态默认 PLANNED，不继承父节点状态（避免子节点创建即 IN_PROGRESS）
        planStatus: data.planStatus || 'PLANNED',
        planCategory,
        targetDate,
        progress,
        dataFeedback: data.dataFeedback ?? null,
        periodType: data.periodType ?? null,
        plannedEndDate: data.plannedEndDate ?? null,
        // monthCode：L5 强制必填（已在上方校验），其他层级可选
        monthCode: data.monthCode ?? (parentNode ? (parentNode as any).monthCode : null) ?? null,
        weekCode: data.weekCode ?? null,
        rootId,
        // 编码字段（自动生成）
        ...levelCodes,
        nodeNumber: autoNodeNumber ?? undefined,
      }
    });
    if (!data.parentId && !rootId) {
       await prisma.planNode.update({ where: { id: newNode.id }, data: { rootId: newNode.id } });
    }
    console.log('✅ 新建 PlanNode 记录:', newNode);
    res.json(newNode);
  } catch (error) {
    console.error('❌ 创建 PlanNode 失败:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// 4.1 阻断式安全删除：仅允许删除叶子节点
app.delete('/api/nodes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid node id' });
    }

    // 检查是否存在子节点
    const child = await prisma.planNode.findFirst({
      where: { parentId: id },
      select: { id: true, title: true },
    });

    if (child) {
      console.warn('⚠️ 尝试删除仍有下级拆解的节点，被阻断:', { id, child });
      return res.status(400).json({
        error: 'HAS_CHILDREN',
        message: '无法删除：该节点下仍有下级拆解，请先由内而外清理底层节点。',
      });
    }

    const deleted = await prisma.planNode.delete({
      where: { id },
    });

    console.log('✅ 已安全删除叶子节点:', deleted);
    res.json(deleted);
  } catch (error) {
    console.error('❌ 删除节点失败:', error);
    res.status(500).json({ error: 'Failed to delete node' });
  }
});

// 4.2 节点 AI 审计：聚合该节点及所有子节点 WorkLog
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

// 5.1 任务解析：POST /api/parse-task
// 使用大模型将自然语言解析为结构化任务信息
app.post('/api/parse-task', async (req, res) => {
  try {
    console.log('📦 收到请求体:', req.body);
    const rawText = (req.body?.text || req.body?.content || '').toString().trim();
    const now = req.body?.now;
    if (!rawText) {
      console.error('❌ 解析失败：未找到有效文本内容');
      return res.status(400).json({ error: 'text is required' });
    }
    const result = await parseTaskWithAI(rawText, now);
    res.json(result);
  } catch (error) {
    console.error('Failed to parse task via AI:', error);
    res.status(500).json({ error: 'Failed to parse task' });
  }
});

// 5.2 任务入库：POST /api/save-task
// 将语义解析结果写入 Activity 表：
// - 若 nodeId 为层级字符串（如 'L6'），优先根据 nodeNumber 精确挂载
// - 若找不到对应节点，则自动创建一个 L6「默认执行节点」（nodeNumber: 'L6'）作为收件箱
// 简单的写操作重试封装：避免瞬时锁（SQLITE_BUSY/readonly）导致一次性失败
async function withPrismaRetry<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 50): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const msg = err?.message ?? '';
      // 仅对典型的 SQLite 写锁/只读错误做重试，其它错误直接抛出
      if (!/SQLITE_BUSY/i.test(msg) && !/SQLITE_READONLY/i.test(msg)) {
        throw err;
      }
      if (attempt === maxRetries - 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

app.post('/api/save-task', async (req, res) => {
  try {
    const { taskName, startTime, endTime, nodeId } = req.body ?? {};
    let rawNodeId = nodeId != null ? String(nodeId).trim() : '';

    if (!taskName || typeof taskName !== 'string' || !taskName.trim()) {
      return res.status(400).json({ error: 'taskName is required' });
    }

    // 1) 规范化 nodeId：如果为空或非 Lx/数字，直接视为 'L6'
    if (!rawNodeId || !/^(L[1-7]|\d+)$/.test(rawNodeId)) {
      rawNodeId = 'L6';
    }

    let wbsNodeId: number;

    // 2) 若 nodeId 是层级字符串（如 'L6'），优先按 nodeNumber 精确匹配
    if (/^L[1-7]$/i.test(rawNodeId)) {
      const desiredNodeNumber = rawNodeId.toUpperCase(); // 如 'L6'
      let node = await withPrismaRetry(
        () => prisma.wBSNode.findFirst({ where: { nodeNumber: desiredNodeNumber } }),
      );

      // 2.1 若不存在该 nodeNumber，则兜底创建一个 L6「默认执行节点」作为收件箱
      if (!node) {
        const level = parseInt(desiredNodeNumber[1], 10) || 6;
        node = await withPrismaRetry(
          () => prisma.wBSNode.create({
            data: {
              name: '默认执行节点',
              level,
              nodeNumber: desiredNodeNumber, // 例如 'L6'
              parentId: null,
            },
          }),
        );
        console.log('✅ 已创建默认 WBS 节点:', node);
      }

      wbsNodeId = node.id;
    } else {
      // 3) 若 nodeId 是数字，则按主键查找；不存在时同样落到 nodeNumber='L6' 的节点
      const id = parseInt(rawNodeId, 10);
      let node = !Number.isNaN(id) && id > 0
        ? await prisma.wBSNode.findUnique({ where: { id } })
        : null;

      if (!node) {
        let inbox = await withPrismaRetry(
          () => prisma.wBSNode.findFirst({
            where: { nodeNumber: 'L6' },
          }),
        );
        if (!inbox) {
          inbox = await withPrismaRetry(
            () => prisma.wBSNode.create({
              data: {
                name: '默认执行节点',
                level: 6,
                nodeNumber: 'L6',
                parentId: null,
              },
            }),
          );
          console.log('✅ 已创建默认收件箱节点 L6:', inbox);
        }
        node = inbox;
      }

      wbsNodeId = node.id;
    }

    const plannedStart = startTime ? new Date(startTime) : null;
    const plannedEnd = endTime ? new Date(endTime) : null;

    // 业务日（04:00 切换）：优先使用实际/计划开始时间，最后回退当前时间
    const baseForBusiness = plannedStart ?? plannedEnd ?? new Date();
    const businessDate = getBusinessDate(baseForBusiness, 4);

    const dataToCreate = {
      title: taskName.trim(),
      wbsNodeId,
      isPlanned: false,
      plannedStart,
      plannedEnd,
      actualStart: plannedStart,
      actualEnd: plannedEnd,
      businessDate,
      status: 'COMPLETED',
    } as const;

    console.log('📝 准备写入 Activity:', dataToCreate);

    const activity = await withPrismaRetry(
      () => prisma.activity.create({ data: dataToCreate }),
    );
    console.log('✅ 数据已成功写入 Activity 表:', activity);

    // 基于子任务完成情况更新 WBS 节点进度
    const activities = await withPrismaRetry(
      () => prisma.activity.findMany({
        where: { wbsNodeId },
        select: { status: true },
      }),
    );
    const total = activities.length;
    const completed = activities.filter((a) => a.status === 'COMPLETED').length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    await withPrismaRetry(
      () => prisma.wBSNode.update({
        where: { id: wbsNodeId },
        data: { progress },
      }),
    );

    res.json({ success: true, activity, progress });
  } catch (error: any) {
    const msg = error?.message ?? String(error);
    console.error('❌ Prisma Error:', msg);
    try {
      console.log('🔴 完整错误对象:', JSON.stringify(error, null, 2));
    } catch {
      console.log('🔴 完整错误对象（无法序列化）:', error);
    }
    res.status(500).json({
      error: 'Failed to save task',
      detail: msg,
      hint: msg.includes('exist') || msg.includes('table') ? '请执行 npx prisma db push 初始化数据库' : undefined,
    });
  }
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

// ── DailySchedule CRUD ────────────────────────────────────────────────────

// ── DailySchedule 辅助函数 ────────────────────────────────────────────────────

/**
 * 校验时间格式 HH:mm，支持 00:00 ~ 47:59（跨零点用 24:00~32:59 表示次日时段）
 * 业务规则：日程轴从 09:00 开始，到次日 08:59 结束（即 33:59 以内均合法）
 */
function isValidScheduleTime(t: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(':').map(Number);
  return h >= 0 && h <= 33 && m >= 0 && m <= 59;
}

/**
 * 将跨零点时间（如 "25:30"）转换为标准 HH:mm（"01:30"），用于展示
 * 存储时保留原始值（如 "25:30"），方便排序和跨零点判断
 */
function normalizeTimeDisplay(t: string): string {
  const [h, m] = t.split(':').map(Number);
  if (h >= 24) return `${String(h - 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return t;
}

/**
 * 当日程关联了 L6 PlanNode 时，根据日程的完成情况同步节点进度和状态。
 * 规则：
 *   - 日程 remark 含"完成"/"done"/"✅" → progress=100, planStatus=DONE
 *   - 日程存在（已记录）但无完成标记 → progress 保持，planStatus=IN_PROGRESS（若当前是 PLANNED）
 */
async function syncL6NodeFromSchedule(nodeId: number, remark: string | null) {
  const node = await prisma.planNode.findUnique({
    where: { id: nodeId },
    select: { id: true, level: true, progress: true, planStatus: true, parentId: true },
  });
  if (!node || node.level !== 6) return null;

  const isDone = remark
    ? /完成|done|✅/i.test(remark)
    : false;

  const updateData: any = {};
  if (isDone) {
    updateData.progress = 100;
    updateData.planStatus = 'DONE';
  } else if ((node as any).planStatus === 'PLANNED') {
    // 日程已记录但未完成 → 自动推进为进行中
    updateData.planStatus = 'IN_PROGRESS';
  }

  if (Object.keys(updateData).length === 0) return node;

  const updated = await prisma.planNode.update({ where: { id: nodeId }, data: updateData });

  // 若进度变为 100，触发向上递归汇总
  if (isDone && node.parentId) {
    try { await updateNodeProgress(nodeId, 100); } catch (_) {}
  }

  console.log(`🔗 [syncL6Node] nodeId=${nodeId} → progress=${updateData.progress ?? '不变'} planStatus=${updateData.planStatus ?? '不变'}`);
  return updated;
}

// 查询：按日期获取日程（不传 date 则返回全部），关联 L6 节点信息
// 返回结构：{ date, topTask, schedules[] }，与前端 DailyScheduleDay 类型对齐
app.get('/api/daily-schedules', async (req, res) => {
  try {
    const { date } = req.query;
    const where = date ? { date: String(date) } : {};
    const items = await (prisma as any).dailySchedule.findMany({
      where,
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      include: {
        planNode: {
          select: { id: true, title: true, level: true, progress: true, planStatus: true },
        },
      },
    });

    // 若指定了日期，同时拉取 DailySummary.mit 作为 topTask
    if (date) {
      const summary = await prisma.dailySummary.findUnique({
        where: { date: String(date) },
        select: { mit: true },
      });
      // 将后端字段名映射为前端期望的字段名
      const schedules = items.map((item: any) => ({
        ...item,
        title: item.taskName,       // taskName → title
        linkedNodeId: item.nodeId,  // nodeId → linkedNodeId
        isDone: item.remark ? /完成|done|✅/i.test(item.remark) : false,
      }));
      return res.json({
        date: String(date),
        topTask: summary?.mit ?? '',
        schedules,
      });
    }

    res.json(items);
  } catch (error) {
    console.error('❌ GET /api/daily-schedules 失败:', error);
    res.status(500).json({ error: 'Failed to fetch daily schedules' });
  }
});

// 创建日程（兼容前端字段名：title→taskName, linkedNodeId→nodeId, isDone→remark）
app.post('/api/daily-schedules', async (req, res) => {
  try {
    const body = req.body ?? {};
    const date      = body.date;
    const startTime = body.startTime;
    const endTime   = body.endTime;
    const dimension = body.dimension ?? body.category ?? null;
    const remark    = body.remark ?? (body.isDone ? '✅ 完成' : null);
    // 前端可能传 title 或 taskName
    const taskName  = body.taskName ?? body.title ?? null;
    // 前端可能传 linkedNodeId 或 nodeId
    const rawNodeId = body.nodeId ?? body.linkedNodeId ?? null;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: 'date, startTime, endTime 为必填项' });
    }
    if (!isValidScheduleTime(String(startTime))) {
      return res.status(400).json({ error: 'INVALID_START_TIME', message: 'startTime 格式必须为 HH:mm，跨零点用 24:00~33:59 表示' });
    }
    if (!isValidScheduleTime(String(endTime))) {
      return res.status(400).json({ error: 'INVALID_END_TIME', message: 'endTime 格式必须为 HH:mm，跨零点用 24:00~33:59 表示' });
    }
    const [sh, sm] = String(startTime).split(':').map(Number);
    const [eh, em] = String(endTime).split(':').map(Number);
    if (sh * 60 + sm >= eh * 60 + em) {
      return res.status(400).json({ error: 'INVALID_TIME_RANGE', message: 'startTime 必须早于 endTime' });
    }

    const parsedNodeId = rawNodeId ? parseInt(String(rawNodeId), 10) : null;
    const validNodeId  = parsedNodeId && !Number.isNaN(parsedNodeId) ? parsedNodeId : null;

    const item = await (prisma as any).dailySchedule.create({
      data: {
        date: String(date),
        startTime: String(startTime),
        endTime: String(endTime),
        taskName,
        nodeId: validNodeId,
        dimension,
        remark,
      },
    });

    let syncedNode = null;
    if (validNodeId) {
      syncedNode = await syncL6NodeFromSchedule(validNodeId, remark ?? null);
    }

    console.log('✅ 创建 DailySchedule:', item.id, `${startTime}~${endTime}`);
    // 返回时同时带上前端期望的字段名
    res.json({ ...item, title: item.taskName, linkedNodeId: item.nodeId, isDone: remark ? /完成|done|✅/i.test(remark) : false, syncedNode });
  } catch (error) {
    console.error('❌ POST /api/daily-schedules 失败:', error);
    res.status(500).json({ error: 'Failed to create daily schedule' });
  }
});

// 更新日程（兼容前端字段名：title→taskName, linkedNodeId→nodeId, isDone→remark）
app.patch('/api/daily-schedules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const body = req.body ?? {};
    const { date, startTime, endTime, dimension } = body;
    // 兼容前端字段名
    const taskName  = body.taskName  ?? body.title       ?? undefined;
    const rawNodeId = body.nodeId    ?? body.linkedNodeId ?? undefined;
    const remark    = body.remark    !== undefined ? body.remark
                    : body.isDone    !== undefined ? (body.isDone ? '✅ 完成' : null)
                    : undefined;

    const data: any = {};
    if (date      !== undefined) data.date = String(date);
    if (startTime !== undefined) {
      if (!isValidScheduleTime(String(startTime))) {
        return res.status(400).json({ error: 'INVALID_START_TIME', message: 'startTime 格式必须为 HH:mm（支持 24:00~33:59 跨零点）' });
      }
      data.startTime = String(startTime);
    }
    if (endTime !== undefined) {
      if (!isValidScheduleTime(String(endTime))) {
        return res.status(400).json({ error: 'INVALID_END_TIME', message: 'endTime 格式必须为 HH:mm（支持 24:00~33:59 跨零点）' });
      }
      data.endTime = String(endTime);
    }
    if (data.startTime && data.endTime) {
      const [sh, sm] = data.startTime.split(':').map(Number);
      const [eh, em] = data.endTime.split(':').map(Number);
      if (sh * 60 + sm >= eh * 60 + em) {
        return res.status(400).json({ error: 'INVALID_TIME_RANGE', message: 'startTime 必须早于 endTime' });
      }
    }
    if (taskName  !== undefined) data.taskName = taskName ?? null;
    if (rawNodeId !== undefined) {
      const pid = rawNodeId ? parseInt(String(rawNodeId), 10) : null;
      data.nodeId = pid && !Number.isNaN(pid) ? pid : null;
    }
    if (dimension !== undefined) data.dimension = dimension ?? null;
    if (remark    !== undefined) data.remark    = remark ?? null;

    const updated = await (prisma as any).dailySchedule.update({ where: { id }, data });

    let syncedNode = null;
    const finalNodeId = data.nodeId ?? updated.nodeId;
    if (finalNodeId && (remark !== undefined || rawNodeId !== undefined)) {
      syncedNode = await syncL6NodeFromSchedule(finalNodeId, updated.remark ?? null);
    }

    const isDone = updated.remark ? /完成|done|✅/i.test(updated.remark) : false;
    res.json({ ...updated, title: updated.taskName, linkedNodeId: updated.nodeId, isDone, syncedNode });
  } catch (error) {
    console.error('❌ PATCH /api/daily-schedules/:id 失败:', error);
    res.status(500).json({ error: 'Failed to update daily schedule' });
  }
});

/**
 * PATCH /api/daily-schedules/top-task
 * 更新当日"今日最重要的一件事"（topTask），写入 DailySummary.mit。
 * 前端失焦时自动调用，无需用户手动保存。
 *
 * Body: { date: 'YYYY-MM-DD', topTask: string }
 */
app.patch('/api/daily-schedules/top-task', async (req, res) => {
  try {
    const { date, topTask } = req.body ?? {};
    if (!date) return res.status(400).json({ error: 'date 为必填项' });

    const mit = topTask != null ? String(topTask) : '';
    const result = await prisma.dailySummary.upsert({
      where: { date: String(date) },
      create: { date: String(date), mit },
      update: { mit },
    });

    console.log(`✅ [top-task] date=${date} mit="${mit.slice(0, 30)}"`);
    res.json({ date: result.date, topTask: result.mit });
  } catch (error) {
    console.error('❌ PATCH /api/daily-schedules/top-task 失败:', error);
    res.status(500).json({ error: 'Failed to update top task' });
  }
});
// 删除日程
app.delete('/api/daily-schedules/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const deleted = await (prisma as any).dailySchedule.delete({ where: { id } });
    res.json(deleted);
  } catch (error) {
    console.error('❌ DELETE /api/daily-schedules/:id 失败:', error);
    res.status(500).json({ error: 'Failed to delete daily schedule' });
  }
});

// ── AuditReport CRUD ──────────────────────────────────────────────────────

// 查询：按 reportType / periodCode 筛选
app.get('/api/audit-reports', async (req, res) => {
  try {
    const { reportType, periodCode } = req.query;
    const where: any = {};
    if (reportType) where.reportType = String(reportType);
    if (periodCode) where.periodCode = String(periodCode);
    const items = await prisma.auditReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(items);
  } catch (error) {
    console.error('❌ GET /api/audit-reports 失败:', error);
    res.status(500).json({ error: 'Failed to fetch audit reports' });
  }
});

// 创建或更新报告（upsert：同一 reportType+periodCode 只保留一份）
app.post('/api/audit-reports', async (req, res) => {
  try {
    const { reportType, periodCode, content, snapshotData } = req.body ?? {};
    if (!reportType || !periodCode || !content) {
      return res.status(400).json({ error: 'reportType, periodCode, content 为必填项' });
    }
    const VALID_TYPES = ['WEEK', 'MONTH', 'YEAR'];
    if (!VALID_TYPES.includes(reportType)) {
      return res.status(400).json({ error: `reportType 必须是 ${VALID_TYPES.join(' | ')}` });
    }
    const item = await prisma.auditReport.upsert({
      where: { reportType_periodCode: { reportType, periodCode } },
      update: { content, snapshotData: snapshotData ?? null },
      create: { reportType, periodCode, content, snapshotData: snapshotData ?? null },
    });
    console.log('✅ Upsert AuditReport:', item.reportType, item.periodCode);
    res.json(item);
  } catch (error) {
    console.error('❌ POST /api/audit-reports 失败:', error);
    res.status(500).json({ error: 'Failed to upsert audit report' });
  }
});

// 删除报告
app.delete('/api/audit-reports/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const deleted = await prisma.auditReport.delete({ where: { id } });
    res.json(deleted);
  } catch (error) {
    console.error('❌ DELETE /api/audit-reports/:id 失败:', error);
    res.status(500).json({ error: 'Failed to delete audit report' });
  }
});

// ── 知行合一审计接口 ──────────────────────────────────────────────────────────

/**
 * GET /api/audit/score
 * 对比当日 topImportantThing（意志锚点）与实际 DailySchedule（行为记录），
 * 计算并返回"知行合一"得分。
 *
 * 核心规则：
 *   - 若置顶任务（mit）未完成（在 ScheduleNode 中找不到匹配或 progress < 100），
 *     则得分强制锁定在 40 分以下（max 40）。
 *   - 否则按正常 AI 审计得分返回。
 *
 * 查询参数：
 *   date = YYYY-MM-DD（默认今天）
 *   forceRecalc = 'true'（强制重新触发 AI 审计，默认读缓存）
 */
app.get('/api/audit/score', async (req, res) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const forceRecalc = req.query.forceRecalc === 'true';

    // 1. 读取当日 DailySummary（含 mit 和已有 score）
    let summary = await prisma.dailySummary.findUnique({ where: { date } });

    // 2. 若无缓存或强制重算，触发 AI 审计
    if (!summary || summary.score == null || forceRecalc) {
      summary = await triggerDailyAIAudit(date) as any;
    }

    const rawScore: number = (summary as any)?.score ?? 0;
    const mit: string = (summary as any)?.mit ?? '';

    // 3. 置顶任务锁定逻辑：检查 mit 是否在当日日程中被完成
    let mitCompleted = true; // 默认视为完成（无 mit 时不惩罚）
    let mitMatchedNode: any = null;

    if (mit && mit.trim()) {
      // 在 ScheduleNode 中模糊匹配 mit 关键词
      const scheduleNodes = await prisma.scheduleNode.findMany({
        where: { date },
        select: { title: true, category: true },
      });

      // 简单关键词匹配：取 mit 前 10 字作为关键词
      const keyword = mit.trim().slice(0, 10);
      mitMatchedNode = scheduleNodes.find((n: any) =>
        n.title && n.title.includes(keyword)
      );

      // 同时检查 L6 PlanNode 中是否有对应完成的任务
      if (!mitMatchedNode) {
        const l6Match = await prisma.planNode.findFirst({
          where: {
            level: 6,
            title: { contains: keyword },
            progress: { gte: 100 },
          },
          select: { title: true, progress: true },
        });
        if (l6Match) mitMatchedNode = l6Match;
      }

      mitCompleted = !!mitMatchedNode;
    }

    // 4. 若置顶任务未完成，强制锁定得分 ≤ 40
    const finalScore = (!mitCompleted && rawScore > 40) ? 40 : rawScore;
    const scoreCapped = !mitCompleted && rawScore > 40;

    console.log(`📊 [audit/score] date=${date} mit="${mit.slice(0, 20)}" mitCompleted=${mitCompleted} rawScore=${rawScore} finalScore=${finalScore}`);

    res.json({
      date,
      score: finalScore,
      rawScore,
      scoreCapped,
      mitCompleted,
      mit,
      mitMatchedNode: mitMatchedNode ?? null,
      aiAudit: (summary as any)?.aiAudit ?? null,
      note: scoreCapped
        ? `置顶任务"${mit.slice(0, 20)}..."未完成，得分已锁定至 40 分以下`
        : null,
    });
  } catch (error) {
    console.error('❌ GET /api/audit/score 失败:', error);
    res.status(500).json({ error: 'Failed to calculate audit score' });
  }
});

/**
 * POST /api/reports/aggregate
 * 三栏映射聚合接口：按 year / priorities / category 过滤 PlanNode，
 * 返回战略层 / 管理层 / 执行层三栏结构化数据。
 *
 * Body：
 *   {
 *     year?:       number,           // 默认当年
 *     priorities?: string[],         // 默认 ['P0','P1']
 *     category?:   string,           // 'work'|'life'|'growth'，不传则全部
 *   }
 *
 * 三栏映射规则：
 *   战略层 (Strategy)   → level 1 或 2
 *   管理层 (Management) → level 3 或 4
 *   执行层 (Execution)  → level 5 或 6
 */
app.post('/api/reports/aggregate', async (req, res) => {
  try {
    const now = new Date();
    const {
      year       = now.getFullYear(),
      priorities = ['P0', 'P1'],
      category,
    } = req.body ?? {};

    const yearNum = Number(year);
    if (Number.isNaN(yearNum)) {
      return res.status(400).json({ error: 'year 必须是有效数字' });
    }

    // ── 基础 where 条件 ──────────────────────────────────────────
    const baseWhere: any = {
      priority: { in: priorities },
      // targetDate 在该年内，或 monthCode 以该年开头（兼容两种时间字段）
      OR: [
        { targetDate: { gte: new Date(`${yearNum}-01-01`), lte: new Date(`${yearNum}-12-31`) } },
        { monthCode: { startsWith: String(yearNum) } },
        { weekCode:  { startsWith: String(yearNum) } },
      ],
    };
    if (category) baseWhere.planCategory = category;

    // ── 三栏分别查询 ──────────────────────────────────────────────
    const SELECT_FIELDS = {
      id: true, title: true, level: true, priority: true,
      progress: true, planStatus: true, planCategory: true,
      owner: true, targetDate: true, dataFeedback: true,
      monthCode: true, weekCode: true, parentId: true,
    };

    const [strategyNodes, managementNodes, executionNodes] = await Promise.all([
      // 战略层：L1 + L2
      prisma.planNode.findMany({
        where: { ...baseWhere, level: { in: [1, 2] } },
        orderBy: [{ level: 'asc' }, { priority: 'asc' }, { progress: 'desc' }],
        select: SELECT_FIELDS,
      }),
      // 管理层：L3 + L4
      prisma.planNode.findMany({
        where: { ...baseWhere, level: { in: [3, 4] } },
        orderBy: [{ level: 'asc' }, { priority: 'asc' }, { progress: 'desc' }],
        select: SELECT_FIELDS,
      }),
      // 执行层：L5 + L6
      prisma.planNode.findMany({
        where: { ...baseWhere, level: { in: [5, 6] } },
        orderBy: [{ level: 'asc' }, { priority: 'asc' }, { progress: 'desc' }],
        select: SELECT_FIELDS,
      }),
    ]);

    // ── 汇总统计工具函数 ──────────────────────────────────────────
    const summarize = (nodes: any[]) => ({
      total:       nodes.length,
      done:        nodes.filter((n) => n.planStatus === 'DONE' || n.progress >= 100).length,
      inProgress:  nodes.filter((n) => n.planStatus === 'IN_PROGRESS' && n.progress < 100).length,
      planned:     nodes.filter((n) => n.planStatus === 'PLANNED').length,
      avgProgress: nodes.length > 0
        ? Math.round(nodes.reduce((s, n) => s + (n.progress ?? 0), 0) / nodes.length)
        : 0,
    });

    const allNodes = [...strategyNodes, ...managementNodes, ...executionNodes];

    console.log(`📊 [reports/aggregate] year=${yearNum} priorities=${priorities} category=${category ?? 'all'} total=${allNodes.length}`);

    res.json({
      year: yearNum,
      priorities,
      category: category ?? null,
      columns: {
        strategy: {
          label: '战略层',
          levels: [1, 2],
          nodes: strategyNodes,
          summary: summarize(strategyNodes),
        },
        management: {
          label: '管理层',
          levels: [3, 4],
          nodes: managementNodes,
          summary: summarize(managementNodes),
        },
        execution: {
          label: '执行层',
          levels: [5, 6],
          nodes: executionNodes,
          summary: summarize(executionNodes),
        },
      },
      overall: summarize(allNodes),
    });
  } catch (error) {
    console.error('❌ POST /api/reports/aggregate 失败:', error);
    res.status(500).json({ error: 'Failed to aggregate report' });
  }
});

/**
 * GET /api/reports/aggregate
 * 按报告类型自动提取对应时间段内 P0/P1 的 L6 任务，返回结构化数组供前端直接展示。
 *
 * 查询参数：
 *   type      = 'WEEK' | 'MONTH' | 'YEAR'（默认 WEEK）
 *   weekCode  = 手动指定周编码（如 2026-W11，默认当前周）
 *   monthCode = 手动指定月编码（如 2026-03，默认当前月）
 *
 * 返回：
 *   {
 *     type, period, priorities,
 *     groups: { P0: [...], P1: [...] },   // 按优先级分组
 *     nodes: [...],                        // 全量扁平数组
 *     summary: { total, done, inProgress, planned, avgProgress },
 *     markdown: string                     // 可直接复制/推送的 Markdown 文本
 *   }
 */
app.get('/api/reports/aggregate', async (req, res) => {
  try {
    const type = ((req.query.type as string) || 'WEEK').toUpperCase();
    const now = new Date();

    let where: any = { level: 6 };
    let period = '';
    let priorities: string[] = [];

    if (type === 'WEEK') {
      const weekCode = (req.query.weekCode as string) || getISOWeekCode(now);
      period = weekCode;
      priorities = ['P0', 'P1'];
      where = { level: 6, weekCode, priority: { in: priorities } };

    } else if (type === 'MONTH') {
      const monthCode = (req.query.monthCode as string) || getMonthCode(now);
      period = monthCode;
      priorities = ['P0', 'P1'];
      where = { level: 6, monthCode, priority: { in: priorities } };

    } else if (type === 'YEAR') {
      const monthCodes = getPastMonthCodes(12);
      period = `${now.getFullYear()}`;
      priorities = ['P0'];
      where = { level: 6, monthCode: { in: monthCodes }, priority: { in: priorities } };

    } else {
      return res.status(400).json({ error: 'type 必须是 WEEK | MONTH | YEAR' });
    }

    const nodes = await prisma.planNode.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { progress: 'desc' }],
      select: {
        id: true, title: true, level: true, priority: true,
        progress: true, planStatus: true, planCategory: true,
        weekCode: true, monthCode: true, dataFeedback: true,
        owner: true, targetDate: true,
      },
    });

    // ── 按优先级分组 ──────────────────────────────────────────────
    const groups: Record<string, typeof nodes> = { P0: [], P1: [] };
    for (const n of nodes) {
      const p = (n as any).priority ?? 'P1';
      if (!groups[p]) groups[p] = [];
      groups[p].push(n);
    }

    // ── 汇总统计 ──────────────────────────────────────────────────
    const total = nodes.length;
    const done = nodes.filter((n: any) => (n as any).planStatus === 'DONE' || (n as any).progress >= 100).length;
    const inProgress = nodes.filter((n: any) => (n as any).planStatus === 'IN_PROGRESS' && (n as any).progress < 100).length;
    const planned = nodes.filter((n: any) => (n as any).planStatus === 'PLANNED').length;
    const avgProgress = total > 0
      ? Math.round(nodes.reduce((s: number, n: any) => s + ((n as any).progress ?? 0), 0) / total)
      : 0;

    // ── 生成 Markdown ─────────────────────────────────────────────
    const TYPE_LABEL: Record<string, string> = { WEEK: '周报', MONTH: '月报', YEAR: '年报' };
    const label = TYPE_LABEL[type] ?? type;
    const mdLines: string[] = [
      `## 📋 ${label}｜${period}`,
      `> 共 **${total}** 条 | 已完成 **${done}** | 进行中 **${inProgress}** | 平均进度 **${avgProgress}%**`,
      '',
    ];

    for (const p of ['P0', 'P1']) {
      const group = groups[p];
      if (!group?.length) continue;
      mdLines.push(`### ${p} 任务`);
      for (const n of group) {
        const icon = (n as any).planStatus === 'DONE' || (n as any).progress >= 100 ? '✅'
          : (n as any).progress >= 50 ? '🔄' : '⏳';
        mdLines.push(`- ${icon} **${(n as any).title}** — ${(n as any).progress ?? 0}%`);
        if ((n as any).dataFeedback) {
          mdLines.push(`  > ${(n as any).dataFeedback}`);
        }
      }
      mdLines.push('');
    }

    const markdown = mdLines.join('\n');

    console.log(`📊 [reports/aggregate] type=${type} period=${period} total=${total}`);

    res.json({
      type,
      period,
      priorities,
      groups,
      nodes,
      summary: { total, done, inProgress, planned, avgProgress },
      markdown,
    });
  } catch (error) {
    console.error('❌ GET /api/reports/aggregate 失败:', error);
    res.status(500).json({ error: 'Failed to aggregate report' });
  }
});

/**
 * GET /api/audit/zhixing-heyi
 * 返回指定时间范围内每天的"知行合一"得分，供年视图渲染百分比格子。
 *
 * 查询参数：
 *   startDate = YYYY-MM-DD（默认当年 1 月 1 日）
 *   endDate   = YYYY-MM-DD（默认今天）
 *
 * 返回：
 *   {
 *     l1Goals: [{ title, planCategory, progress }],   // L1 战略目标（"谋"的锚点）
 *     calendar: [{ date, score, aiAudit, mit }],       // 每日得分（年视图格子数据）
 *     summary: { totalDays, scoredDays, avgScore, maxScore, minScore }
 *   }
 */
app.get('/api/audit/zhixing-heyi', async (req, res) => {
  try {
    const now = new Date();
    const defaultStart = `${now.getFullYear()}-01-01`;
    const defaultEnd = now.toISOString().slice(0, 10);
    const startDate = (req.query.startDate as string) || defaultStart;
    const endDate   = (req.query.endDate   as string) || defaultEnd;

    // 1. L1 战略目标（"谋"的顶层锚点）
    const l1Goals = await prisma.planNode.findMany({
      where: { level: 1 },
      select: { id: true, title: true, planCategory: true, progress: true, priority: true },
      orderBy: { priority: 'asc' },
    });

    // 2. 每日审计得分（"行"的量化结果）
    const dailySummaries = await prisma.dailySummary.findMany({
      where: { date: { gte: startDate, lte: endDate } },
      select: { date: true, score: true, aiAudit: true, mit: true },
      orderBy: { date: 'asc' },
    });

    // 3. 汇总统计
    const scored = dailySummaries.filter((d: any) => d.score != null);
    const scores = scored.map((d: any) => d.score as number);
    const avgScore = scores.length > 0
      ? Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length)
      : null;

    console.log(`📊 [audit/zhixing-heyi] ${startDate}~${endDate} l1=${l1Goals.length} days=${dailySummaries.length} scored=${scored.length}`);

    res.json({
      l1Goals,
      calendar: dailySummaries,
      summary: {
        totalDays: dailySummaries.length,
        scoredDays: scored.length,
        avgScore,
        maxScore: scores.length > 0 ? Math.max(...scores) : null,
        minScore: scores.length > 0 ? Math.min(...scores) : null,
      },
    });
  } catch (error) {
    console.error('❌ GET /api/audit/zhixing-heyi 失败:', error);
    res.status(500).json({ error: 'Failed to fetch zhixing-heyi data' });
  }
});

/**
 * POST /api/audit/trigger
 * 手动触发指定日期的"知行合一"AI 审计（或批量触发一段时间）。
 *
 * Body：
 *   { date?: 'YYYY-MM-DD' }   — 单日触发，默认今天
 *   { startDate, endDate }    — 批量触发（最多 30 天，防止超时）
 */
app.post('/api/audit/trigger', async (req, res) => {
  try {
    const { date, startDate, endDate } = req.body ?? {};

    // 单日触发
    if (date || (!startDate && !endDate)) {
      const targetDate = date || new Date().toISOString().slice(0, 10);
      const result = await triggerDailyAIAudit(targetDate);
      return res.json({ success: true, date: targetDate, result });
    }

    // 批量触发
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '批量触发需同时提供 startDate 和 endDate' });
    }

    const start = new Date(startDate);
    const end   = new Date(endDate);
    const diffDays = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;

    if (diffDays > 30) {
      return res.status(400).json({ error: '批量触发最多支持 30 天，请缩小范围' });
    }

    const results: any[] = [];
    for (let i = 0; i < diffDays; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().slice(0, 10);
      try {
        const r = await triggerDailyAIAudit(dateStr);
        results.push({ date: dateStr, score: (r as any)?.score ?? null, ok: true });
      } catch (e: any) {
        results.push({ date: dateStr, ok: false, error: e?.message });
      }
    }

    console.log(`✅ [audit/trigger] 批量完成 ${results.length} 天`);
    res.json({ success: true, results });
  } catch (error) {
    console.error('❌ POST /api/audit/trigger 失败:', error);
    res.status(500).json({ error: 'Failed to trigger audit' });
  }
});

// ── 复盘报告聚合引擎 ──────────────────────────────────────────────────────────
// 聚合规则（严格对齐业务字典）：
//   WEEK     → level=6, weekCode=当前周编码,  priority IN ['P0','P1','P2','P3']
//   MONTH    → level=6, monthCode=当前月编码, priority IN ['P0','P1']
//   HALF_YEAR→ level=6, 近 6 个月 monthCode,  priority IN ['P0']
//   YEAR     → level=6, 近 12 个月 monthCode, priority IN ['P0']
//
// 周编码格式：YYYY-Www（如 2026-W11）
// 月编码格式：YYYY-MM（如 2026-03）

/** 生成 ISO 周编码，例如 "2026-W11" */
function getISOWeekCode(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** 生成月编码，例如 "2026-03" */
function getMonthCode(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** 生成过去 N 个月的月编码列表 */
function getPastMonthCodes(n: number): string[] {
  const codes: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    codes.push(getMonthCode(d));
  }
  return codes;
}

/**
 * GET /api/audit/aggregate
 * 查询参数：
 *   type    = 'WEEK' | 'MONTH' | 'HALF_YEAR' | 'YEAR'（默认 WEEK）
 *   weekCode  = 手动指定周编码（可选，默认当前周）
 *   monthCode = 手动指定月编码（可选，默认当前月）
 *
 * 返回：
 *   { type, period, priorities, nodes: PlanNode[], summary: { total, done, avgProgress } }
 */
app.get('/api/audit/aggregate', async (req, res) => {
  try {
    const type = (req.query.type as string || 'WEEK').toUpperCase();
    const now = new Date();

    let where: any = { level: 6 };
    let period = '';
    let priorities: string[] = [];

    if (type === 'WEEK') {
      const weekCode = (req.query.weekCode as string) || getISOWeekCode(now);
      period = weekCode;
      priorities = ['P0', 'P1', 'P2', 'P3'];
      where = { level: 6, weekCode, priority: { in: priorities } };

    } else if (type === 'MONTH') {
      const monthCode = (req.query.monthCode as string) || getMonthCode(now);
      period = monthCode;
      priorities = ['P0', 'P1'];
      where = { level: 6, monthCode, priority: { in: priorities } };

    } else if (type === 'HALF_YEAR') {
      const monthCodes = getPastMonthCodes(6);
      period = `${monthCodes[monthCodes.length - 1]} ~ ${monthCodes[0]}`;
      priorities = ['P0'];
      where = { level: 6, monthCode: { in: monthCodes }, priority: { in: priorities } };

    } else if (type === 'YEAR') {
      const monthCodes = getPastMonthCodes(12);
      period = `${monthCodes[monthCodes.length - 1]} ~ ${monthCodes[0]}`;
      priorities = ['P0'];
      where = { level: 6, monthCode: { in: monthCodes }, priority: { in: priorities } };

    } else {
      return res.status(400).json({ error: 'type 必须是 WEEK | MONTH | HALF_YEAR | YEAR' });
    }

    const nodes = await prisma.planNode.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { progress: 'desc' }],
      select: {
        id: true, title: true, level: true, priority: true,
        progress: true, planStatus: true, planCategory: true,
        weekCode: true, monthCode: true, dataFeedback: true,
        owner: true, targetDate: true,
      },
    });

    const total = nodes.length;
    const done = nodes.filter((n: any) => n.planStatus === 'DONE' || n.progress >= 100).length;
    const avgProgress = total > 0
      ? Math.round(nodes.reduce((sum: number, n: any) => sum + (n.progress ?? 0), 0) / total)
      : 0;

    console.log(`📊 [audit/aggregate] type=${type} period=${period} nodes=${total}`);

    res.json({
      type,
      period,
      priorities,
      nodes,
      summary: { total, done, avgProgress },
    });
  } catch (error) {
    console.error('❌ GET /api/audit/aggregate 失败:', error);
    res.status(500).json({ error: 'Failed to aggregate audit data' });
  }
});

/**
 * POST /api/audit/push-wecom
 * 将聚合结果格式化为 Markdown 并推送至企业微信 Webhook，记录推送历史。
 *
 * Body：
 *   { type, period, nodes, summary, webhookUrl? }
 *   webhookUrl 可选，优先使用 body 传入，否则读取 WECOM_WEBHOOK_URL 环境变量
 */
app.post('/api/audit/push-wecom', async (req, res) => {
  try {
    const { type, period, nodes, summary, webhookUrl: bodyWebhook } = req.body ?? {};

    if (!type || !period || !Array.isArray(nodes)) {
      return res.status(400).json({ error: 'type, period, nodes 为必填项' });
    }

    const webhookUrl = bodyWebhook || process.env.WECOM_WEBHOOK_URL;
    if (!webhookUrl) {
      return res.status(400).json({
        error: 'WECOM_WEBHOOK_URL 未配置',
        hint: '请在 .env 中设置 WECOM_WEBHOOK_URL，或在请求 body 中传入 webhookUrl',
      });
    }

    // ── 格式化 Markdown 消息 ──────────────────────────────────────
    const TYPE_LABEL: Record<string, string> = {
      WEEK: '周报', MONTH: '月报', HALF_YEAR: '半年报', YEAR: '年报',
    };
    const label = TYPE_LABEL[type] ?? type;

    const lines: string[] = [
      `## 📋 LoveMe OS ${label}｜${period}`,
      `> 总任务 **${summary?.total ?? nodes.length}** 条｜已完成 **${summary?.done ?? 0}** 条｜平均进度 **${summary?.avgProgress ?? 0}%**`,
      '',
    ];

    // 按 priority 分组
    const grouped: Record<string, typeof nodes> = {};
    for (const n of nodes) {
      const p = (n as any).priority ?? 'P3';
      if (!grouped[p]) grouped[p] = [];
      grouped[p].push(n);
    }

    for (const p of ['P0', 'P1', 'P2', 'P3']) {
      const group = grouped[p];
      if (!group?.length) continue;
      lines.push(`### ${p} 任务`);
      for (const n of group) {
        const status = (n as any).planStatus === 'DONE' ? '✅' : (n as any).progress >= 50 ? '🔄' : '⏳';
        lines.push(`- ${status} **${(n as any).title}** — ${(n as any).progress ?? 0}%`);
        if ((n as any).dataFeedback) {
          lines.push(`  > ${(n as any).dataFeedback}`);
        }
      }
      lines.push('');
    }

    const markdownContent = lines.join('\n');

    // ── 推送至企业微信 ────────────────────────────────────────────
    let pushStatus = 'SUCCESS';
    let pushError = '';

    try {
      const wecomRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: { content: markdownContent },
        }),
      });
      const wecomJson = await wecomRes.json() as any;
      if (wecomJson.errcode !== 0) {
        pushStatus = 'FAILED';
        pushError = `企业微信返回错误: ${wecomJson.errmsg}`;
      }
    } catch (fetchErr: any) {
      pushStatus = 'FAILED';
      pushError = fetchErr?.message ?? '网络请求失败';
    }

    // ── 记录推送历史 ──────────────────────────────────────────────
    const history = await prisma.pushHistory.create({
      data: {
        content: markdownContent,
        status: pushStatus,
        platform: 'WECHAT',
        reportType: type,
        reportPeriod: period,
        snapshotData: JSON.stringify({ nodes, summary }),
      },
    });

    console.log(`📤 [audit/push-wecom] type=${type} period=${period} status=${pushStatus}`);

    if (pushStatus === 'FAILED') {
      return res.status(502).json({
        error: pushError,
        historyId: history.id,
        markdownContent,
      });
    }

    res.json({
      success: true,
      historyId: history.id,
      markdownContent,
      summary,
    });
  } catch (error) {
    console.error('❌ POST /api/audit/push-wecom 失败:', error);
    res.status(500).json({ error: 'Failed to push to WeCom' });
  }
});

// ── 周报自动聚合接口 ──────────────────────────────────────────────────────────

/**
 * GET /api/reports/weekly?date=YYYY-MM-DD
 *
 * 聚合该周（周一~周日）内的执行数据，返回三层结构：
 *   L4 标题 → L5 标题 → L6 任务列表（含实际工时）
 *
 * 返回结构：
 *   {
 *     weekCode,          // 如 "2026-W11"
 *     weekRange,         // { start: "2026-03-09", end: "2026-03-15" }
 *     completed: [...],  // 本周已完成的 L6（planStatus=DONE）
 *     inProgress: [...], // 进行中的 L5 + L6（planStatus=IN_PROGRESS）
 *     hierarchy: [...],  // L4→L5→L6 三层结构（含工时）
 *     stats: { totalHours, completedCount, inProgressCount, l5Count }
 *   }
 */
app.get('/api/reports/weekly', async (req, res) => {
  try {
    const dateParam = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const baseDate  = new Date(dateParam);
    if (Number.isNaN(baseDate.getTime())) {
      return res.status(400).json({ error: 'date 格式无效，请使用 YYYY-MM-DD' });
    }

    // ── 计算本周的周一和周日 ──────────────────────────────────────
    const weekCode = getISOWeekCode(baseDate);
    const dow = baseDate.getDay() === 0 ? 7 : baseDate.getDay(); // 1=周一 … 7=周日
    const monday = new Date(baseDate);
    monday.setDate(baseDate.getDate() - dow + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekStart = monday.toISOString().slice(0, 10);
    const weekEnd   = sunday.toISOString().slice(0, 10);

    // ── 1. 查询本周 L6 已完成节点 ────────────────────────────────
    const completedL6 = await prisma.planNode.findMany({
      where: { level: 6, weekCode, planStatus: 'DONE' },
      select: {
        id: true, title: true, priority: true, progress: true,
        planStatus: true, planCategory: true, dataFeedback: true,
        parentId: true,
      },
      orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    });

    // ── 2. 查询进行中的 L5 和 L6 ─────────────────────────────────
    const inProgressNodes = await prisma.planNode.findMany({
      where: {
        level: { in: [5, 6] },
        planStatus: 'IN_PROGRESS',
      },
      select: {
        id: true, title: true, level: true, priority: true,
        progress: true, planStatus: true, planCategory: true,
        monthCode: true, weekCode: true, parentId: true,
      },
      orderBy: [{ level: 'asc' }, { priority: 'asc' }],
    });

    // ── 3. 查询本周 DailySchedule，统计各 L6 实际工时 ────────────
    const weekSchedules = await (prisma as any).dailySchedule.findMany({
      where: {
        date: { gte: weekStart, lte: weekEnd },
        nodeId: { not: null },
      },
      select: { nodeId: true, startTime: true, endTime: true, date: true, taskName: true },
    });

    // 计算每个 nodeId 的实际工时（分钟 → 小时）
    const hoursMap: Record<number, number> = {};
    for (const s of weekSchedules) {
      if (!s.nodeId) continue;
      const [sh, sm] = String(s.startTime).split(':').map(Number);
      const [eh, em] = String(s.endTime).split(':').map(Number);
      const minutes = (eh * 60 + em) - (sh * 60 + sm);
      if (minutes > 0) {
        hoursMap[s.nodeId] = (hoursMap[s.nodeId] ?? 0) + minutes / 60;
      }
    }

    // ── 4. 构建 L4→L5→L6 三层层级结构 ───────────────────────────
    // 收集本周涉及的所有 L5 parentId（来自 completedL6 + inProgressNodes 中的 L6）
    const allL6 = [
      ...completedL6,
      ...inProgressNodes.filter((n: any) => n.level === 6),
    ];
    const l5Ids = [...new Set(allL6.map((n: any) => n.parentId).filter(Boolean))] as number[];

    // 查询这些 L5 节点
    const l5Nodes = l5Ids.length > 0
      ? await prisma.planNode.findMany({
          where: { id: { in: l5Ids } },
          select: { id: true, title: true, level: true, priority: true, progress: true, planStatus: true, monthCode: true, parentId: true },
        })
      : [];

    // 查询 L5 对应的 L4 节点
    const l4Ids = [...new Set(l5Nodes.map((n: any) => n.parentId).filter(Boolean))] as number[];
    const l4Nodes = l4Ids.length > 0
      ? await prisma.planNode.findMany({
          where: { id: { in: l4Ids } },
          select: { id: true, title: true, level: true, priority: true, progress: true, planStatus: true },
        })
      : [];

    // 建立快速查找 Map
    const l5Map = new Map(l5Nodes.map((n: any) => [n.id, n]));
    const l4Map = new Map(l4Nodes.map((n: any) => [n.id, n]));

    // 为每个 L6 附加 L5/L4 标题和实际工时
    const enrichL6 = (node: any) => {
      const l5 = l5Map.get(node.parentId);
      const l4 = l5 ? l4Map.get((l5 as any).parentId) : null;
      return {
        ...node,
        actualHours: Math.round((hoursMap[node.id] ?? 0) * 100) / 100,
        l5Title: (l5 as any)?.title ?? null,
        l5Id:    (l5 as any)?.id    ?? null,
        l4Title: (l4 as any)?.title ?? null,
        l4Id:    (l4 as any)?.id    ?? null,
      };
    };

    // 构建 L4→L5→L6 嵌套结构
    const hierarchy = l4Nodes.map((l4: any) => {
      const children = l5Nodes
        .filter((l5: any) => l5.parentId === l4.id)
        .map((l5: any) => {
          const l6List = allL6
            .filter((l6: any) => l6.parentId === l5.id)
            .map((l6: any) => ({
              ...l6,
              actualHours: Math.round((hoursMap[l6.id] ?? 0) * 100) / 100,
            }));
          const l5Hours = l6List.reduce((s: number, n: any) => s + n.actualHours, 0);
          return {
            ...l5,
            actualHours: Math.round(l5Hours * 100) / 100,
            l6Nodes: l6List,
          };
        });
      const l4Hours = children.reduce((s: number, n: any) => s + n.actualHours, 0);
      return {
        ...l4,
        actualHours: Math.round(l4Hours * 100) / 100,
        l5Nodes: children,
      };
    });

    // ── 5. 汇总统计 ───────────────────────────────────────────────
    const totalHours = Math.round(
      Object.values(hoursMap).reduce((s, h) => s + h, 0) * 100
    ) / 100;

    console.log(`📊 [reports/weekly] weekCode=${weekCode} completed=${completedL6.length} inProgress=${inProgressNodes.length} totalHours=${totalHours}`);

    res.json({
      weekCode,
      weekRange: { start: weekStart, end: weekEnd },
      completed:  completedL6.map(enrichL6),
      inProgress: inProgressNodes.map((n: any) => n.level === 6 ? enrichL6(n) : {
        ...n,
        l4Title: l4Map.get((l5Map.get(n.id) as any)?.parentId as number)?.title ?? null,
      }),
      hierarchy,
      stats: {
        totalHours,
        completedCount:  completedL6.length,
        inProgressCount: inProgressNodes.length,
        l5Count:         l5Nodes.length,
        l4Count:         l4Nodes.length,
      },
    });
  } catch (error) {
    console.error('❌ GET /api/reports/weekly 失败:', error);
    res.status(500).json({ error: 'Failed to generate weekly report' });
  }
});

// ── 周报锁定与智能滚入 ────────────────────────────────────────────────────────

/**
 * POST /api/nodes/week-report/lock
 *
 * 手动触发（用户点击"生成周报"时调用），执行两件事：
 *   1. 维度审计：按 planCategory 区分工作日/全周范围，快照本周 L6 状态
 *   2. 智能滚入：将 IN_PROGRESS_CROSS_WEEK 的节点复制到下一周
 *
 * Body: { weekCode?: string }  — 不传则默认当前周
 *
 * 返回:
 *   {
 *     weekCode,
 *     snapshot: { work: [...], life: [...], growth: [...] },
 *     rolledOver: [{ originalId, newId, title }],
 *     auditContext: AuditContext
 *   }
 */
app.post('/api/nodes/week-report/lock', async (req, res) => {
  try {
    const { weekCode: bodyWeekCode } = req.body ?? {};
    const weekCode = bodyWeekCode || getISOWeekCode(new Date());

    /* 计算本周周一和周日 */
    const [yearStr, weekStr] = weekCode.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekStr, 10);
    const jan4 = new Date(year, 0, 4);
    const startOfWeek1 = new Date(jan4);
    startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
    const monday = new Date(startOfWeek1);
    monday.setDate(startOfWeek1.getDate() + (week - 1) * 7);
    const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);

    const weekStart = monday.toISOString().slice(0, 10);
    const weekEnd   = sunday.toISOString().slice(0, 10);
    const weekdayEnd = friday.toISOString().slice(0, 10);

    /* 1. 维度审计：抓取本周所有 L6 节点 */
    const allL6 = await prisma.planNode.findMany({
      where: { level: 6, weekCode },
      select: {
        id: true, title: true, planStatus: true, progress: true,
        priority: true, planCategory: true, dataFeedback: true,
        issueLog: true, actualHours: true, parentId: true,
      },
    });

    /* 按维度分组（工作=工作日范围，生活/成长=全周） */
    const snapshot: Record<string, any[]> = { work: [], life: [], growth: [], other: [] };
    for (const node of allL6) {
      const cat = (node as any).planCategory;
      if (cat === '工作')      snapshot.work.push(node);
      else if (cat === '生活') snapshot.life.push(node);
      else if (cat === '成长') snapshot.growth.push(node);
      else                     snapshot.other.push(node);
    }

    /* 2. 智能滚入：IN_PROGRESS_CROSS_WEEK → 下一周副本 */
    const crossWeekNodes = allL6.filter(
      (n: any) => n.planStatus === 'IN_PROGRESS_CROSS_WEEK'
    );

    /* 计算下一周的 weekCode */
    const nextMonday = new Date(monday); nextMonday.setDate(monday.getDate() + 7);
    const nextWeekCode = getISOWeekCode(nextMonday);

    const rolledOver: { originalId: number; newId: number; title: string }[] = [];

    for (const node of crossWeekNodes) {
      /* 继承原节点的所有编码字段，weekCode 更新为下一周 */
      const inheritedRollCodes = {
        planCategoryCode: (node as any).planCategoryCode ?? null,
        objectiveCode:    (node as any).objectiveCode    ?? null,
        krCode:           (node as any).krCode           ?? null,
        detail1Code:      (node as any).detail1Code      ?? null,
        detail2Code:      (node as any).detail2Code      ?? null,
      };
      /* 重新拼接 nodeNumber：用下一周的 weekCode 替换末段 */
      const rollNodeNumber = await buildNodeNumber(6, { ...inheritedRollCodes, weekCode: nextWeekCode }, null);

      const newNode = await prisma.planNode.create({
        data: {
          title:        `${(node as any).title}（持续）`,
          level:        6,
          parentId:     (node as any).parentId,
          priority:     (node as any).priority ?? 'P1',
          planStatus:   'IN_PROGRESS',
          planCategory: (node as any).planCategory ?? null,
          progress:     (node as any).progress ?? 0,
          weekCode:     nextWeekCode,
          monthCode:    (node as any).monthCode ?? null,
          /* 继承原节点的 issueLog 作为背景说明 */
          issueLog:     (node as any).issueLog
            ? `【上周延续】${(node as any).issueLog}`
            : '【上周延续】',
          /* 继承编码字段，保留血缘 */
          ...inheritedRollCodes,
          nodeNumber: rollNodeNumber ?? undefined,
        },
      });
      rolledOver.push({
        originalId: (node as any).id,
        newId:      newNode.id,
        title:      (node as any).title,
      });
    }

    /* 3. 调用 AI 审计服务生成 AuditContext */
    const { getAuditContext } = await import('./services/audit_service');
    const auditContext = await getAuditContext(weekCode);

    console.log(
      `🔒 [week-report/lock] weekCode=${weekCode} l6=${allL6.length} crossWeek=${crossWeekNodes.length} rolledOver=${rolledOver.length}`
    );

    res.json({
      weekCode,
      weekRange: { start: weekStart, end: weekEnd, weekdayEnd },
      snapshot,
      rolledOver,
      auditContext,
    });
  } catch (error) {
    console.error('❌ POST /api/nodes/week-report/lock 失败:', error);
    res.status(500).json({ error: 'Failed to lock week report' });
  }
});

/**
 * POST /api/nodes/week-report/audit
 * 在 lock 之后调用，触发 AI 生成 200 字教练点评并写入 AuditReport 表。
 *
 * Body: { weekCode?: string }
 */
app.post('/api/nodes/week-report/audit', async (req, res) => {
  try {
    const { weekCode: bodyWeekCode } = req.body ?? {};
    const weekCode = bodyWeekCode || getISOWeekCode(new Date());

    const { getAuditContext, generateWeekAudit } = await import('./services/audit_service');
    const ctx     = await getAuditContext(weekCode);
    const result  = await generateWeekAudit(weekCode);

    /* 写入 AuditReport 表（upsert，同一周只保留最新一份） */
    const report = await (prisma as any).auditReport.upsert({
      where: { reportType_periodCode: { reportType: 'WEEK', periodCode: weekCode } },
      update: { content: result.coaching, snapshotData: JSON.stringify(ctx) },
      create: {
        reportType:   'WEEK',
        periodCode:   weekCode,
        content:      result.coaching,
        snapshotData: JSON.stringify(ctx),
      },
    });

    console.log(`✅ [week-report/audit] weekCode=${weekCode} completionRate=${result.context.completionRate}%`);
    res.json({ weekCode, coaching: result.coaching, context: result.context, generatedAt: result.generatedAt, reportId: report.id });
  } catch (error) {
    console.error('❌ POST /api/nodes/week-report/audit 失败:', error);
    res.status(500).json({ error: 'Failed to generate week audit' });
  }
});

// ── 月度认领接口 ──────────────────────────────────────────────────────────────

/**
 * POST /api/assignments
 * 将一个节点（通常是 L5）认领到某个月，设定本月计划进度增量。
 * 同一节点可在不同月份多次认领。
 *
 * Body: { nodeId, monthCode?, plannedIncrement?, assignee?, remark? }
 */
app.post('/api/assignments', async (req, res) => {
  try {
    const { nodeId, monthCode, plannedIncrement: _pi, planned_increment: _pi2, assignee, remark } = req.body ?? {};
    const plannedIncrement = _pi ?? _pi2; // 兼容驼峰和下划线两种命名

    if (!nodeId) {
      return res.status(400).json({ error: 'MISSING_NODE_ID', message: 'nodeId 必填' });
    }
    const parsedNodeId = parseInt(String(nodeId), 10);
    if (Number.isNaN(parsedNodeId)) {
      return res.status(400).json({ error: 'INVALID_NODE_ID', message: 'nodeId 必须是数字' });
    }

    // 验证节点存在
    const node = await prisma.planNode.findUnique({ where: { id: parsedNodeId } });
    if (!node) {
      return res.status(404).json({ error: 'NODE_NOT_FOUND', message: `节点 ${parsedNodeId} 不存在` });
    }

    // monthCode 未传则自动补当前月
    const now = new Date();
    const resolvedMonthCode = (monthCode && /^\d{4}-\d{2}$/.test(String(monthCode)))
      ? String(monthCode)
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const parsedIncrement = plannedIncrement != null
      ? Math.min(100, Math.max(0, parseInt(String(plannedIncrement), 10) || 0))
      : 0;

    const assignment = await (prisma as any).nodeAssignment.create({
      data: {
        nodeId:           parsedNodeId,
        monthCode:        resolvedMonthCode,
        plannedIncrement: parsedIncrement,
        assignee:         assignee ? String(assignee) : ((node as any).owner ?? null),
        remark:           remark ? String(remark) : null,
      },
    });

    /* ── 自动累加更新节点 progress ──────────────────────────────────
     * 规则：将本次 plannedIncrement 累加到节点当前 progress，上限 100。
     * 这样每次认领一个月的增量目标，节点进度自动向前推进。
     * ──────────────────────────────────────────────────────────── */
    let updatedNode = node;
    if (parsedIncrement > 0) {
      const currentProgress = (node as any).progress ?? 0;
      const newProgress = Math.min(100, currentProgress + parsedIncrement);
      updatedNode = await prisma.planNode.update({
        where: { id: parsedNodeId },
        data: {
          progress:   newProgress,
          // 进度达到 100 时自动标记完成
          planStatus: newProgress >= 100 ? 'DONE' : ((node as any).planStatus === 'PLANNED' ? 'IN_PROGRESS' : (node as any).planStatus),
        },
      });
      console.log(`📈 [assignments] 节点 ${parsedNodeId} progress: ${currentProgress}% → ${newProgress}%`);
    }

    console.log(`✅ [assignments] 节点 ${parsedNodeId}「${(node as any).title}」已认领到 ${resolvedMonthCode}，计划增量 ${parsedIncrement}%`);
    // 返回对象字段对齐：month_code（下划线）优先，避免前端字段漂移
    res.json({
      assignment: {
        ...assignment,
        month_code: assignment.monthCode,
        planned_increment: assignment.plannedIncrement,
      },
      node: {
        id:         (updatedNode as any).id,
        title:      (updatedNode as any).title,
        progress:   (updatedNode as any).progress,
        planStatus: (updatedNode as any).planStatus,
      },
    });
  } catch (error) {
    console.error('❌ POST /api/assignments 失败:', error);
    res.status(500).json({ error: 'Failed to create assignment' });
  }
});

/**
 * GET /api/assignments
 * 查询认领记录。支持按 nodeId、monthCode 过滤。
 *
 * Query: { nodeId?, monthCode? }
 */
app.get('/api/assignments', async (req, res) => {
  try {
    const { nodeId, monthCode } = req.query;
    const where: any = {};
    if (nodeId) {
      const id = parseInt(String(nodeId), 10);
      if (!Number.isNaN(id)) where.nodeId = id;
    }
    if (monthCode) where.monthCode = String(monthCode);

    const assignments = await (prisma as any).nodeAssignment.findMany({
      where,
      include: {
        planNode: {
          select: { id: true, title: true, level: true, progress: true, planStatus: true, planCategory: true },
        },
      },
      orderBy: [{ monthCode: 'desc' }, { createdAt: 'desc' }],
    });

    // 返回对象字段对齐：month_code（下划线）优先
    res.json(assignments.map((a: any) => ({
      ...a,
      month_code: a.monthCode,
      planned_increment: a.plannedIncrement,
    })));
  } catch (error) {
    console.error('❌ GET /api/assignments 失败:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

/**
 * DELETE /api/assignments/:id
 *
 * 精准删除某个月的认领记录：仅删除 assignments 表中的记录，不触碰 PlanNode 本体。
 * （严禁在此路由删除 PlanNode，避免前端误触发 HAS_CHILDREN）
 */
app.delete('/api/assignments/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
    const { deleteNodeAssignment } = await import('./services/planService');
    const deleted = await deleteNodeAssignment(id);
    console.log(`🗑️ [assignments] 已删除认领记录 id=${id}（仅 assignments，不触碰 PlanNode）`);
    res.json({
      ...deleted,
      month_code: (deleted as any).monthCode,
      planned_increment: (deleted as any).plannedIncrement,
    });
  } catch (error) {
    console.error('❌ DELETE /api/assignments/:id 失败:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

// ── 待办节点查询 ──────────────────────────────────────────────────────────────

/**
 * GET /api/nodes/todo
 * 返回所有未完成（planStatus != DONE）的节点，附带全局进度汇总。
 *
 * Query: { level?, planCategory?, monthCode?, weekCode? }
 */
app.get('/api/nodes/todo', async (req, res) => {
  try {
    const { level, planCategory, monthCode, weekCode } = req.query;
    const where: any = {
      planStatus: { not: 'DONE' },
    };
    if (level)       where.level       = parseInt(String(level), 10);
    if (planCategory) where.planCategory = String(planCategory);
    if (monthCode)   where.monthCode   = String(monthCode);
    if (weekCode)    where.weekCode    = String(weekCode);

    const nodes = await prisma.planNode.findMany({
      where,
      select: {
        id: true, title: true, level: true, priority: true,
        planStatus: true, planCategory: true, progress: true,
        parentId: true, monthCode: true, weekCode: true,
        owner: true, targetDate: true, dataFeedback: true,
      },
      orderBy: [{ priority: 'asc' }, { level: 'asc' }, { id: 'asc' }],
    });

    // 全局进度汇总：所有未完成节点的平均进度
    const totalProgress = nodes.length > 0
      ? Math.round(nodes.reduce((s: number, n: any) => s + (n.progress ?? 0), 0) / nodes.length)
      : 0;

    // 按维度分组统计
    const byCategory: Record<string, { count: number; avgProgress: number }> = {};
    for (const n of nodes) {
      const cat = (n as any).planCategory ?? '未分类';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, avgProgress: 0 };
      byCategory[cat].count++;
      byCategory[cat].avgProgress += (n as any).progress ?? 0;
    }
    for (const k of Object.keys(byCategory)) {
      byCategory[k].avgProgress = Math.round(byCategory[k].avgProgress / byCategory[k].count);
    }

    console.log(`📋 [nodes/todo] 未完成节点: ${nodes.length} 条，全局进度: ${totalProgress}%`);
    res.json({
      total: nodes.length,
      totalProgress,
      byCategory,
      nodes,
    });
  } catch (error) {
    console.error('❌ GET /api/nodes/todo 失败:', error);
    res.status(500).json({ error: 'Failed to fetch todo nodes' });
  }
});

app.listen(PORT_NUMBER, '0.0.0.0', () => {
  console.log(`🚀 Server is running on http://192.168.5.62:${PORT_NUMBER}`);
});