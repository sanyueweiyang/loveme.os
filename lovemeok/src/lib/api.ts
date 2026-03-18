// LoveMe OS — API 层：纯前端本地联调，强制直连本地后端（不走任何代理）

export interface DebugLogEntry {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  status: "pending" | "success" | "error";
  statusCode?: number;
  duration?: number;
  error?: string;
}

type LogListener = (logs: DebugLogEntry[]) => void;

let _logs: DebugLogEntry[] = [];
let _nextId = 1;
const _listeners = new Set<LogListener>();

function notify() {
  const snapshot = [..._logs];
  _listeners.forEach((fn) => fn(snapshot));
}

export function subscribeDebugLogs(fn: LogListener): () => void {
  _listeners.add(fn);
  fn([..._logs]);
  return () => _listeners.delete(fn);
}

export function clearDebugLogs() {
  _logs = [];
  notify();
}

export const LOCAL_API_URL = "http://localhost:8080/api";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const logId = _nextId++;
  const start = performance.now();

  const entry: DebugLogEntry = {
    id: logId,
    timestamp: new Date().toLocaleTimeString(),
    method,
    path,
    status: "pending",
  };
  _logs = [entry, ..._logs].slice(0, 100);
  notify();

  let url: string;
  if (path.startsWith("http")) {
    url = path;
  } else {
    let normalized = path.trim();
    // 允许调用方传 "/api/xxx" 或 "/xxx" 或 "xxx"
    if (normalized.startsWith("/api/")) normalized = normalized.slice(4);
    else if (normalized === "/api") normalized = "";
    url = `${LOCAL_API_URL.replace(/\/$/, "")}${normalized ? (normalized.startsWith("/") ? normalized : `/${normalized}`) : ""}`;
  }
  console.log(`[API] ${method} ${path} — direct fetch to ${url}`);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      },
      body: method !== "GET" ? options.body : undefined,
    });

    const duration = Math.round(performance.now() - start);
    const data = await response.json();

    if (!response.ok || data?.error) {
      const errMsg = data?.error || `${response.status} ${response.statusText}`;
      _logs = _logs.map((l) =>
        l.id === logId
          ? { ...l, status: "error" as const, statusCode: response.status, duration, error: errMsg }
          : l
      );
      notify();
      console.error(`[API] ${method} ${path} — ${errMsg} (${duration}ms)`);
      throw new Error(`API error: ${errMsg}`);
    }

    _logs = _logs.map((l) =>
      l.id === logId
        ? { ...l, status: "success" as const, statusCode: 200, duration }
        : l
    );
    notify();
    console.log(`[API] ${method} ${path} — 200 (${duration}ms)`);

    return data as T;
  } catch (err: any) {
    const duration = Math.round(performance.now() - start);
    if (!_logs.find((l) => l.id === logId && l.status !== "pending")) {
      _logs = _logs.map((l) =>
        l.id === logId
          ? { ...l, status: "error" as const, duration, error: err.message || "Network error" }
          : l
      );
      notify();
    }
    console.error(`[API] ${method} ${path} — FAILED: ${err.message} (${duration}ms)`);
    throw err;
  }
}
