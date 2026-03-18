import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// DeepSeek API Configuration
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions'; // Adjust based on actual endpoint
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// OpenAI SDK Client (用于任务解析 & DeepSeek 兼容 API)
// 注意：
// - OPENAI_API_KEY：你的 DeepSeek/OpenAI Key
// - OPENAI_BASE_URL：DeepSeek 的兼容网关，如 https://api.deepseek.com/v1
// 这里使用 require 以兼容 CommonJS 构建配置。
// 为了在本地未配置 Key 时不阻塞整个服务，我们只在实际需要调用时再懒加载客户端。
// eslint-disable-next-line @typescript-eslint/no-var-requires
const OpenAI = require('openai');
type OpenAIClient = typeof import('openai');

function createOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing');
  }
  const client: InstanceType<OpenAIClient['OpenAI']> = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  });
  return client;
}

interface ScheduleInterpretation {
    date: string;       // YYYY-MM-DD
    startTime: string;  // HH:mm
    endTime: string;    // HH:mm
    title: string;      // Activity Title
    remark: string;     // Detailed Remark
    keywords: string[]; // Keywords for matching PlanNode
    category: string;   // '工作' | '生活' | '学习'
}

// -------- 任务解析：POST /api/parse-task 使用的类型 --------

export interface ParsedTaskResult {
  taskName: string;
  startTime: string;      // ISO 8601
  endTime: string;        // ISO 8601
  durationMinutes: number;
  suggestedNodeId: string | null; // 这里用 L1-L7 表示建议挂载层级
}

/**
 * 使用 OpenAI 将自然语言解析为结构化任务
 * - 支持「刚才 / 明天」等相对时间（相对 now 参数，默认当前时间 & 上海时区）
 * - 返回标准 JSON：taskName, startTime, endTime, durationMinutes, suggestedNodeId
 */
export async function parseTaskWithAI(text: string, now?: string): Promise<ParsedTaskResult> {
  const nowDate = now ? new Date(now) : new Date();
  const nowISO = nowDate.toISOString();

  // 无 OPENAI_API_KEY 时的兜底逻辑：简单 mock，保证接口可用
  if (!process.env.OPENAI_API_KEY) {
    const end = nowDate;
    const start = new Date(end.getTime() - 30 * 60 * 1000); // 默认 30 分钟
    return {
      taskName: text.slice(0, 20) || '未命名任务',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationMinutes: 30,
      suggestedNodeId: 'L6',
    };
  }

  const systemPrompt = `
你是一名「精力管理专家」，专门帮用户把自然语言工作记录，解析成结构化任务。

【时间规则】
1. 你收到的 now 字段是当前时间（ISO 字符串），默认为上海时区（Asia/Shanghai）。
2. 用户会说「刚才」「刚刚」「刚搞完」「一会儿」「明天早上」等相对时间。
3. 你需要将相对时间全部换算成绝对时间，返回 ISO 8601 字符串（例如 2026-03-14T09:30:00+08:00）。
4. 如果只说「刚才做完」，可以默认持续 30 分钟：endTime=now，startTime=now-30min。
5. 如果说「明天」「下周一」等，将日期偏移后，时间可以根据语境估计（如「早上」=09:00，「下午」=14:00，「晚上」=20:00）。

【任务字段】
请从用户输入中提取：
- taskName：任务名称，简短有力，<= 20 个汉字。
- startTime：任务开始时间（绝对时间，ISO 8601）。
- endTime：任务结束时间（绝对时间，ISO 8601），需 >= startTime。
- durationMinutes：预估时长，整数分钟。
- suggestedNodeId：建议挂载的 WBS 层级，用 "L1" ~ "L7" 表示：
  - L1/L2：高层战略或年度主题
  - L3：项目集/大项目
  - L4：模块/里程碑
  - L5：工作包（可交付物）
  - L6：具体活动（执行动作）
  - L7：日志/流水记录
一般个人日常的离散执行任务，默认推荐 L6。

【输出格式】
1. 严格输出 JSON 对象，不要包含任何多余文字。
2. 字段必须是：taskName, startTime, endTime, durationMinutes, suggestedNodeId。
  `.trim();

  const userContent = `
now: ${nowISO}
text: ${text}
`.trim();

  const client = createOpenAIClient();

  const completion = await client.chat.completions.create({
    model: 'deepseek-chat',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
  });

  const raw = completion.choices[0]?.message?.content || '{}';
  const jsonStr = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(jsonStr);

  return {
    taskName: parsed.taskName ?? (text.slice(0, 20) || '未命名任务'),
    startTime: parsed.startTime ?? nowISO,
    endTime: parsed.endTime ?? nowISO,
    durationMinutes: Number.isFinite(parsed.durationMinutes)
      ? Number(parsed.durationMinutes)
      : 30,
    suggestedNodeId: typeof parsed.suggestedNodeId === 'string' ? parsed.suggestedNodeId : 'L6',
  };
}

