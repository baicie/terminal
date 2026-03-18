import dayjs from "dayjs";
import "dayjs/locale/en";
import "dayjs/locale/fr";
import "dayjs/locale/zh-cn";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useInjectable } from "./hooks/use-di";
import { AppStore } from "./store/app";
import locales from "./locales";

export default observer(() => {
  const { i18n } = useTranslation();
  useInjectable(AppStore);

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

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <I18nextProvider i18n={locales}>
        <RouterProvider router={router} />
      </I18nextProvider>
    </div>
  );
});
