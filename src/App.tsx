import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/fr";
import "dayjs/locale/zh-cn";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { I18nextProvider, useTranslation } from "react-i18next";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useInjectable } from "./hooks/use-di";
import { AppStore } from "./store/app";
import locales from "./locales";

export default observer(() => {
  const { i18n } = useTranslation();
  const app = useInjectable(AppStore);

  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      dayjs.locale(lng === "cn" ? "zh-cn" : lng);
    };

    handleLanguageChange(i18n.language);
    i18n.on("languageChanged", handleLanguageChange);

    return () => {
      i18n.off("languageChanged", handleLanguageChange);
    };
  }, [i18n]);

  // Apply dark class on mount and whenever theme changes
  useEffect(() => {
    const applyTheme = (theme: string) => {
      const root = document.documentElement;
      if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    applyTheme(app.theme);

    // Watch for theme changes in app store
    const interval = setInterval(() => {
      applyTheme(app.theme);
    }, 100);

    return () => clearInterval(interval);
  }, [app.theme]);

  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <I18nextProvider i18n={locales}>
          <RouterProvider router={router} />
          <Toaster />
        </I18nextProvider>
      </div>
    </TooltipProvider>
  );
});
