/**
 * useCalendarState — 日历状态管理
 *
 * 持久化策略：
 * - TimeBlock → POST/DELETE /api/daily-schedules（后端未实现时降级内存）
 * - DailyFocus → PATCH /api/daily-schedules/top-task（后端未实现时降级内存）
 */
import { useState, useCallback } from "react";
import { CalendarView, TimeBlock, DailyFocus, formatDateKey, slotToTime } from "./types";
import { apiFetch } from "@/lib/api";

export function useCalendarState() {
  const [view, setView] = useState<CalendarView>("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  // 内存缓存（后端未实现时的降级存储）
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [focuses, setFocuses] = useState<DailyFocus[]>([]);

  const dateKey = formatDateKey(currentDate);

  // ── TimeBlock 操作 ──────────────────────────────────────────────────────────

  const addBlock = useCallback(async (block: TimeBlock) => {
    // 先乐观更新 UI
    setBlocks((prev) => [...prev, block]);

    // 尝试持久化到后端
    try {
      const startTime = slotToTime(block.startSlot);
      const endTime   = slotToTime(block.endSlot);
      await apiFetch("/api/daily-schedules", {
        method: "POST",
        body: JSON.stringify({
          date: block.date,
          startTime,
          endTime,
          title: block.title,
          category: block.category,
          isDone: false,
        }),
      });
    } catch (e) {
      // 后端未实现时静默降级，保留内存状态
      console.warn("[calendar] daily-schedules 接口不可用，使用内存存储:", e);
    }
  }, []);

  const removeBlock = useCallback(async (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));

    // 尝试从后端删除（id 可能是 UUID 或数字字符串）
    try {
      await apiFetch(`/api/daily-schedules/${id}`, { method: "DELETE" });
    } catch (e) {
      console.warn("[calendar] 删除日程失败（降级）:", e);
    }
  }, []);

  // ── DailyFocus 操作 ─────────────────────────────────────────────────────────

  const updateFocus = useCallback(async (date: string, text: string) => {
    setFocuses((prev) => {
      const existing = prev.findIndex((f) => f.date === date);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { date, text };
        return next;
      }
      return [...prev, { date, text }];
    });

    // 尝试持久化
    try {
      await apiFetch("/api/daily-schedules/top-task", {
        method: "PATCH",
        body: JSON.stringify({ date, topTask: text }),
      });
    } catch (e) {
      console.warn("[calendar] top-task 接口不可用，使用内存存储:", e);
    }
  }, []);

  const getFocus = useCallback(
    (date: string) => focuses.find((f) => f.date === date)?.text || "",
    [focuses]
  );

  const getBlocksForDate = useCallback(
    (date: string) => blocks.filter((b) => b.date === date),
    [blocks]
  );

  return {
    view,
    setView,
    currentDate,
    setCurrentDate,
    dateKey,
    blocks,
    addBlock,
    removeBlock,
    focuses,
    updateFocus,
    getFocus,
    getBlocksForDate,
  };
}
