import { ModuleStatus } from "@/types/wbs";
import { cn } from "@/lib/utils";

const statusConfig: Record<ModuleStatus, { label: string; dot: string; bg: string; text: string }> = {
  on_track: { label: "正常", dot: "bg-status-on-track", bg: "bg-status-on-track/10", text: "text-status-on-track" },
  at_risk: { label: "风险", dot: "bg-status-at-risk", bg: "bg-status-at-risk/10", text: "text-status-at-risk" },
  behind: { label: "落后", dot: "bg-status-behind", bg: "bg-status-behind/10", text: "text-status-behind" },
  completed: { label: "完成", dot: "bg-status-completed", bg: "bg-status-completed/10", text: "text-status-completed" },
  not_started: { label: "未开始", dot: "bg-status-not-started", bg: "bg-status-not-started/10", text: "text-status-not-started" },
};

export function StatusBadge({ status, className }: { status: ModuleStatus; className?: string }) {
  const config = statusConfig[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium", config.bg, config.text, className)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.dot)} />
      {config.label}
    </span>
  );
}
