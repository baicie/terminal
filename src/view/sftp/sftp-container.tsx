import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { useInjectable } from "../../hooks/use-di";
import { useLogger } from "../../hooks/use-logger";
import { Demo } from "../../store/demo";
import SFTPView from "./sftp-view";
import { useTranslation } from "react-i18next";

export default observer(() => {
  const demo = useInjectable(Demo);
  const logger = useLogger();
  const { t } = useTranslation();

  const handleClick = useCallback(() => {
    logger.debug("click debug");
    logger.info("click info");
    logger.warn("click warn");
    logger.error("click error");

    demo.doSth();
  }, [demo, logger]);

  return <SFTPView msg={demo.msg} onClick={handleClick} t={t} />;
});
