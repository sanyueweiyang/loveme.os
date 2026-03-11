import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

import { 
  createPlanNode, 
  getAllNodes, 
  getNodesByLayer, 
  getAllUsers, 
  updatePlanNode, 
  deletePlanNode, 
  getWeeklyReportNodes,
  claimTask,
  savePushHistory,
  getPushHistory
} from './services/planService';
import { generateWeeklyReportCopy } from './utils/reportGenerator';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3000;

// 1. CORS Configuration (Allow All)
app.use(cors({ origin: '*' }));
app.use(express.json());

// --- Helper Functions ---

interface TreeNode {
  id: number;
  title: string;
  level: number;
  progress: number;
  owner: string | null;
  priority: string;
  plannedEndDate: string | null;
  planStatus: string | null;
  outputContent: string | null;
  children: TreeNode[];
}

function buildTree(nodes: any[], parentId: number | null = null): TreeNode[] {
  return nodes
    .filter(node => node.parentId === parentId)
    .map(node => ({
      id: node.id,
      title: node.title,
      level: node.level,
      progress: node.progress,
      owner: node.owner,
      priority: node.priority,
      plannedEndDate: node.plannedEndDate,
      planStatus: node.planStatus,
      outputContent: node.outputContent,
      children: buildTree(nodes, node.id)
    }));
}

/**
 * 消息模板引擎：严格按公式生成文本
 * 使用新的 generateWeeklyReportCopy
 */
function generateWeeklyReportText(nodes: any[]): string {
  let report = '## 🚀 本周项目进度汇报\n\n';
  let index = 1;

  if (nodes.length === 0) {
    return '本周暂无认领任务。';
  }

  nodes.forEach(node => {
    // 使用新的拼接引擎
    const line = generateWeeklyReportCopy(node, index);
    report += `${line}\n\n`;
    index++;
  });

  report += `\n*数据截止时间：${new Date().toLocaleString('zh-CN')}*`;
  return report;
}

/**
 * 消息模板引擎 (Markdown for Tree View - 保留旧版用于概览)
 */
function generateWeChatMarkdown(nodes: TreeNode[]): string {
  let markdown = '## 🚀 项目全景概览\n\n';
  nodes.forEach(l1 => {
    const l1Progress = l1.progress >= 100 ? '✅' : l1.progress > 0 ? '🔄' : '⏳';
    markdown += `### ${l1Progress} ${l1.title} <font color="info">${l1.progress}%</font>\n`;
    if (l1.children && l1.children.length > 0) {
      l1.children.forEach(l2 => {
        const l2Progress = l2.progress >= 100 ? '✅' : l2.progress > 0 ? '▶️' : '⏹️';
        markdown += `> **${l2.title}** ${l2Progress} <font color="comment">${l2.progress}%</font>\n`;
      });
      markdown += '\n';
    }
  });
  return markdown;
}

/**
 * Webhook 推送模块 + 存档
 */
async function pushToWeChat(content: string): Promise<boolean> {
  const key = process.env.WECHAT_ROBOT_KEY;
  if (!key || key === 'YOUR_KEY_HERE') {
    console.warn('⚠️ 缺少 WECHAT_ROBOT_KEY，跳过推送。');
    return false;
  }

  // 存档
  try {
    await prisma.pushHistory.create({
      data: {
        content,
        status: 'PENDING',
        platform: 'WECHAT'
      }
    });
  } catch (e) {
    console.error('Archive failed', e);
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'markdown',
        markdown: { content }
      })
    });
    
    const result = await response.json();
    const success = result.errcode === 0;
    
    // 更新存档状态
    // 注意：实际生产中应获取刚才创建的 ID 进行更新，这里简化处理
    
    if (success) {
      console.log('✅ 企业微信推送成功');
      return true;
    } else {
      console.error('❌ 企业微信推送失败:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ 网络请求错误:', error);
    return false;
  }
}

async function updateParentProgressRecursive(parentId: number) {
  const parent = await prisma.planNode.findUnique({
    where: { id: parentId },
    include: { children: true }
  });

  if (!parent || parent.children.length === 0) return;

  const totalProgress = parent.children.reduce((sum, child) => sum + child.progress, 0);
  const averageProgress = parseFloat((totalProgress / parent.children.length).toFixed(2));

  if (parent.progress !== averageProgress) {
    await prisma.planNode.update({
      where: { id: parentId },
      data: { progress: averageProgress },
    });
    
    if (parent.parentId) {
      await updateParentProgressRecursive(parent.parentId);
    }
  }
}

