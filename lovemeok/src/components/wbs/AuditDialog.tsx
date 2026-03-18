import { useAuditPreview } from "@/hooks/use-wbs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface AuditDialogProps {
  nodeId: string | null;
  nodeTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuditDialog({ nodeId, nodeTitle, open, onOpenChange }: AuditDialogProps) {
  const { data, isLoading, isError, error } = useAuditPreview(open ? nodeId : null);

  const brief = data?.preview?.brief || "";
  const hasRisk = /风险|延迟|delay|risk/i.test(brief);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ShieldAlert className="w-4 h-4 text-primary" />
            AI 审计报告 · {nodeTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2">
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在生成审计摘要…
            </div>
          )}

          {isError && (
            <div className="text-sm text-destructive py-4">
              审计接口调用失败: {(error as Error)?.message}
            </div>
          )}

          {!isLoading && !isError && brief && (
            <div className="space-y-3">
              {hasRisk && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-[hsl(var(--status-behind)/0.1)] border border-[hsl(var(--status-behind)/0.3)]">
                  <AlertTriangle className="w-4 h-4 text-[hsl(var(--status-behind))] mt-0.5 shrink-0" />
                  <span className="text-xs font-semibold text-[hsl(var(--status-behind))]">
                    检测到风险预警项
                  </span>
                </div>
              )}
              <div className={cn(
                "text-sm leading-relaxed whitespace-pre-wrap p-4 rounded-lg border",
                hasRisk
                  ? "bg-[hsl(var(--status-at-risk)/0.05)] border-[hsl(var(--status-at-risk)/0.2)]"
                  : "bg-muted/30 border-border"
              )}>
                {brief}
              </div>
            </div>
          )}

          {!isLoading && !isError && !brief && (
            <div className="text-sm text-muted-foreground py-4 text-center">暂无审计数据</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
