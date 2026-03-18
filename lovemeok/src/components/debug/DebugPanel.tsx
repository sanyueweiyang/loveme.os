import { useState, useSyncExternalStore } from "react";
import { subscribeDebugLogs, clearDebugLogs, DebugLogEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ChevronUp, ChevronDown, Trash2, Terminal } from "lucide-react";

function useDebugLogs() {
  return useSyncExternalStore(
    subscribeDebugLogs,
    () => {
      // We need a stable reference trick
      let current: DebugLogEntry[] = [];
      subscribeDebugLogs((logs) => { current = logs; })();
      return current;
    }
  );
}

// Simple external store for logs
let _currentLogs: DebugLogEntry[] = [];
const _subs = new Set<() => void>();

subscribeDebugLogs((logs) => {
  _currentLogs = logs;
  _subs.forEach((fn) => fn());
});

function useLogs() {
  return useSyncExternalStore(
    (cb) => { _subs.add(cb); return () => _subs.delete(cb); },
    () => _currentLogs
  );
}

export function DebugPanel() {
  const logs = useLogs();
  const [expanded, setExpanded] = useState(false);

  const pendingCount = logs.filter((l) => l.status === "pending").length;
  const errorCount = logs.filter((l) => l.status === "error").length;

  return (
    <div className={cn(
      "fixed bottom-0 left-0 right-0 z-50 border-t bg-card shadow-lg transition-all",
      expanded ? "h-64" : "h-8"
    )}>
      {/* Bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full h-8 flex items-center gap-2 px-3 text-xs font-mono hover:bg-muted/50 transition-colors"
      >
        <Terminal className="w-3 h-3 text-muted-foreground" />
        <span className="font-semibold text-muted-foreground">调试日志</span>
        <span className="text-muted-foreground">({logs.length})</span>
        {pendingCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-status-at-risk/10 text-status-at-risk text-[10px] font-medium">
            {pendingCount} pending
          </span>
        )}
        {errorCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-status-behind/10 text-status-behind text-[10px] font-medium">
            {errorCount} errors
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {expanded && (
            <span
              onClick={(e) => { e.stopPropagation(); clearDebugLogs(); }}
              className="p-1 rounded hover:bg-muted"
            >
              <Trash2 className="w-3 h-3 text-muted-foreground" />
            </span>
          )}
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </div>
      </button>

      {/* Log entries */}
      {expanded && (
        <div className="h-[calc(100%-2rem)] overflow-auto px-3 py-1 font-mono text-[11px] space-y-0.5">
          {logs.length === 0 && (
            <div className="text-muted-foreground py-4 text-center">暂无请求记录</div>
          )}
          {logs.map((log) => (
            <div key={log.id} className="flex items-center gap-2 py-0.5">
              <span className="text-muted-foreground w-16 shrink-0">{log.timestamp}</span>
              <span className={cn(
                "w-12 shrink-0 font-semibold",
                log.method === "GET" ? "text-wbs-management" : "text-wbs-strategy"
              )}>
                {log.method}
              </span>
              <span className="flex-1 truncate text-foreground">{log.path}</span>
              <span className={cn(
                "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium",
                log.status === "pending" && "bg-status-at-risk/10 text-status-at-risk",
                log.status === "success" && "bg-status-on-track/10 text-status-on-track",
                log.status === "error" && "bg-status-behind/10 text-status-behind",
              )}>
                {log.status === "pending" ? "⏳" : log.statusCode || "ERR"}
              </span>
              {log.duration !== undefined && (
                <span className="text-muted-foreground w-14 text-right shrink-0">{log.duration}ms</span>
              )}
              {log.error && (
                <span className="text-status-behind truncate max-w-[200px]" title={log.error}>
                  {log.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