// --- Routes ---

// 1. 树形结构
app.get('/api/nodes/tree', async (req, res) => {
  try {
    const allNodes = await prisma.planNode.findMany({ orderBy: { createdAt: 'asc' } });
    const tree = buildTree(allNodes, null);
    res.json(tree);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch tree' });
  }
});

// 2. 日志接口 (CRUD)
app.get('/api/logs', async (req, res) => {
  try {
    const logs = await prisma.workLog.findMany({
      orderBy: { date: 'desc' },
      include: { relatedNode: { select: { title: true } } }
    });
    res.json(logs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Create Log
app.post('/api/logs', async (req, res) => {
  try {
    const { content, date, relatedNodeId, startTime, endTime, duration } = req.body;
    const newLog = await prisma.workLog.create({
      data: {
        content,
        date: date ? new Date(date) : new Date(),
        relatedNodeId: relatedNodeId || null,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        duration: duration ? parseInt(duration) : null,
      }
    });
    res.json(newLog);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create log' });
  }
});

// Update Log
app.put('/api/logs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { content, date, relatedNodeId, startTime, endTime, duration } = req.body;
    const updatedLog = await prisma.workLog.update({
      where: { id },
      data: {
        content,
        date: date ? new Date(date) : undefined,
        relatedNodeId: relatedNodeId || null,
        startTime: startTime ? new Date(startTime) : undefined,
        endTime: endTime ? new Date(endTime) : undefined,
        duration: duration ? parseInt(duration) : undefined,
      }
    });
    res.json(updatedLog);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update log' });
  }
});

// Delete Log
app.delete('/api/logs/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.workLog.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Failed to delete log' }); }
});

// 3. 周报逻辑 (GET /api/reports/weekly)
app.get('/api/reports/weekly', async (req, res) => {
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);
    
    const completedTasks = await prisma.planNode.findMany({
      where: {
        level: { in: [5, 6] },
        actualEndDate: { gte: startDate, lte: endDate },
        outputContent: { not: null }
      },
      select: {
        title: true,
        outputContent: true,
        actualEndDate: true,
        priority: true,
        owner: true
      }
    });
    
    const recentLogs = await prisma.workLog.findMany({
        where: { date: { gte: startDate, lte: endDate } },
        include: { relatedNode: { select: { title: true } } }
    });

    res.json({
        range: { start: startDate, end: endDate },
        completedTasks,
        workLogs: recentLogs,
        summary: `本周完成 ${completedTasks.length} 个任务，产生 ${recentLogs.length} 条工作日志。`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate weekly report' });
  }
});

// 4. 节点更新 (PATCH /api/nodes/:id) - Supports progress recursion
app.patch('/api/nodes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    
    if (data.progress !== undefined) {
        const updatedNode = await prisma.planNode.update({
            where: { id },
            data: { progress: data.progress },
            include: { parent: true }
        });
        
        if (updatedNode.parentId) {
            await updateParentProgressRecursive(updatedNode.parentId);
        }
        res.json(updatedNode);
    } else {
        const updated = await prisma.planNode.update({ where: { id }, data });
        res.json(updated);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update node' });
  }
});

// --- Standard CRUD for PlanNodes ---

app.get('/api/nodes', async (req, res) => {
  try {
    const nodes = await prisma.planNode.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(nodes);
  } catch (error) { res.status(500).json({ error: 'Failed to fetch nodes' }); }
});

app.get('/api/nodes/layer/:layer', async (req, res) => {
  try {
    const layer = parseInt(req.params.layer);
    const nodes = await prisma.planNode.findMany({ where: { level: layer }, orderBy: { priority: 'asc' } });
    res.json(nodes);
  } catch (error) { res.status(500).json({ error: 'Failed to fetch layer nodes' }); }
});

app.get('/api/users', async (req, res) => {
  try {
    const targetUsers = [
      { email: 'fan@loveme.os', name: '樊云川' },
      { email: 'huang@loveme.os', name: '黄心怡' },
      { email: 'pending@loveme.os', name: '待分配' },
    ];
    for (const u of targetUsers) {
      const existing = await prisma.user.findFirst({ where: { name: u.name } });
      if (!existing) await prisma.user.create({ data: u });
    }
    const users = await prisma.user.findMany();
    res.json(users);
  } catch (error) { res.status(500).json({ error: 'Failed to fetch users' }); }
});

