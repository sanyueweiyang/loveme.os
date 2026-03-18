import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { WBS_LAYERS } from "@/types/wbs";
import { cn } from "@/lib/utils";
import { Heart, Settings, Compass, Zap, TrendingUp } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

const levelColors: Record<number, string> = {
  1: "bg-wbs-l1",
  2: "bg-wbs-l2",
  3: "bg-wbs-l3",
  4: "bg-wbs-l4",
  5: "bg-wbs-l5",
  6: "bg-wbs-l6",
};

const visionLayers = WBS_LAYERS.filter(l => l.level >= 1 && l.level <= 4);
const actionLayers = WBS_LAYERS.filter(l => l.level >= 5 && l.level <= 6);

interface AppSidebarProps {
  activeLevel: number;
  onLevelChange: (level: number) => void;
}

export function AppSidebar({ activeLevel, onLevelChange }: AppSidebarProps) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isCalendar = location.pathname === "/calendar";
  const isReporting = location.pathname === "/reporting";
  const isAudit = location.pathname === "/audit";

  const handleLayerClick = (level: number) => {
    if (!isHome) navigate("/");
    onLevelChange(level);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <Heart className="w-4 h-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col justify-center">
              <span className="text-sm font-bold tracking-tight leading-tight">LoveMe OS</span>
              <span className="text-[10px] text-sidebar-foreground/60 leading-tight">Personal OS</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* 1. 长期愿景 (L1-L4) */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 flex items-center gap-1.5">
              <Compass className="w-3 h-3" />
              长期愿景
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {visionLayers.map((layer) => {
                const isActive = isHome && activeLevel === layer.level;
                return (
                  <SidebarMenuItem key={layer.level}>
                    <SidebarMenuButton
                      onClick={() => handleLayerClick(layer.level)}
                      isActive={isActive}
                      tooltip={collapsed ? layer.label : undefined}
                      className={cn("gap-2 transition-all", isActive && "font-medium")}
                    >
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        levelColors[layer.level] || "bg-primary",
                        !isActive && "opacity-40"
                      )} />
                      {!collapsed && <span>{layer.label}</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* 2. 当下行动 (L5, L6, 每日清单) */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              当下行动
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {actionLayers.map((layer) => {
                const isActive = isHome && activeLevel === layer.level;
                return (
                  <SidebarMenuItem key={layer.level}>
                    <SidebarMenuButton
                      onClick={() => handleLayerClick(layer.level)}
                      isActive={isActive}
                      tooltip={collapsed ? layer.label : undefined}
                      className={cn("gap-2 transition-all", isActive && "font-medium")}
                    >
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        levelColors[layer.level] || "bg-primary",
                        !isActive && "opacity-40"
                      )} />
                      {!collapsed && <span>{layer.label}</span>}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => navigate("/calendar")}
                  isActive={isCalendar}
                  tooltip={collapsed ? "每日清单" : undefined}
                  className={cn("gap-2 transition-all", isCalendar && "font-medium")}
                >
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0 bg-primary",
                    !isCalendar && "opacity-40"
                  )} />
                  {!collapsed && <span>每日清单</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* 3. 成长轨迹 */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-sidebar-foreground/40 flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3" />
              成长轨迹
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => navigate("/reporting")}
                  isActive={isReporting}
                  tooltip={collapsed ? "我的总结" : undefined}
                  className={cn("gap-2 transition-all", isReporting && "font-medium")}
                >
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0 bg-primary",
                    !isReporting && "opacity-40"
                  )} />
                  {!collapsed && <span>我的总结</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => navigate("/audit")}
                  isActive={isAudit}
                  tooltip={collapsed ? "AI小助手" : undefined}
                  className={cn("gap-2 transition-all", isAudit && "font-medium")}
                >
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0 bg-primary",
                    !isAudit && "opacity-40"
                  )} />
                  {!collapsed && <span>AI小助手</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={collapsed ? "设置" : undefined} className="gap-2">
              <Settings className="w-4 h-4" />
              {!collapsed && <span className="text-xs">设置</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
