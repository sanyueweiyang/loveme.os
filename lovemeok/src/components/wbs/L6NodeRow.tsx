import { useState } from "react";
import { APITreeNode, normalizeStatus } from "@/types/wbs";
import { useUpdateNodeProgress } from "@/hooks/use-wbs";
import { cn } from "@/lib/utils";
import { Check, Loader2, FileText } from "lucide-react";

interface L6NodeRowProps {
  node: APITreeNode;
  onViewLogs?: (nodeId: string, title: string) => void;
}

export function L6NodeRow({ node, onViewLogs }: L6NodeRowProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(Math.round(node.progress ?? 0)));
  const mutation = useUpdateNodeProgress();

  const status = normalizeStatus(node.status || (node.progress >= 100 ? "completed" : node.progress > 0 ? "on_track" : "not_started"));

  const handleSave = () => {
    const val = Math.min(100, Math.max(0, parseInt(inputValue, 10) || 0));
    mutation.mutate(
      { id: String(node.id), progress: val },
      { onSuccess: () => setEditing(false) }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setInputValue(String(Math.round(node.progress ?? 0)));
      setEditing(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors group">
      <div className={cn(
        "w-1.5 h-1.5 rounded-full shrink-0",
        status === "completed" ? "bg-status-on-track" :
        status === "at_risk" ? "bg-status-at-risk" :
        status === "behind" ? "bg-status-behind" :
        "bg-status-not-started"
      )} />
      <span className="flex-1 text-xs truncate text-foreground">{node.title}</span>

      {onViewLogs && (
        <button
          onClick={(e) => { e.stopPropagation(); onViewLogs(String(node.id), node.title); }}
          className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          title="查看日志"
        >
          <FileText className="w-3 h-3" />
        </button>
      )}

      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-12 h-6 text-xs text-center rounded border bg-background px-1 tabular-nums"
          />
          <span className="text-[10px] text-muted-foreground">%</span>
          <button
            onClick={handleSave}
            disabled={mutation.isPending}
            className="p-0.5 rounded hover:bg-muted"
          >
            {mutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            ) : (
              <Check className="w-3 h-3 text-status-on-track" />
            )}
          </button>
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className="text-xs tabular-nums text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors"
        >
          {Math.round(node.progress ?? 0)}%
        </button>
      )}
    </div>
  );
}
