import type { ReactElement } from "react";
import { TFunction } from "i18next";

interface Props {
  terminalRef: React.RefObject<HTMLDivElement | null>;
  t: TFunction<"translation", undefined>;
}

const TerminalView = ({ terminalRef }: Props): ReactElement => (
  <div ref={terminalRef}></div>
);
export default TerminalView;
