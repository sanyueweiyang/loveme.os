import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => currentYear + i);
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

interface TargetTimePickerProps {
  value: string; // "YYYY" or "YYYY-MM"
  onChange: (v: string) => void;
  required?: boolean;
}

export function TargetTimePicker({ value, onChange, required }: TargetTimePickerProps) {
  const year = value ? value.slice(0, 4) : String(currentYear);
  const month = value && value.length >= 7 ? value.slice(5, 7) : "";

  const handleYearChange = (y: string) => {
    onChange(month ? `${y}-${month}` : y);
  };

  const handleMonthChange = (m: string) => {
    if (m === "none") {
      onChange(year);
    } else {
      onChange(`${year}-${m}`);
    }
  };

  return (
    <div>
      <Label className="text-xs">
        目标时间 {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="flex items-center gap-2 mt-1">
        <Select value={year} onValueChange={handleYearChange}>
          <SelectTrigger className="flex-1 h-9 text-xs">
            <SelectValue placeholder="年份" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map(y => (
              <SelectItem key={y} value={String(y)}>{y} 年</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={month || "none"} onValueChange={handleMonthChange}>
          <SelectTrigger className="flex-1 h-9 text-xs">
            <SelectValue placeholder="月份（可选）" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">不限月份</SelectItem>
            {MONTHS.map(m => (
              <SelectItem key={m} value={m}>{parseInt(m)} 月</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