/**
 * Advanced Matching Algorithm
 * Find best matching PlanNodes based on keywords
 */
async function findBestMatch(keywords: string[]) {
    if (!keywords || keywords.length === 0) return [];

    // 1. Fetch Candidates (Broad Search)
    const candidates = await prisma.planNode.findMany({
        where: {
            OR: keywords.map(k => ({
                title: { contains: k }
            })),
            status: { not: 'CANCELLED' }
        },
        select: { 
            id: true, 
            title: true, 
            nodeNumber: true, 
            level: true, 
            priority: true, 
            periodType: true,
            status: true
        }
    });

    if (candidates.length === 0) return [];

    // 2. Scoring Logic
    const scoredCandidates = candidates.map(node => {
        let score = 0;
        
        // Base score: Keyword match count
        keywords.forEach(k => {
            if (node.title.includes(k)) score += 10;
        });

        // Priority 1: Execution Layer (-W) & Unfinished
        // Note: L7 is Week. Check nodeNumber or level.
        if (node.level === 7 || (node.nodeNumber && node.nodeNumber.includes('-W'))) {
            if (node.status !== 'COMPLETED') {
                score += 50; // Huge boost for active week tasks
            }
        }

        // Priority 2: High Priority (P0)
        if (node.priority === 'P0') {
            score *= 1.2; // +20%
        }

        // Priority 3: Month Node (L6)
        if (node.level === 6) {
            score *= 1.1; // +10%
        }

        return { ...node, score };
    });

    // 3. Sort & Slice
    scoredCandidates.sort((a, b) => b.score - a.score);
    return scoredCandidates.slice(0, 3);
}

/**
 * Interpret natural language schedule input using AI
 * @param text User input text (e.g. "下午2点和老王聊智能花盆")
 * @param dateContext Context date (YYYY-MM-DD), default to today
 */
export async function interpretSchedule(text: string, dateContext: string = new Date().toISOString().split('T')[0]): Promise<any> {
    // 1. Call AI to parse text
    let parsedData: ScheduleInterpretation;

    if (!DEEPSEEK_API_KEY) {
        console.warn('⚠️ DEEPSEEK_API_KEY not found. Using mock parser for demonstration.');
        parsedData = mockParse(text, dateContext);
    } else {
        try {
            parsedData = await callDeepSeekAPI(text, dateContext);
        } catch (error) {
            console.error('❌ AI API Call Failed:', error);
            parsedData = mockParse(text, dateContext); // Fallback to mock
        }
    }

    // 2. Task Matching (Advanced)
    const suggestions = await findBestMatch(parsedData.keywords);
    const topMatch = suggestions.length > 0 ? suggestions[0] : null;

    // 3. Construct Final Response
    return {
        ...parsedData,
        relatedPlanId: topMatch?.id || null,
        relatedPlanTitle: topMatch?.title || null,
        relatedPlanLevel: topMatch?.level || null,
        suggestions: suggestions, // Return top 3 suggestions
        isMatched: !!topMatch, 
        matchScore: topMatch?.score || 0,
        aiReasoning: topMatch 
            ? `Matched active week task "${topMatch.title}" (Score: ${topMatch.score})` 
            : 'No matching task found.'
    };
}

/**
 * Generate Daily Audit Report using DeepSeek
 * Compares Plan (MIT) vs Reality (Schedule)
 */
