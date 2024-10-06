import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef } from "react";
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
  const terminalRef = useRef<HTMLDivElement>(null); // 引用 DOM 元素
  const terminal = useRef<Terminal | null>(null); // 引用 Xterm 实例

  const handleClick = useCallback(() => {
    logger.debug("click debug");
    logger.info("click info");
    logger.warn("click warn");
    logger.error("click error");

    demo.doSth();
  }, [demo, logger]);

  useEffect(() => {
    terminal.current = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      theme: {
        background: "red",
        // foreground
      },
    });

    if (terminalRef.current) {
      terminal.current.open(terminalRef.current);
    }

    terminal.current.loadAddon(new FitAddon());
    terminal.current.loadAddon(new CanvasAddon());
    terminal.current.loadAddon(new ImageAddon());
    terminal.current.loadAddon(new LigaturesAddon());
    terminal.current.loadAddon(new SearchAddon());
    terminal.current.loadAddon(new Unicode11Addon());
    terminal.current.loadAddon(new WebLinksAddon());
    terminal.current.loadAddon(new WebglAddon());

    terminal.current?.write("Welcome to Xterm.js in React!\r\n");

    // 监听用户输入事件
    terminal.current?.onData((data) => {
      // 回显输入的字符
      terminal.current?.write(data);

      // 你可以在这里处理输入，例如解析命令或发送到服务器
      console.log("User input:", data);
    });

    // terminal.current.

    return () => {
      // 卸载时销毁终端实例
      terminal.current?.dispose();
    };
  });

  return (
    <View
      terminalRef={terminalRef}
      msg={"Terminal"}
      onClick={handleClick}
      t={t}
    />
  );
});
