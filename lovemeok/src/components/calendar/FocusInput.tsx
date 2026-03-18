import { useState, useEffect } from "react";
import { Star } from "lucide-react";

interface FocusInputProps {
  value: string;
  onChange: (val: string) => void;
  compact?: boolean;
}

export function FocusInput({ value, onChange, compact }: FocusInputProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onChange(draft);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1 min-w-0">
        <Star className="w-3 h-3 text-amber-500 shrink-0" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          placeholder="最重要的事…"
          className="text-[11px] bg-transparent border-none outline-none w-full truncate text-foreground placeholder:text-muted-foreground/50"
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-300/40 bg-amber-50/50 dark:bg-amber-950/20 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Star className="w-4 h-4 text-amber-500" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
          今日最重要的一件事
        </span>
      </div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder="写下今天最重要的事..."
        className="w-full text-sm bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground/60"
      />
    </div>
  );
}
