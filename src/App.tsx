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
import i18nCore from "./locales";
import { register, isRegistered } from "@tauri-apps/plugin-global-shortcut";

export default observer(() => {
  const { i18n } = useTranslation();
  const app = useInjectable(AppStore);

  // Register macOS native shortcuts
  useEffect(() => {
    const registerShortcuts = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");

        // Cmd+W - Close window (hide to dock)
        if (!(await isRegistered("CommandOrControl+W"))) {
          await register("CommandOrControl+W", async (event) => {
            if (event.state === "Pressed") {
              await getCurrentWindow().hide();
            }
          });
        }

        // Cmd+M - Minimize window
        if (!(await isRegistered("CommandOrControl+M"))) {
          await register("CommandOrControl+M", async (event) => {
            if (event.state === "Pressed") {
              await getCurrentWindow().minimize();
            }
          });
        }

        // Cmd+H - Hide window
        if (!(await isRegistered("CommandOrControl+H"))) {
          await register("CommandOrControl+H", async (event) => {
            if (event.state === "Pressed") {
              await getCurrentWindow().hide();
            }
          });
        }

        // Cmd+, - Open settings (handled by app)
        if (!(await isRegistered("CommandOrControl+,"))) {
          await register("CommandOrControl+,", async () => {
            // This will be handled by the settings dialog component
            window.dispatchEvent(new CustomEvent("open-settings"));
          });
        }
      } catch (e) {
        console.warn("Failed to register global shortcuts:", e);
      }
    };

    registerShortcuts();

    // Cleanup on unmount
    return () => {
      import("@tauri-apps/plugin-global-shortcut").then(({ unregisterAll }) => {
        unregisterAll().catch(() => {});
      });
    };
  }, []);

  useEffect(() => {
    void app.hydrateFromDatabase();
  }, [app]);

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

  // 与设置、AppStore.theme 同步：写入 document 的 dark class（不依赖轮询）
  useEffect(() => {
    const applyTheme = (mode: string) => {
      const root = document.documentElement;
      const dark =
        mode === "dark" ||
        (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      root.classList.toggle("dark", dark);
    };

    applyTheme(app.theme);

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (app.theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, [app.theme]);

  // 数据库恢复的语言与 i18n 对齐
  useEffect(() => {
    if (app.language && i18nCore.language !== app.language) {
      void i18nCore.changeLanguage(app.language);
    }
  }, [app.language]);

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
