import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Server,
  Key,
  ArrowLeftRight,
  Code2,
  Fingerprint,
  FileText,
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
}

const NavItem: React.FC<NavItemProps> = ({ item }) => {
  const { t } = useTranslation("demo");
  const location = useLocation();
  const hostsPaths = ["/", "/hosts"];
  const pathActive =
    item.path === "/hosts"
      ? hostsPaths.includes(location.pathname)
      : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <NavLink
          to={item.path === "/hosts" ? "/hosts" : item.path}
          className={() =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              pathActive && "bg-secondary/80 text-foreground shadow-sm"
            )
          }
        >
          {item.icon}
          <span className="text-sm font-medium hidden group-[.collapsed]:hidden">
            {t(item.labelKey)}
          </span>
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" className="hidden group:hidden">
        <p>{t(item.labelKey)}</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface AppSidebarProps {
  collapsed?: boolean;
  /** 可拖拽调整宽度时由父级传入像素宽度 */
  width?: number;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ collapsed = false, width }) => {
  const { t } = useTranslation("demo");
  return (
    <div
      className={cn(
        "h-full bg-secondary/40 border-r border-border/60 flex flex-col shrink-0 min-h-0 transition-[width] duration-75",
        collapsed ? "w-16" : width == null ? "w-60" : ""
      )}
      style={!collapsed && width != null ? { width } : undefined}
    >
      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {navItems.map((item) => (
          <NavItem key={item.path} item={item} />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-border/60">
        <p
          className={cn(
            "text-[11px] text-muted-foreground/70 px-3 transition-opacity",
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
