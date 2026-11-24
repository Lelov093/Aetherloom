import type { ReactNode, CSSProperties } from "react";
import { WorkspaceHeader } from "../../components/WorkspaceContext";
import { MonitorPane } from "./MonitorPane";
import { useMonitorLayout } from "./useMonitorLayout";

/** Shared product shell; engine-specific readers supply their actual authorized content. */
export function MonitorFrame({
  title,
  layout: frame,
  header,
  log,
  inspector,
  children,
  notice,
  overlays,
  switching = false,
  className = "",
}: {
  title: string;
  layout: ReturnType<typeof useMonitorLayout>;
  header: ReactNode;
  log: ReactNode;
  inspector: ReactNode;
  children: ReactNode;
  notice?: ReactNode;
  overlays?: ReactNode;
  switching?: boolean;
  className?: string;
}) {
  const { layout, set, narrow, start, move, end, resize, bounds } = frame;
  const divider = (side: "left" | "right") => (
    <button
      type="button"
      className="monitor-divider"
      role="separator"
      aria-label={side === "left" ? "调整世界日志宽度" : "调整详情宽度"}
      aria-orientation="vertical"
      aria-valuemin={bounds[side].min}
      aria-valuemax={bounds[side].max}
      aria-valuenow={layout[side]}
      onPointerDown={(e) => start(side, e)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          resize(
            side,
            e.key === "Home"
              ? bounds[side].min
              : e.key === "End"
                ? bounds[side].max
                : layout[side] +
                  (e.key === "ArrowRight" ? 16 : -16) *
                    (side === "left" ? 1 : -1),
          );
        }
      }}
    />
  );
  return (
    <main
      id="main-content"
      className={`simulation-monitor ${className}`}
      aria-busy={switching}
      style={
        {
          "--monitor-left": `${layout.left}px`,
          "--monitor-right": `${layout.right}px`,
        } as CSSProperties
      }
    >
      <h1 className="sr-only">{title}</h1>
      <WorkspaceHeader>{header}</WorkspaceHeader>
      {notice}
      <div
        className={`monitor-body ${layout.log ? "has-log" : ""} ${layout.inspector ? "has-inspector" : ""}`}
        inert={switching}
      >
        {layout.log && (
          <>
            <MonitorPane
              side="log"
              floating={narrow}
              onClose={() => set({ log: false })}
            >
              {log}
            </MonitorPane>
            {!narrow && divider("left")}
          </>
        )}
        <section className="monitor-scene" aria-label="世界场景">
          {children}
        </section>
        {layout.inspector && (
          <>
            {!narrow && divider("right")}
            <MonitorPane
              side="inspector"
              floating={narrow}
              onClose={() => set({ inspector: false })}
            >
              {inspector}
            </MonitorPane>
          </>
        )}
      </div>
      {overlays}
    </main>
  );
}
