import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { HierarchicalBoard } from "@/components/wbs/HierarchicalBoard";
import { L4Board } from "@/components/wbs/L4Board";
import { L5Board } from "@/components/wbs/L5Board";
import { L6Board } from "@/components/wbs/L6Board";
import { NlpTaskDialog } from "@/components/wbs/NlpTaskDialog";
import { DebugPanel } from "@/components/debug/DebugPanel";
import { useState, useCallback } from "react";

const Index = () => {
  const [activeLevel, setActiveLevel] = useState(1);
  const [nlpOpen, setNlpOpen] = useState(false);
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);

  const handleNodeHighlight = useCallback((nodeId: string) => {
    setHighlightNodeId(nodeId);
    setTimeout(() => setHighlightNodeId(null), 4000);
  }, []);

  const renderBoard = () => {
    if (activeLevel === 4) return <L4Board onNlpOpen={() => setNlpOpen(true)} />;
    if (activeLevel === 5) return <L5Board onNlpOpen={() => setNlpOpen(true)} />;
    if (activeLevel === 6) return <L6Board onNlpOpen={() => setNlpOpen(true)} />;
    return <HierarchicalBoard activeLevel={activeLevel} onNlpOpen={() => setNlpOpen(true)} />;
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-muted/30">
        <AppSidebar activeLevel={activeLevel} onLevelChange={setActiveLevel} />
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex flex-col overflow-hidden">
          {renderBoard()}

          </div>
        </div>
      </div>

      <NlpTaskDialog open={nlpOpen} onOpenChange={setNlpOpen} onNodeHighlight={handleNodeHighlight} />
      <DebugPanel />
    </SidebarProvider>
  );
};

export default Index;
