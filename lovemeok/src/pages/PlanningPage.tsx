/**
 * PlanningPage — /planning
 * 战略 + 管理层（L1-L4），对应侧边栏「规划」入口。
 * 筛选状态从 FilterContext 读取，跨页面保持一致。
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { HierarchicalBoard } from "@/components/wbs/HierarchicalBoard";
import { AlignmentDashboard } from "@/components/wbs/AlignmentDashboard";
import { NlpTaskDialog } from "@/components/wbs/NlpTaskDialog";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { WBS_LAYERS } from "@/types/wbs";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// 规划层只显示 L1-L4（L5 有独立页面）
const PLANNING_LEVELS = WBS_LAYERS.filter(l => l.level >= 1 && l.level <= 4);

const LEVEL_TAB_COLORS: Record<number, string> = {
  1: "bg-wbs-l1",
  2: "bg-wbs-l2",
  3: "bg-wbs-l3",
  4: "bg-wbs-l4",
};

const PlanningPage = () => {
  const navigate = useNavigate();
  const [activeLevel, setActiveLevel] = useState(1);
  const [nlpOpen, setNlpOpen] = useState(false);
  const activeLayer = WBS_LAYERS.find(l => l.level === activeLevel);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar activeLevel={activeLevel} onLevelChange={setActiveLevel} />

        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <header className="h-11 flex items-center gap-3 border-b px-3 shrink-0 bg-background">
            <SidebarTrigger className="text-muted-foreground" />
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">规划</span>
              <span>/</span>
              <span>{activeLayer?.tierLabel}</span>
              <span>/</span>
              <span>{activeLayer?.label}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setNlpOpen(true)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
                  "bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                )}
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI 录入
              </button>
            </div>
          </header>

          {/* Level tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b bg-background/50 overflow-x-auto shrink-0">
            {PLANNING_LEVELS.map(layer => (
              <button
                key={layer.level}
                onClick={() => setActiveLevel(layer.level)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 whitespace-nowrap",
                  activeLevel === layer.level
                    ? cn("text-white shadow-sm", LEVEL_TAB_COLORS[layer.level])
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                <span className="font-bold">{layer.shortLabel}</span>
                <span>{layer.label}</span>
              </button>
            ))}
            {/* L5 跳转入口 */}
            <button
              onClick={() => navigate("/planning/l5")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 whitespace-nowrap text-muted-foreground hover:text-foreground hover:bg-muted border border-dashed border-muted-foreground/30"
            >
              <span className="font-bold">L5</span>
              <span>月度规划 →</span>
            </button>
          </div>

          {/* Board */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <HierarchicalBoard
              activeLevel={activeLevel}
            />
            {activeLevel === 4 && <AlignmentDashboard />}
          </div>
        </div>
      </div>

      <NlpTaskDialog open={nlpOpen} onOpenChange={setNlpOpen} onNodeHighlight={() => {}} />
      <DebugPanel />
    </SidebarProvider>
  );
};

export default PlanningPage;
