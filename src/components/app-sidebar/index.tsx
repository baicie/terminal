import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Server,
  Key,
  ArrowLeftRight,
  Code2,
  Fingerprint,
  FileText,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";

interface NavItem {
  path: string;
  labelKey: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    path: "/hosts",
    labelKey: "nav.hosts",
    icon: <Server className="size-5" />,
  },
  {
    path: "/keychain",
    labelKey: "nav.keychain",
    icon: <Key className="size-5" />,
  },
  {
    path: "/port-forward",
    labelKey: "nav.portForward",
    icon: <ArrowLeftRight className="size-5" />,
  },
  {
    path: "/snippets",
    labelKey: "nav.snippets",
    icon: <Code2 className="size-5" />,
  },
  {
    path: "/known-hosts",
    labelKey: "nav.knownHosts",
    icon: <Fingerprint className="size-5" />,
  },
  {
    path: "/logs",
    labelKey: "nav.logs",
    icon: <FileText className="size-5" />,
  },
];

interface NavItemProps {
  item: NavItem;
  collapsed?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ item, collapsed }) => {
  const { t } = useTranslation("demo");
  const location = useLocation();
  const hostsPaths = ["/", "/hosts"];
  const pathActive =
    item.path === "/hosts"
      ? hostsPaths.includes(location.pathname)
      : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);

  const linkContent = (
    <NavLink
      to={item.path === "/hosts" ? "/hosts" : item.path}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150",
        "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
        pathActive && "bg-secondary/80 text-foreground shadow-sm",
        collapsed && "justify-center px-2"
      )}
    >
      {item.icon}
      {!collapsed && (
        <span className="text-sm font-medium truncate">{t(item.labelKey)}</span>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
        <TooltipContent side="right">
          <p>{t(item.labelKey)}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return linkContent;
};

interface AppSidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** 可拖拽调整宽度时由父级传入像素宽度 */
  width?: number;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ collapsed = false, onToggleCollapse, width }) => {
  const { t } = useTranslation("demo");

  return (
    <div
      className={cn(
        "h-full bg-secondary/40 border-r border-border/60 flex flex-col shrink-0 min-h-0 transition-all duration-200",
        collapsed && "w-16"
      )}
      style={!collapsed && width != null ? { width } : undefined}
    >
      {/* Header with collapse button */}
      <div className="px-3 py-3 border-b border-border/60 flex items-center justify-between">
        {!collapsed && (
          <span className="text-sm font-semibold text-foreground">{t("app.name")}</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn("size-7 shrink-0", collapsed && "mx-auto")}
          onClick={onToggleCollapse}
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? (
            <PanelLeft className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </Button>
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map((item) => (
          <NavItem key={item.path} item={item} collapsed={collapsed} />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border/60">
        <p
          className={cn(
            "text-[11px] text-muted-foreground/70 px-3 transition-opacity duration-200",
            collapsed && "opacity-0"
          )}
        >
          {t("app.version")}
        </p>
      </div>
    </div>
  );
};

export default AppSidebar;
