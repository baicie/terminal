import type { ReactElement } from "react";
import styles from "./terminal.module.scss";
import { TFunction } from "i18next";

interface Props {
  msg: string;
  terminalRef: React.RefObject<HTMLDivElement>;
  onClick: () => void;
  t: TFunction<"translation", undefined>;
}

const TerminalView = ({ terminalRef }: Props): ReactElement => (
  <div ref={terminalRef}></div>
);
export default TerminalView;
