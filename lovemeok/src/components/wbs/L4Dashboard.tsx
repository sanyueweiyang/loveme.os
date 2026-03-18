import { L4ModuleCard } from "./L4ModuleCard";
import { L6NodeRow } from "./L6NodeRow";
import { AuditDialog } from "./AuditDialog";
import { LogsDialog } from "./LogsDialog";
import { ModuleStatus, extractL4Modules, APITreeNode } from "@/types/wbs";
import { useWBSTree, useAuditPreview } from "@/hooks/use-wbs";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";

const statusFilters: { value: ModuleStatus | "all"; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "on_track", label: "正常" },
  { value: "at_risk", label: "风险" },
  { value: "behind", label: "落后" },
  { value: "completed", label: "完成" },
  { value: "not_started", label: "未开始" },
];

export function L4Dashboard({ highlightNodeId }: { highlightNodeId?: string | null }) {
  const { data: tree, isLoading, isError, error, refetch } = useWBSTree();
  const [filter, setFilter] = useState<ModuleStatus | "all">("all");
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);

  // Audit dialog state
  const [auditTarget, setAuditTarget] = useState<{ id: string; title: string } | null>(null);
  // Track which modules have been audited and their warning level
  const [auditWarnings, setAuditWarnings] = useState<Record<string, "warn" | "danger">>({});

  // Logs dialog state
  const [logsTarget, setLogsTarget] = useState<{ id: string; title: string } | null>(null);

  // Prefetch audit for warning detection on expanded modules
  const auditQuery = useAuditPreview(auditTarget?.id ?? null);

  // When audit data comes back, check for risk keywords
  useMemo(() => {
    if (auditTarget && auditQuery.data?.preview?.brief) {
      const brief = auditQuery.data.preview.brief;
      const hasDanger = /风险|risk/i.test(brief);
      const hasDelay = /延迟|delay/i.test(brief);
      if (hasDanger || hasDelay) {
        setAuditWarnings((prev) => ({
          ...prev,
          [auditTarget.id]: hasDanger ? "danger" : "warn",
        }));
      }
    }
  }, [auditTarget?.id, auditQuery.data]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          正在加载 WBS 数据...
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-status-behind mx-auto" />
          <div className="text-sm text-muted-foreground">无法连接后端</div>
          <div className="text-xs text-muted-foreground/60 max-w-sm">{(error as Error)?.message}</div>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium"
          >
            <RefreshCw className="w-3 h-3" />
            重试
          </button>
        </div>
      </div>
    );
  }

  const l4Modules = tree ? extractL4Modules(tree) : [];

  const filtered = filter === "all"
    ? l4Modules
    : l4Modules.filter((m) => m.status === filter);

  const grouped = filtered.reduce<Record<string, typeof l4Modules>>((acc, m) => {
    const key = m.alignedL1Goal;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  const totalProgress = l4Modules.length > 0
    ? Math.round(l4Modules.reduce((s, m) => s + m.progress, 0) / l4Modules.length)
    : 0;
  const atRiskCount = l4Modules.filter((m) => m.status === "at_risk" || m.status === "behind").length;

  function getL6ChildrenOfModule(moduleId: string): APITreeNode[] {
    if (!tree) return [];
    const result: APITreeNode[] = [];

    function findNode(nodes: APITreeNode[]): APITreeNode | undefined {
      for (const n of nodes) {
        if (String(n.id) === moduleId) return n;
        if (n.children) {
          const found = findNode(n.children);
          if (found) return found;
        }
      }
      return undefined;
    }

    function collectL6(node: APITreeNode) {
      if (node.level === 6) { result.push(node); return; }
      if (node.children) { for (const child of node.children) collectL6(child); }
    }

    const roots = Array.isArray(tree) ? tree : [tree];
    const moduleNode = findNode(roots);
    if (moduleNode) collectL6(moduleNode);
    return result;
  }

  return (
    <div className="flex-1 overflow-auto pb-10">
      {/* Header — compact single row */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-1.5">
        <div className="flex items-center gap-2 min-h-[32px]">
          <h1 className="text-[13px] font-semibold shrink-0">模块看板</h1>

          <div className="w-px h-3.5 bg-border/40 shrink-0" />

          {/* Status filter pills */}
          <div className="flex items-center gap-0.5 shrink-0">
            {statusFilters.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "px-2 py-[3px] rounded text-[10px] font-medium transition-all duration-100",
                  filter === f.value
                    ? "bg-foreground/8 text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Stats inline */}
          <div className="flex items-center gap-3 text-[11px] tabular-nums shrink-0">
            <span className="text-muted-foreground"><span className="font-semibold text-foreground">{totalProgress}%</span> 进度</span>
            <span className="text-muted-foreground"><span className="font-semibold text-foreground">{l4Modules.length}</span> 模块</span>
            {atRiskCount > 0 && <span className="text-[hsl(var(--status-at-risk))]"><span className="font-semibold">{atRiskCount}</span> 风险</span>}
          </div>

          <button onClick={() => refetch()} className="p-1 rounded hover:bg-muted/60 text-muted-foreground/50 hover:text-foreground shrink-0" title="刷新">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Grouped Content */}
      <div className="p-6 space-y-8">
        {Object.entries(grouped).map(([goal, modules]) => (
          <section key={goal}>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1 h-3.5 rounded-full bg-[hsl(var(--wbs-l1))]" />
              <h2 className="text-[11px] font-semibold text-muted-foreground">{goal}</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {modules.map((m) => (
                <div key={m.id} className="space-y-0">
                  <L4ModuleCard
                    module={m}
                    onClick={() => setExpandedModuleId(expandedModuleId === m.id ? null : m.id)}
                    isExpanded={expandedModuleId === m.id}
                    onAudit={() => setAuditTarget({ id: m.id, title: m.title })}
                    warning={auditWarnings[m.id] || "none"}
                    isHighlighted={highlightNodeId === m.id}
                  />
                  {expandedModuleId === m.id && (
                    <div className="border border-t-0 rounded-b-lg bg-muted/30 p-3 space-y-1">
                      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        L6 执行活动
                      </div>
                      {getL6ChildrenOfModule(m.id).length === 0 ? (
                        <div className="text-xs text-muted-foreground py-2 text-center">暂无 L6 活动</div>
                      ) : (
                        getL6ChildrenOfModule(m.id).map((l6) => (
                          <L6NodeRow
                            key={l6.id}
                            node={l6}
                            onViewLogs={(id, title) => setLogsTarget({ id, title })}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            没有匹配的模块
          </div>
        )}
      </div>

      {/* Audit Dialog */}
      <AuditDialog
        nodeId={auditTarget?.id ?? null}
        nodeTitle={auditTarget?.title ?? ""}
        open={!!auditTarget}
        onOpenChange={(open) => { if (!open) setAuditTarget(null); }}
      />

      {/* Logs Dialog */}
      <LogsDialog
        nodeId={logsTarget?.id ?? null}
        nodeTitle={logsTarget?.title ?? ""}
        open={!!logsTarget}
        onOpenChange={(open) => { if (!open) setLogsTarget(null); }}
      />
    </div>
  );
}
