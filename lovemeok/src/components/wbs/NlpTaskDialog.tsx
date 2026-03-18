import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Sparkles,
  Check,
  RotateCcw,
  Clock,
  MapPin,
  FileText,
  Send,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ParsedTask {
  taskName?: string;
  duration?: string | number;
  startTime?: string;
  l6?: string;
  l6Title?: string;
  businessDate?: string;
  priority?: string;
  owner?: string;
  effortType?: "planned" | "unplanned" | string;
  [key: string]: any;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNodeHighlight?: (nodeId: string) => void;
}

export function NlpTaskDialog({ open, onOpenChange, onNodeHighlight }: Props) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [parsed, setParsed] = useState<ParsedTask | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Step 1: parse via POST /api/parse-task
  async function handleParse() {
    if (!input.trim()) return;
    setIsParsing(true);
    setParsed(null);
    try {
      const result = await apiFetch<ParsedTask>("/api/parse-task", {
        method: "POST",
        body: JSON.stringify({ content: input }),
      });
      setParsed(result);
    } catch (err: any) {
      toast.error("语义解析失败", { description: err.message });
    } finally {
      setIsParsing(false);
    }
  }

  // Step 2: confirm & save via POST /api/save-task
  async function handleConfirm() {
    if (!parsed) return;
    setIsSubmitting(true);
    try {
      await apiFetch("/api/save-task", {
        method: "POST",
        body: JSON.stringify({ ...parsed, rawInput: input }),
      });

      setShowSuccess(true);
      queryClient.invalidateQueries({ queryKey: ["wbs-tree"] });

      const highlightId = parsed.l6 || "";
      setTimeout(() => {
        setShowSuccess(false);
        handleReset();
        onOpenChange(false);
        if (highlightId && onNodeHighlight) {
          onNodeHighlight(highlightId);
        }
      }, 1200);
    } catch (err: any) {
      toast.error("入库失败", { description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setInput("");
    setParsed(null);
    setShowSuccess(false);
  }

  // Handle Enter to send on mobile
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !parsed) {
      e.preventDefault();
      handleParse();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90dvh] overflow-y-auto p-4 sm:p-6 gap-0">
        {/* Success overlay */}
        {showSuccess && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg animate-fade-in">
            <div className="flex flex-col items-center gap-3 animate-scale-in">
              <div className="w-16 h-16 rounded-full bg-[hsl(var(--status-on-track))] flex items-center justify-center shadow-lg shadow-[hsl(var(--status-on-track)/0.3)]">
                <Check className="w-8 h-8 text-white" strokeWidth={3} />
              </div>
              <span className="text-sm font-semibold tracking-wide">已入库 ✓</span>
            </div>
          </div>
        )}

        <DialogHeader className="pb-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
            </div>
            语义录入
          </DialogTitle>
          <DialogDescription className="text-xs">
            输入一段话，AI 自动解析任务并关联节点
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Input area with send button */}
          <div className="relative">
            <Textarea
              placeholder="刚才做了什么？"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[80px] pr-12 text-sm resize-none rounded-xl border-border/60 focus:border-primary/40"
              disabled={isParsing || isSubmitting || !!parsed}
            />
            {!parsed && (
              <Button
                size="icon"
                onClick={handleParse}
                disabled={!input.trim() || isParsing}
                className="absolute bottom-2 right-2 h-8 w-8 rounded-lg shadow-sm"
              >
                {isParsing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
          </div>

          {/* Parsing shimmer */}
          {isParsing && (
            <div className="space-y-2 animate-pulse">
              <div className="h-3 bg-muted rounded-full w-3/4" />
              <div className="h-3 bg-muted rounded-full w-1/2" />
              <div className="h-3 bg-muted rounded-full w-2/3" />
            </div>
          )}

          {/* Parsed result — confirmation card */}
          {parsed && !isParsing && (
            <div className="animate-fade-in space-y-3">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                解析结果
              </div>

              <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
                {/* Task name header */}
                <div className="px-4 py-3 border-b bg-muted/30">
                  <div className="flex items-start gap-2.5">
                    <FileText className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm leading-snug">
                        {parsed.taskName || "未识别任务名"}
                      </div>
                      {parsed.owner && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          👤 {parsed.owner}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 divide-x divide-border">
                  {/* Start time */}
                  <div className="px-4 py-3 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-[10px] text-muted-foreground">预计开始</div>
                      <div className="text-sm font-medium tabular-nums">
                        {parsed.startTime || "—"}
                      </div>
                    </div>
                  </div>

                  {/* Duration */}
                  <div className="px-4 py-3 flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div>
                      <div className="text-[10px] text-muted-foreground">预计时长</div>
                      <div className="text-sm font-medium tabular-nums">
                        {parsed.duration || "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* L6 node row */}
                <div className="px-4 py-3 border-t flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground">挂载节点</div>
                    <div className="text-sm font-medium truncate">
                      {parsed.l6Title || parsed.l6 || "—"}
                    </div>
                  </div>
                </div>

                {/* Badges: effort type, date, priority */}
                <div className="px-4 py-2.5 border-t flex flex-wrap gap-1.5">
                  {/* Effort type tag */}
                  <Badge
                    variant={parsed.effortType === "unplanned" ? "destructive" : "secondary"}
                    className="text-[10px] gap-1"
                  >
                    {parsed.effortType === "unplanned" ? "⚡ 计划外" : "📋 计划内"}
                  </Badge>

                  {parsed.businessDate && (
                    <Badge variant="secondary" className="text-[10px] gap-1">
                      📅 {parsed.businessDate}
                    </Badge>
                  )}
                  {parsed.priority && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        parsed.priority === "high" && "text-destructive border-destructive/30",
                        parsed.priority === "medium" && "text-[hsl(var(--status-at-risk))] border-[hsl(var(--status-at-risk)/0.3)]",
                      )}
                    >
                      {parsed.priority === "high" ? "🔴 高优" : parsed.priority === "medium" ? "🟡 中" : "⚪ 低"}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={isSubmitting}
                  className="gap-1.5 text-muted-foreground"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  重来
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={isSubmitting}
                  size="sm"
                  className="flex-1 gap-1.5 rounded-lg h-9 shadow-sm"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {isSubmitting ? "入库中…" : "准 · 确认录入"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
