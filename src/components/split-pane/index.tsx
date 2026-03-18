import React, { useState, useCallback, useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import type { SplitGroup } from "@/types";

interface SplitPaneProps {
  group: SplitGroup;
  children: React.ReactNode[];
}

const SplitPane: React.FC<SplitPaneProps> = observer(({ group, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<number[]>(group.sizes || [50, 50]);
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSizes = useRef<number[]>([50, 50]);

  const isHorizontal = group.mode === "horizontal";

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startPos.current = isHorizontal ? e.clientX : e.clientY;
    startSizes.current = [...sizes];
    document.body.style.cursor = isHorizontal ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [isHorizontal, sizes]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const containerSize = isHorizontal ? containerRect.width : containerRect.height;
      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const startPosCurrent = isHorizontal ? startPos.current : startPos.current;
      const delta = currentPos - startPosCurrent;
      const deltaPercent = (delta / containerSize) * 100;

      const newSizes = [
        Math.max(20, Math.min(80, startSizes.current[0] + deltaPercent)),
        Math.max(20, Math.min(80, startSizes.current[1] - deltaPercent)),
      ];

      setSizes(newSizes);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isHorizontal]);

  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? "flex-row" : "flex-col"} h-full w-full`}
    >
      <div
        style={{
          [isHorizontal ? "width" : "height"]: `${sizes[0]}%`,
        }}
        className="overflow-hidden"
      >
        {children[0]}
      </div>
      <div
        className={`flex-shrink-0 ${isHorizontal ? "w-1" : "h-1"} bg-[var(--border-color)] cursor-${isHorizontal ? "col" : "row"}-resize hover:bg-[var(--primary-color)] transition-colors`}
        onMouseDown={handleMouseDown}
      />
      <div
        style={{
          [isHorizontal ? "width" : "height"]: `${sizes[1]}%`,
        }}
        className="overflow-hidden"
      >
        {children[1]}
      </div>
    </div>
  );
});

export default SplitPane;
