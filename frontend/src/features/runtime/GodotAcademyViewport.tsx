import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, Save } from "lucide-react";
import { displayName, type Envelope } from "./api";
import { academyProjection } from "./academy_projection";
import "./godot-academy.css";

interface Point {
  id: string;
  x: number;
  y: number;
}
interface Layout {
  type: "layout";
  place: string;
  revision: string;
  actors: (Point & {
    moving: boolean;
    room: number[];
    facing: string;
    speech: string;
  })[];
  items: Point[];
  exits: Point[];
  frames: number;
  drawn_frames?: number;
  route_samples: number;
  samples_blocked: number;
  route_lengths: Record<string, number>;
  camera: { x: number; y: number; zoom: number };
}

export function GodotAcademyViewport({
  frame,
  assetVersion,
  place,
  actor,
  follow,
  onActor,
  onExit,
  onText,
  onCompatibility,
}: {
  frame: Envelope;
  assetVersion: string;
  place: string;
  actor: string;
  follow: boolean;
  onActor: (id: string) => void;
  onExit: (id: string) => void;
  onText: () => void;
  onCompatibility: () => void;
}) {
  const resourcePath = `/renderers/academy/${encodeURIComponent(assetVersion)}`;
  const iframe = useRef<HTMLIFrameElement>(null),
    current = useRef({ frame, place, onActor, onExit });
  current.current = { frame, place, onActor, onExit };
  const [cycle, setCycle] = useState(0),
    [available, setAvailable] = useState(false),
    [ready, setReady] = useState(false);
  const [layout, setLayout] = useState<Layout>(),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<number>(),
    [slow, setSlow] = useState(false);
  const [reduced, setReduced] = useState(
    matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const payload = academyProjection(frame, place, actor, reduced, follow),
    latest = useRef(payload);
  latest.current = payload;
  const visible =
    layout?.revision === frame.cursor && layout.place === place
      ? layout
      : undefined;
  function send(data: object) {
    iframe.current?.contentWindow?.postMessage(
      { source: "aetherloom-academy-host", ...data },
      location.origin,
    );
  }
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)"),
      changed = () => setReduced(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setAvailable(false);
    setReady(false);
    setLayout(undefined);
    setError("");
    setProgress(undefined);
    setSlow(false);
    fetch(`${resourcePath}/manifest.json`, {
      cache: "no-store",
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw Error("renderer missing");
        const manifest = await response.json();
        if (!active) return;
        if (manifest?.asset_version !== assetVersion || manifest.version !== "academy-renderer-v1") {
          setError(`学院场景资源版本不兼容。此世界线需要 ${assetVersion}。`);
          return;
        }
        setAvailable(true);
      })
      .catch(() => {
        if (active) setError(`学院场景资源未能加载。此世界线需要 ${assetVersion}。`);
      });
    const timer = setTimeout(() => {
      if (active) setSlow(true);
    }, 20000);
    const receive = (event: MessageEvent) => {
      if (
        !active ||
        event.source !== iframe.current?.contentWindow ||
        event.origin !== location.origin ||
        event.data?.source !== "aetherloom-academy"
      )
        return;
      const message = event.data,
        c = current.current;
      if (message.type === "ready") {
        setReady(true);
        send({ type: "projection", data: latest.current });
      }
      if (message.type === "progress" && message.total > 0)
        setProgress(
          Math.min(100, Math.round((message.current / message.total) * 100)),
        );
      if (
        message.type === "layout" &&
        message.revision === c.frame.cursor &&
        message.place === c.place
      )
        setLayout(message);
      if (
        message.type === "actor" &&
        message.revision === c.frame.cursor &&
        message.place === c.place &&
        c.frame.projection.agents[message.id]?.location === c.place
      )
        c.onActor(message.id);
      if (
        message.type === "exit" &&
        message.place === c.place &&
        c.frame.projection.world.place_topology[c.place]?.includes(message.id)
      )
        c.onExit(message.id);
      if (message.type === "error")
        setError(
          "学院场景暂时不可用。已保存的世界不受影响，可重试或切回文本。",
        );
    };
    window.addEventListener("message", receive);
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [cycle, resourcePath, assetVersion]);
  useEffect(() => {
    if (ready) send({ type: "projection", data: payload });
  }, [frame, place, actor, reduced, follow, ready]);
  useEffect(() => {
    let active = true;
    if (ready && layout?.place === place) {
      window.aetherloomRuntime
        ?.viewerLayout(
          frame.projection.worldline_id,
          undefined,
          "godot:" + place,
        )
        .then((value) => {
          if (active && value)
            send({ type: "camera", action: "restore", ...value.camera });
        })
        .catch(() => {
          if (active) setNotice("镜头偏好未能读取，使用默认视角。");
        });
    }
    return () => {
      active = false;
    };
  }, [ready, layout?.place, place, cycle]);
  async function saveCamera() {
    if (!visible) return;
    try {
      await window.aetherloomRuntime?.viewerLayout(
        frame.projection.worldline_id,
        { version: 1, camera: visible.camera, places: [] },
        "godot:" + place,
      );
      setNotice("镜头已保存，世界状态未改变。");
    } catch {
      setNotice("镜头暂未保存，可重试。");
    }
  }
  return (
    <div
      className="godot-academy-viewport"
      data-place={place}
      data-ready={ready && !!visible}
      data-actors={visible?.actors.length || 0}
      data-frames={visible?.frames || 0}
      data-drawn-frames={visible?.drawn_frames}
      data-revision={visible?.revision || ""}
      data-route-samples={visible?.route_samples || 0}
      data-route-blocked={visible?.samples_blocked || 0}
      data-route-lengths={JSON.stringify(visible?.route_lengths || {})}
      data-camera={JSON.stringify(visible?.camera || {})}
    >
      {available && (
        <iframe
          key={cycle}
          ref={iframe}
          src={`${resourcePath}/index.html`}
          title="学院 2.5D 场景"
          sandbox="allow-scripts allow-same-origin"
          onLoad={(event) => {
            if (!event.currentTarget.contentDocument?.querySelector("canvas")) {
              setError("学院场景页面未能加载。");
            }
          }}
          style={{ pointerEvents: visible ? "auto" : "none" }}
        />
      )}
      {(!ready || !layout) && !error && (
        <div className="godot-academy-loading" role="status">
          <strong>正在准备学院场景…</strong>
          <progress aria-label="场景资源加载进度" value={progress} max={100} />
          <span>
            {progress === undefined
              ? "首次打开需要加载场景资源"
              : `${progress}% · 正在准备画面`}
          </span>
          {slow && <>
            <button onClick={() => setCycle((c) => c + 1)}>加载较慢，重新尝试</button>
            <button onClick={onText}>切回文本</button>
          </>}
        </div>
      )}
      {ready && layout && !visible && (
        <span className="godot-academy-sync" role="status">
          正在同步场景…
        </span>
      )}
      <div className="godot-academy-labels">
        {visible?.actors.map((a) => (
          <div
            key={a.id}
            className="godot-actor-overlay"
            style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
            data-godot-actor={a.id}
            data-moving={a.moving}
            data-room={JSON.stringify(a.room)}
            data-facing={a.facing}
          >
            {a.speech && <span className="godot-speech">{a.speech}</span>}
            <button onClick={() => onActor(a.id)} aria-pressed={a.id === actor}>
              {displayName(frame.projection, a.id)}
            </button>
          </div>
        ))}
        {visible?.items.map((item) => (
          <span
            key={item.id}
            className="godot-item-label"
            data-godot-item={item.id}
            style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}
          >
            {displayName(frame.projection, item.id)}
          </span>
        ))}
        {visible?.exits.map((exit) => (
          <button
            key={exit.id}
            className="godot-door-label"
            data-godot-exit={exit.id}
            style={{ left: `${exit.x * 100}%`, top: `${exit.y * 100}%` }}
            onClick={() => onExit(exit.id)}
          >
            {displayName(frame.projection, exit.id)} →
          </button>
        ))}
      </div>
      <div className="godot-academy-camera">
        <button
          aria-label="保存场景镜头"
          onClick={saveCamera}
          disabled={!visible}
        >
          <Save size={17} />
        </button>
        <button
          aria-label="缩小场景"
          onClick={() => send({ type: "camera", scale: 0.9 })}
        >
          <Minus size={17} />
        </button>
        <button
          aria-label="适应场景"
          onClick={() => send({ type: "camera", action: "fit" })}
        >
          <Maximize2 size={17} />
        </button>
        <button
          aria-label="放大场景"
          onClick={() => send({ type: "camera", scale: 1.1 })}
        >
          <Plus size={17} />
        </button>
      </div>
      <small className="godot-academy-note" role="status">
        {notice || "中键拖动平移 · 滚轮缩放"}
      </small>
      {error && (
        <div className="godot-academy-error" role="alert">
          <strong>{error}</strong>
          <button onClick={() => setCycle((c) => c + 1)}>重试场景</button>
          <button onClick={onText}>切回文本</button>
          <button onClick={onCompatibility}>使用兼容视图</button>
        </div>
      )}
    </div>
  );
}
