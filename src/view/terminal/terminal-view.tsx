import type { ReactElement } from "react";

interface Props {
  terminalRef: React.RefObject<HTMLDivElement | null>;
}

const TerminalView = ({ terminalRef }: Props): ReactElement => (
  <div ref={terminalRef}></div>
);
export default TerminalView;
