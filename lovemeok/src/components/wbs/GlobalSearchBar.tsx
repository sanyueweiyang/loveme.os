import { Search, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const CATEGORY_TABS: { key: string; label: string; color?: string }[] = [
  { key: "", label: "全部" },
  { key: "工作", label: "事业", color: "bg-cat-work" },
  { key: "生活", label: "生活", color: "bg-cat-life" },
  { key: "成长", label: "成长", color: "bg-cat-growth" },
];

interface GlobalSearchBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  showIncompleteOnly: boolean;
  onToggleIncomplete: (v: boolean) => void;
  activeCategory?: string;
  onCategoryChange?: (cat: string) => void;
  hideCategoryTabs?: boolean;
  /** Inline single-row mode for compact headers */
  compact?: boolean;
  className?: string;
}

export function GlobalSearchBar({
  searchQuery,
  onSearchChange,
  showIncompleteOnly,
  onToggleIncomplete,
  activeCategory = "",
  onCategoryChange,
  hideCategoryTabs = false,
  compact = false,
  className,
}: GlobalSearchBarProps) {
  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        {/* Inline search */}
        <div className="relative w-[160px] shrink-0">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索…"
            className={cn(
              "w-full h-[26px] pl-6 pr-5 rounded-md text-[11px]",
              "bg-transparent border border-transparent",
              "placeholder:text-muted-foreground/40",
              "hover:bg-muted/40 focus:bg-muted/50 focus:border-border/50 focus:outline-none",
              "transition-all duration-100",
            )}
          />
          {searchQuery && (
            <button onClick={() => onSearchChange("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>

        {/* Incomplete toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <Switch id="compact-incomplete" checked={showIncompleteOnly} onCheckedChange={onToggleIncomplete} className="scale-[0.6] origin-center" />
          <Label htmlFor="compact-incomplete" className="text-[10px] text-muted-foreground/70 cursor-pointer select-none whitespace-nowrap">未完成</Label>
        </div>

        {/* Category tabs inline */}
        {!hideCategoryTabs && onCategoryChange && (
          <>
            <div className="w-px h-3.5 bg-border/40 shrink-0" />
            <div className="flex items-center gap-0.5 shrink-0">
              {CATEGORY_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => onCategoryChange(tab.key)}
                  className={cn(
                    "px-2 py-[3px] rounded text-[10px] font-medium transition-all duration-100 flex items-center gap-1",
                    activeCategory === tab.key
                      ? "bg-foreground/8 text-foreground"
                      : "text-muted-foreground/60 hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  {tab.color && <span className={cn("w-1.5 h-1.5 rounded-full", tab.color, activeCategory !== tab.key && "opacity-30")} />}
                  {tab.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // Default two-row layout (kept for backward compat)
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索卡片标题、负责人…"
            className={cn(
              "w-full h-8 pl-9 pr-8 rounded-lg text-xs",
              "bg-muted/50 border border-border/50",
              "placeholder:text-muted-foreground/60",
              "focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/40",
              "transition-all duration-200",
            )}
          />
          {searchQuery && (
            <button onClick={() => onSearchChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Switch id="incomplete-only" checked={showIncompleteOnly} onCheckedChange={onToggleIncomplete} className="scale-75" />
          <Label htmlFor="incomplete-only" className="text-[11px] text-muted-foreground cursor-pointer whitespace-nowrap">只看未完成</Label>
        </div>
      </div>
      {!hideCategoryTabs && onCategoryChange && (
        <div className="flex items-center justify-center gap-1">
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => onCategoryChange(tab.key)}
              className={cn(
                "px-3 py-1 rounded-full text-[11px] font-medium transition-all duration-200 flex items-center gap-1.5",
                activeCategory === tab.key
                  ? "bg-primary/10 text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              {tab.color && <span className={cn("w-2 h-2 rounded-full shrink-0", tab.color, activeCategory !== tab.key && "opacity-50")} />}
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
