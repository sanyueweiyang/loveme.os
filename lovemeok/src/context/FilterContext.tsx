/**
 * FilterContext — 全局筛选状态
 *
 * 跨页面保持「年份」和「维度」筛选器状态一致。
 * 在 App.tsx 顶层注入，所有页面通过 useFilter() 读写。
 */

import { createContext, useContext, useState, type ReactNode } from "react";
import type { PlanCategory } from "@/types/plan-node";

interface FilterState {
  /** 年份筛选，"" = 全部 */
  filterYear: string;
  /** 维度筛选，"" = 全部 */
  filterCategory: PlanCategory | "";
  /** L2-L5 钻取：所属 L1 愿景 ID，"" = 全部 */
  drillL1Id: string;
  setFilterYear: (year: string) => void;
  setFilterCategory: (cat: PlanCategory | "") => void;
  setDrillL1Id: (id: string) => void;
  /** 重置所有筛选条件 */
  resetFilters: () => void;
}

const FilterContext = createContext<FilterState | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filterYear, setFilterYear] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<PlanCategory | "">("");
  const [drillL1Id, setDrillL1Id] = useState<string>("");

  const resetFilters = () => {
    setFilterYear("");
    setFilterCategory("");
    setDrillL1Id("");
  };

  return (
    <FilterContext.Provider
      value={{
        filterYear,
        filterCategory,
        drillL1Id,
        setFilterYear,
        setFilterCategory,
        setDrillL1Id,
        resetFilters,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilter(): FilterState {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilter must be used within <FilterProvider>");
  return ctx;
}
