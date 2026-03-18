import { useNodeLogs } from "@/hooks/use-wbs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileText, Loader2 } from "lucide-react";

interface LogsDialogProps {
  nodeId: string | null;
  nodeTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogsDialog({ nodeId, nodeTitle, open, onOpenChange }: LogsDialogProps) {
  const { data: logs, isLoading, isError, error } = useNodeLogs(open ? nodeId : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[70vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileText className="w-4 h-4 text-wbs-execution" />
            工作日志 · {nodeTitle}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载日志…
            </div>
          )}

          {isError && (
            <div className="text-sm text-destructive py-4">
              日志加载失败: {(error as Error)?.message}
            </div>
          )}

          {!isLoading && !isError && logs && logs.length === 0 && (
            <div className="text-sm text-muted-foreground py-4 text-center">暂无日志记录</div>
          )}

          {!isLoading && !isError && logs && logs.length > 0 && (
            <div className="space-y-2">
              {logs.map((log, i) => (
                <div key={log.id ?? i} className="p-3 rounded-lg border bg-muted/30 space-y-1">
                  {log.createdAt && (
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString("zh-CN")}
                    </div>
                  )}
                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                    {log.content || JSON.stringify(log, null, 2)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