app.post('/api/nodes', async (req, res) => {
  try {
    const data = req.body;
    let rootId = null;
    let parentNode = null;

    if (data.parentId) {
      parentNode = await prisma.planNode.findUnique({ where: { id: data.parentId } });
      if (parentNode) {
        rootId = parentNode.rootId || parentNode.id;
      }
    }

    // --- 灵魂重构：认领与继承逻辑 ---
    // 如果有 parentId，自动继承 owner, priority, planStatus (如果未提供)
    const inheritedOwner = data.owner || (parentNode ? parentNode.owner : null);
    const inheritedPriority = data.priority || (parentNode ? parentNode.priority : 'P1');
    const inheritedPlanStatus = data.planStatus || (parentNode ? parentNode.planStatus : null);

    const newNode = await prisma.planNode.create({
      data: {
        title: data.title,
        description: data.description,
        parentId: data.parentId,
        level: data.level,
        owner: inheritedOwner,
        priority: inheritedPriority,
        planStatus: inheritedPlanStatus, // 继承状态
        periodType: data.periodType,
        outputContent: data.outputContent,
        plannedEndDate: data.plannedEndDate,
        rootId,
      }
    });

    if (!data.parentId && !rootId) {
       await prisma.planNode.update({ where: { id: newNode.id }, data: { rootId: newNode.id } });
       newNode.rootId = newNode.id;
    }
    res.json(newNode);
  } catch (error) { 
    console.error(error);
    res.status(500).json({ error: 'Failed to create node' }); 
  }
});

app.put('/api/nodes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    const updated = await prisma.planNode.update({ where: { id }, data });
    res.json(updated);
  } catch (error) { res.status(500).json({ error: 'Failed to update node' }); }
});

app.delete('/api/nodes/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.planNode.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: 'Failed to delete node' }); }
});

// --- Enterprise WeChat Integration ---

// 1. Manually Trigger Push (Push Report)
app.post('/api/wechat/push', async (req, res) => {
  try {
    // 默认推送本周周报
    const nodes = await getWeeklyReportNodes();
    
    // 使用新的周报生成引擎
    const markdown = generateWeeklyReportText(nodes);
    
    const success = await pushToWeChat(markdown);
    
    // 存档
    await savePushHistory(markdown, success ? 'SUCCESS' : 'FAILED', 'WECHAT');

    if (success) {
      res.json({ success: true, message: '已推送到企业微信' });
    } else {
      res.status(500).json({ success: false, message: '推送失败，请检查服务器日志' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to push message' });
  }
});

// 2. Receive Callback from WeChat Robot (Outgoing Webhook)
app.post('/api/wechat/callback', async (req, res) => {
  try {
    const content = req.body.text?.content || req.body.content || req.body.Content || '';
    console.log('📩 收到企业微信回调:', JSON.stringify(req.body));

    if (content.includes('进度') || content.includes('周报')) {
      const nodes = await prisma.planNode.findMany({ orderBy: { priority: 'asc' } });
      const markdown = generateWeeklyReportText(nodes);
      
      res.json({
        msgtype: 'markdown',
        markdown: { content: markdown }
      });
    } else {
      res.json({
        msgtype: 'text',
        text: { content: '🤖 我收到了你的消息。发送“周报”查看最新进度。' }
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process callback' });
  }
});

// 3. Push History
app.get('/api/push-history', async (req, res) => {
  try {
    const history = await getPushHistory();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// 4. Debug: Simulate Report (Testing Route)
app.get('/api/debug/simulate-report', async (req, res) => {
  try {
    // 构造模拟数据
    const dummyNodes: any[] = [
      {
        title: '气象服务AI化',
        plannedEndDate: '3月下旬',
        planStatus: '正常',
        outputContent: '完成API对接',
        description: '完成API对接',
        progress: 80,
        priority: 'P0',
        owner: '樊云川',
        level: 6,
        periodType: 'WEEK'
      },
      {
        title: 'Lovable 前端重构',
        plannedEndDate: '4月上旬',
        planStatus: '风险',
        outputContent: 'UI还原度需提升',
        description: 'UI还原度需提升',
        progress: 30,
        priority: 'P1',
        owner: '黄心怡',
        level: 6,
        periodType: 'WEEK'
      }
    ];

    const report = generateWeeklyReportText(dummyNodes);
    console.log('--- 模拟周报开始 ---');
    console.log(report);
    console.log('--- 模拟周报结束 ---');
    res.send(report);
  } catch (error) {
    console.error(error);
    res.status(500).send('Simulation Failed');
  }
});

app.get('/', (req, res) => {
  res.send('LoveMe OS API Running (Soul Refactored)');
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
