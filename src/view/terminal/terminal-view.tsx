import type { ReactElement, RefObject } from "react";

interface Props {
  terminalRef?: RefObject<HTMLDivElement | null>;
  xtermRef?: RefObject<HTMLDivElement | null>;
}

const TerminalView = ({ xtermRef }: Props): ReactElement => (
  <div
    ref={xtermRef}
    className="w-full h-full"
    style={{ background: '#1e1e1e' }}
  />
);

export default TerminalView;
