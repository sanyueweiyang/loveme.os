import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";

export interface UnfulfilledPlan {
  id: string | number;
  title: string;
  nodeId?: string | number;
  owner?: string;
  [key: string]: any;
}

export interface IncidentalLog {
  id: string | number;
  content?: string;
  title?: string;
  durationMinutes: number;
  [key: string]: any;
}

export interface AuditConsistencyData {
  date: string;
  inProgressCount: number;
  unfulfilledCount: number;
  unfulfilledPlans: UnfulfilledPlan[];
  incidentalLogs: IncidentalLog[];
  [key: string]: any;
}

async function fetchAuditConsistency(date: string): Promise<AuditConsistencyData> {
  try {
    return await apiFetch<AuditConsistencyData>(`/api/audit/consistency?date=${date}`);
  } catch (err: any) {
    toast.error("后端连接失败，请确认本地 Server 已启动", {
      description: err.message || "Network error",
    });
    throw err;
  }
}

export function useAuditConsistency(date: string) {
  return useQuery<AuditConsistencyData>({
    queryKey: ["audit-consistency", date],
    queryFn: () => fetchAuditConsistency(date),
    retry: false,
    staleTime: 30_000,
  });
}
