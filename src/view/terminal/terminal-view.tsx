import type { ReactElement } from "react";
import styles from "./terminal.module.scss";
import { TFunction } from "i18next";

interface Props {
  msg: string;
  onClick: () => void;
  t: TFunction<"translation", undefined>;
}

const TerminalView = ({ msg, onClick, t }: Props): ReactElement => (
  <div id="terminal"></div>
);
export default TerminalView;