export async function generateDailyAudit(date: string) {
    // 1. Fetch Data
    const summary = await prisma.dailySummary.findUnique({ where: { date } });
    const nodes = await prisma.scheduleNode.findMany({
        where: { date },
        orderBy: { startTime: 'asc' },
        include: { relatedPlan: true }
    });

    if (!summary || nodes.length === 0) {
        return { error: 'No data available for audit.' };
    }

    // 2. Prepare Context for AI
    const mit = summary.mit || 'No specific MIT set.';
    const scheduleLog = nodes.map(n => {
        const planInfo = n.relatedPlan ? `[Linked: ${n.relatedPlan.title} ${n.relatedPlan.progress}%]` : '[Unplanned]';
        return `- ${n.startTime}-${n.endTime}: ${n.title} ${planInfo} (${n.category})`;
    }).join('\n');

    const prompt = `
You are the "Life OS Auditor" (生命操作系统审计员).
Date: ${date}

[Plan - Most Important Thing]
${mit}

[Reality - Actual Schedule]
${scheduleLog}

Your Task:
Audit the alignment between "Knowledge" (Plan) and "Action" (Reality).
Output a JSON report.

Rules:
1. highlights: 3 bullet points of what went well (completed MIT, high focus, etc.).
2. deviation: 1 major deviation or distraction (if any).
3. suggestion: 1 specific actionable suggestion for tomorrow.
4. score: Integer 0-100 (100 = Perfect Flow).

Output JSON only:
{
  "highlights": ["point 1", "point 2", "point 3"],
  "deviation": "string",
  "suggestion": "string",
  "score": 85
}
`;

    // 3. Call AI
    let auditResult;
    try {
        const response = await fetch(DEEPSEEK_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: 'You are a strict but encouraging daily auditor.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            throw new Error(`AI API Error: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
        auditResult = JSON.parse(jsonStr);

    } catch (e) {
        console.error('Audit Generation Failed:', e);
        // Fallback Mock
        auditResult = {
            highlights: ['Data captured successfully', 'Effort detected', 'System operational'],
            deviation: 'AI Service Unavailable',
            suggestion: 'Check API Key or connection.',
            score: 0
        };
    }

    // 4. Save to DB (Format as String for legacy compatibility)
    const formattedAudit = `
【知行合一审计】得分: ${auditResult.score}
✨ 亮点:
${auditResult.highlights.map((h: string) => `- ${h}`).join('\n')}

⚠️ 偏差:
${auditResult.deviation}

💡 建议:
${auditResult.suggestion}
    `.trim();

    await prisma.dailySummary.update({
        where: { date },
        data: {
            aiAudit: formattedAudit,
            score: auditResult.score
        }
    });

    return auditResult;
}

/**
 * Call DeepSeek API (OpenAI Compatible)
 */
async function callDeepSeekAPI(text: string, dateContext: string): Promise<ScheduleInterpretation> {
    const systemPrompt = `
You are the "Life OS Recorder" (生命操作系统书记官).
Your task is to parse user input into a structured schedule JSON.
Context Date: ${dateContext}.

Input: "${text}"

Rules:
1. date: Infer date (YYYY-MM-DD). If not specified, use ${dateContext}.
2. startTime/endTime: 24-hour format (HH:mm). If only duration is mentioned, calculate from now or logical start. If no time, assume current time.
3. title: Concise summary (max 10 chars).
4. remark: Original detail or elaborated description.
5. keywords: Extract 2-3 core keywords (nouns/verbs) for project matching.
6. category: Infer '工作' (Work), '生活' (Life), '学习' (Study).

Output JSON only:
{
  "date": "YYYY-MM-DD",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "title": "String",
  "remark": "String",
  "keywords": ["k1", "k2"],
  "category": "String"
}
`;

    const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: 'deepseek-chat', // or 'deepseek-v3'
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        })
    });

    if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Parse JSON from content (handle potential markdown blocks)
    const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
}

/**
 * Mock Parser for demonstration/fallback
 */
function mockParse(text: string, dateContext: string): ScheduleInterpretation {
    // Simple Regex Heuristics
    const timeRegex = /(\d{1,2})点/;
    const times = text.match(/(\d{1,2})点/g);
    
    let startTime = '14:00'; // Default to current or specific mock time
    let endTime = '16:00';

    if (times && times.length >= 1) {
        let startH = parseInt(times[0].replace('点', ''));
        // Logic: if input says "2点", context "下午", treat as 14:00
        if ((text.includes('下午') || text.includes('晚')) && startH < 12) startH += 12;
        startTime = `${startH.toString().padStart(2, '0')}:00`;
        
        if (times.length >= 2) {
            let endH = parseInt(times[1].replace('点', ''));
            if ((text.includes('下午') || text.includes('晚')) && endH < 12) endH += 12;
            endTime = `${endH.toString().padStart(2, '0')}:00`;
        } else {
            endTime = `${(startH + 1).toString().padStart(2, '0')}:00`;
        }
    } else {
        // Fallback: Current Time
        const now = new Date();
        const h = now.getHours().toString().padStart(2, '0');
        const m = now.getMinutes().toString().padStart(2, '0');
        startTime = `${h}:${m}`;
        endTime = `${(now.getHours() + 1).toString().padStart(2, '0')}:${m}`;
    }
    
    // Extract keywords (Mock logic for specific input)
    const keywords = [];
    if (text.includes('智能花盆')) keywords.push('智能花盆');
    if (text.includes('设计')) keywords.push('设计');
    if (text.includes('防水')) keywords.push('防水');
    if (text.includes('老王')) keywords.push('老王');

    return {
        date: dateContext,
        startTime,
        endTime,
        title: '花盆防水讨论', // Mock Summary
        remark: text,
        keywords,
        category: '工作'
    };
}
