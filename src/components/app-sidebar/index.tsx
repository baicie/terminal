import { NavLink } from "react-router-dom";
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
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  {
    path: "/hosts",
    label: "Hosts",
    icon: <Server className="size-5" />,
  },
  {
    path: "/keychain",
    label: "Keychain",
    icon: <Key className="size-5" />,
  },
  {
    path: "/port-forward",
    label: "Port Forward",
    icon: <ArrowLeftRight className="size-5" />,
  },
  {
    path: "/snippets",
    label: "Snippets",
    icon: <Code2 className="size-5" />,
  },
  {
    path: "/known-hosts",
    label: "Known Hosts",
    icon: <Fingerprint className="size-5" />,
  },
  {
    path: "/logs",
    label: "Logs",
    icon: <FileText className="size-5" />,
  },
];

interface NavItemProps {
  item: NavItem;
}

const NavItem: React.FC<NavItemProps> = ({ item }) => {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <NavLink
          to={item.path}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
              isActive && "bg-secondary/80 text-foreground shadow-sm"
            )
          }
        >
          {item.icon}
          <span className="text-sm font-medium hidden group-[.collapsed]:hidden">
            {item.label}
          </span>
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" className="hidden group:hidden">
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface AppSidebarProps {
  collapsed?: boolean;
}

const AppSidebar: React.FC<AppSidebarProps> = ({ collapsed = false }) => {
  return (
    <div
      className={cn(
        "h-full bg-secondary/40 border-r border-border/60 flex flex-col shrink-0 transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Navigation Items */}
      <nav className="flex-1 px-3 py-4 space-y-1">
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
          Terminal v1.0
        </p>
      </div>
    </div>
  );
};

export default AppSidebar;
