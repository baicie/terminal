import { useEffect, useState } from "react";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, toast as sonnerToast, type ToasterProps } from "sonner";

/** 与 document.documentElement 的 `dark` class 同步（不使用 next-themes Provider） */
function useDocumentDarkTheme(): ToasterProps["theme"] {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light"
  );

  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useDocumentDarkTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };

export const toast = {
  success: (title: string, opts?: { description?: string }) => sonnerToast.success(title, opts),
  error: (title: string, opts?: { description?: string }) => sonnerToast.error(title, opts),
  info: (title: string, opts?: { description?: string }) => sonnerToast.info(title, opts),
  warning: (title: string, opts?: { description?: string }) => sonnerToast.warning(title, opts),
};
