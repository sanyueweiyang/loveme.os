import { useState, useRef, useCallback } from "react";
import { formatDateKey, TimeBlock, BlockCategory, CATEGORY_COLORS, CATEGORY_LABELS } from "./types";
import { FocusInput } from "./FocusInput";
import { cn } from "@/lib/utils";
import { Trash2, X } from "lucide-react";

/** 48 half-hour slots: 09:00(0) → 08:30(47), continuous 24h axis */
const TOTAL_SLOTS = 48;

function slotToHour(slot: number): number {
  return (9 + Math.floor(slot / 2)) % 24;
}

function slotToLabel(slot: number): string {
  const h = slotToHour(slot);
  const m = slot % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
}

/** Background zone by hour: 09-18 work, 18-23 life, 23-09 sleep */
function slotZoneClass(slot: number): string {
  const h = slotToHour(slot);
  if (h >= 9 && h < 18) return "bg-[hsl(var(--cal-work)/0.06)]";
  if (h >= 18 && h < 23) return "bg-[hsl(var(--cal-life)/0.06)]";
  return "bg-muted/30";
}

interface DayViewProps {
  date: Date;
  blocks: TimeBlock[];
  focus: string;
  onFocusChange: (text: string) => void;
  onAddBlock: (block: TimeBlock) => void;
  onRemoveBlock: (id: string) => void;
}

interface CreatePopoverProps {
  startSlot: number;
  endSlot: number;
  category: BlockCategory;
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

function CreatePopover({ startSlot, endSlot, category, onConfirm, onCancel }: CreatePopoverProps) {
  const [title, setTitle] = useState("");

  const handleConfirm = () => {
    if (title.trim()) onConfirm(title.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onCancel}>
      <div
        className="bg-background border border-border rounded-xl shadow-xl p-4 w-72"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold">
            {slotToLabel(startSlot)} – {slotToLabel(endSlot)}
          </span>
          <button onClick={onCancel} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") handleConfirm(); if (e.key === "Escape") onCancel(); }}
          placeholder="事项名称…"
          className="w-full px-2.5 py-1.5 rounded-lg text-sm bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-primary/30 mb-3"
        />
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-1.5 rounded-lg text-xs border hover:bg-muted transition-colors">取消</button>
          <button
            onClick={handleConfirm}
            disabled={!title.trim()}
            className="flex-1 py-1.5 rounded-lg text-xs bg-primary text-primary-foreground disabled:opacity-40 transition-colors"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export function DayView({ date, blocks, focus, onFocusChange, onAddBlock, onRemoveBlock }: DayViewProps) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  const [category, setCategory] = useState<BlockCategory>("WORK");
  const [pendingSlots, setPendingSlots] = useState<{ s: number; e: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dateKey = formatDateKey(date);

  const handleMouseDown = (slot: number) => { setDragStart(slot); setDragEnd(slot); };
  const handleMouseEnter = (slot: number) => { if (dragStart !== null) setDragEnd(slot); };

  const handleMouseUp = useCallback(() => {
    if (dragStart !== null && dragEnd !== null) {
      const s = Math.min(dragStart, dragEnd);
      const e = Math.max(dragStart, dragEnd) + 1;
      setPendingSlots({ s, e });
    }
    setDragStart(null);
    setDragEnd(null);
  }, [dragStart, dragEnd]);

  const handleConfirmCreate = (title: string) => {
    if (!pendingSlots) return;
    onAddBlock({
      id: crypto.randomUUID(),
      title,
      category,
      startSlot: pendingSlots.s,
      endSlot: pendingSlots.e,
      date: dateKey,
    });
    setPendingSlots(null);
  };

  const isDragging = dragStart !== null && dragEnd !== null;
  const selStart = isDragging ? Math.min(dragStart!, dragEnd!) : -1;
  const selEnd = isDragging ? Math.max(dragStart!, dragEnd!) : -1;

  const SLOT_H = 28;

  return (
    <div className="flex flex-col gap-3 h-full">
      <FocusInput value={focus} onChange={onFocusChange} />

      {/* Category selector */}
      <div className="flex items-center gap-2">
        {(["WORK", "LIFE", "GROWTH"] as BlockCategory[]).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-full transition-all",
              category === cat
                ? cn(CATEGORY_COLORS[cat], "text-white shadow-sm")
                : "bg-muted text-muted-foreground hover:bg-accent"
            )}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Continuous 24h timeline */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto select-none"
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { setDragStart(null); setDragEnd(null); }}
      >
        <div className="relative">
          {Array.from({ length: TOTAL_SLOTS }, (_, slot) => {
            const isHour = slot % 2 === 0;
            const inSelection = isDragging && slot >= selStart && slot <= selEnd;
            const blockHere = blocks.find((b) => slot >= b.startSlot && slot < b.endSlot);
            const h = slotToHour(slot);

            const showZoneLabel = slot === 0 || (isHour && (h === 18 || h === 23));
            const zoneLabels: Record<number, string> = { 9: "🟣 工作时段", 18: "🩷 生活时段", 23: "⬜ 深夜/清晨" };

            return (
              <div key={slot}>
                {showZoneLabel && (
                  <div className="px-16 py-1">
                    <span className="text-[9px] font-medium text-muted-foreground/70">
                      {slot === 0 ? "🟣 工作时段" : zoneLabels[h] || ""}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    "flex items-stretch border-b border-border/30 transition-colors cursor-crosshair",
                    slotZoneClass(slot),
                    inSelection && cn(CATEGORY_COLORS[category], "opacity-30")
                  )}
                  style={{ height: SLOT_H }}
                  onMouseDown={() => handleMouseDown(slot)}
                  onMouseEnter={() => handleMouseEnter(slot)}
                >
                  <div className="w-14 shrink-0 flex items-start justify-end pr-2 pt-0.5">
                    {isHour && <span className="text-[10px] text-muted-foreground">{slotToLabel(slot)}</span>}
                  </div>
                  <div className="flex-1 relative min-h-0">
                    {blockHere && slot === blockHere.startSlot && (
                      <div
                        className={cn(
                          "absolute inset-x-0 z-10 rounded px-2 py-0.5 flex items-center justify-between group",
                          CATEGORY_COLORS[blockHere.category], "text-white text-[11px]"
                        )}
                        style={{ height: `${(blockHere.endSlot - blockHere.startSlot) * SLOT_H}px` }}
                      >
                        <span className="truncate">{blockHere.title}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemoveBlock(blockHere.id); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {pendingSlots && (
        <CreatePopover
          startSlot={pendingSlots.s}
          endSlot={pendingSlots.e}
          category={category}
          onConfirm={handleConfirmCreate}
          onCancel={() => setPendingSlots(null)}
        />
      )}
    </div>
  );
}
