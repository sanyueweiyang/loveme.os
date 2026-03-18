import { useMemo } from "react";
import { useWBSTree, useNodeLogs } from "@/hooks/use-wbs";
import { extractL4Modules, APITreeNode } from "@/types/wbs";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "@/lib/utils";
import { AlertTriangle, Target, Clock } from "lucide-react";

const CHART_COLORS = [
  "hsl(245, 58%, 51%)",   // primary
  "hsl(200, 80%, 44%)",   // management
  "hsl(160, 60%, 40%)",   // execution
  "hsl(38, 92%, 50%)",    // at-risk
  "hsl(280, 60%, 50%)",   // purple
  "hsl(340, 65%, 50%)",   // rose
];

interface EffortEntry {
  name: string;
  value: number;
}

function flattenAll(nodes: APITreeNode[]): APITreeNode[] {
  const result: APITreeNode[] = [];
  function walk(n: APITreeNode) {
    result.push(n);
    if (n.children) n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

export function AlignmentDashboard() {
  const { data: tree } = useWBSTree();

  const { planned, actual, miscMinutes, totalActual } = useMemo(() => {
    if (!tree) return { planned: [], actual: [], miscMinutes: 0, totalActual: 0 };

    const l4Modules = extractL4Modules(tree);
    const allNodes = flattenAll(Array.isArray(tree) ? tree : [tree]);

    // Planned distribution: based on L4 module progress weights
    const plannedData: EffortEntry[] = l4Modules.map((m) => ({
      name: m.title,
      value: Math.max(m.progress, 5), // min 5 for visibility
    }));

    // Actual distribution: based on durationMinutes from all nodes
    const actualMap = new Map<string, number>();
    let misc = 0;
    let totalDuration = 0;

    for (const node of allNodes) {
      const dur = Number(node.durationMinutes || 0);
      if (dur <= 0) continue;
      totalDuration += dur;

      if (!node.parentId && node.level >= 6) {
        // No linked parent → misc
        misc += dur;
      } else {
        // Find L4 ancestor
        const l4 = findL4Ancestor(node, allNodes);
        if (l4) {
          const key = l4.title;
          actualMap.set(key, (actualMap.get(key) || 0) + dur);
        } else {
          misc += dur;
        }
      }
    }

    const actualData: EffortEntry[] = [];
    actualMap.forEach((value, name) => actualData.push({ name, value }));
    if (misc > 0) actualData.push({ name: "杂事（无关联）", value: misc });

    return { planned: plannedData, actual: actualData, miscMinutes: misc, totalActual: totalDuration };
  }, [tree]);

  const miscHours = miscMinutes / 60;
  const miscRate = totalActual > 0 ? Math.round((miscMinutes / totalActual) * 100) : 0;
  const isWarning = miscHours >= 3;

  // Alignment score: inverse of misc rate
  const score = totalActual > 0 ? Math.max(0, 100 - miscRate) : 100;

  return (
    <div className="border-t bg-card">
      <div className="px-6 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold">今日知行合一评分</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-2xl font-bold tabular-nums",
              score >= 80 ? "text-[hsl(var(--status-on-track))]" :
              score >= 50 ? "text-[hsl(var(--status-at-risk))]" :
              "text-destructive"
            )}>
              {score}
            </span>
            <span className="text-xs text-muted-foreground">/ 100</span>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-4">
          {/* Planned */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">
              计划投入分布（WBS）
            </div>
            <div className="h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={planned}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    strokeWidth={1}
                    stroke="hsl(var(--border))"
                  >
                    {planned.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Actual */}
          <div className="space-y-2">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">
              实际精力分布（durationMinutes）
            </div>
            <div className="h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={actual.length > 0 ? actual : [{ name: "暂无数据", value: 1 }]}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    strokeWidth={1}
                    stroke="hsl(var(--border))"
                  >
                    {(actual.length > 0 ? actual : [{ name: "暂无数据", value: 1 }]).map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.name === "杂事（无关联）"
                          ? "hsl(0, 72%, 51%)"
                          : entry.name === "暂无数据"
                          ? "hsl(var(--muted))"
                          : CHART_COLORS[i % CHART_COLORS.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                    }}
                    formatter={(value: number) => [`${value} 分钟`, ""]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
          {[...new Set([...planned.map(p => p.name), ...actual.map(a => a.name)])].slice(0, 6).map((name, i) => (
            <div key={name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{
                  backgroundColor: name === "杂事（无关联）"
                    ? "hsl(0, 72%, 51%)"
                    : CHART_COLORS[i % CHART_COLORS.length]
                }}
              />
              <span className="truncate max-w-[80px]">{name}</span>
            </div>
          ))}
        </div>

        {/* Warning / Suggestion */}
        {isWarning ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-destructive/8 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive font-medium leading-relaxed">
              樊老师，今日杂事率 {miscRate}%，偏离主航道，请注意精力回收。
            </p>
          </div>
        ) : totalActual > 0 ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[hsl(var(--status-on-track)/0.08)] border border-[hsl(var(--status-on-track)/0.2)]">
            <Clock className="w-4 h-4 text-[hsl(var(--status-on-track))] shrink-0 mt-0.5" />
            <p className="text-sm text-[hsl(var(--status-on-track))] font-medium">
              今日精力聚焦度良好，杂事率 {miscRate}%，继续保持！
            </p>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-1">
            暂无今日精力数据
          </div>
        )}
      </div>
    </div>
  );
}

function findL4Ancestor(node: APITreeNode, allNodes: APITreeNode[]): APITreeNode | undefined {
  if (node.level === 4) return node;
  if (!node.parentId) return undefined;
  const parent = allNodes.find(n => String(n.id) === String(node.parentId));
  if (!parent) return undefined;
  return findL4Ancestor(parent, allNodes);
}
