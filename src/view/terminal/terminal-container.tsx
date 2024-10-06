import { observer } from "mobx-react-lite";
import { useCallback, useEffect } from "react";
import { useInjectable } from "../../hooks/use-di";
import { useLogger } from "../../hooks/use-logger";
import { Demo } from "../../store/demo";
import View from "./terminal-view";
import { useTranslation } from "react-i18next";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { ImageAddon } from "@xterm/addon-image";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

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

  useEffect(() => {
    const terminal = new Terminal();
    terminal.loadAddon(new FitAddon());
    terminal.loadAddon(new CanvasAddon());
    terminal.loadAddon(new ImageAddon());
    // terminal.loadAddon(new LigaturesAddon());
    terminal.loadAddon(new SearchAddon());
    terminal.loadAddon(new Unicode11Addon());
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new WebglAddon());
    terminal.open(document.getElementById("terminal")!);
    terminal.write("Hello from \x1B[1;3;31mxterm.js\x1B[0m $ ");
    console.log("Terminal container mounted");
  });

  return <View msg={"Terminal"} onClick={handleClick} t={t} />;
});
