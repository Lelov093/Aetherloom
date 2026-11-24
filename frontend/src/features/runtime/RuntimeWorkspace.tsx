import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useWorkspaceTrail } from "../../components/WorkspaceContext";
import {
  acceptEnvelope,
  runtimeRequest,
  runtimeStream,
  RuntimeError,
  type Envelope,
  type HostSession,
  type Role,
  type Worldline,
} from "./api";
import { RuntimeMonitor } from "./RuntimeMonitor";
import "../../styles/runtime.css";
const failMessage = (e: unknown) =>
  e instanceof RuntimeError && e.status === 401
    ? "授权已失效，已清除观察内容。请重新连接。"
    : e instanceof RuntimeError && e.status === 403
      ? "当前角色无权访问此世界线。"
      : "连接暂时中断。已保存的世界不会受影响，可重新连接。";

export function RuntimeWorkspace({ world }: { world: string }) {
  const fromReview = useLocation().state?.simulationReviewWorld === world;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams(),
    line = params.get("line");
  const mode = params.get("view") === "2d" ? "2d" : "text";
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const offline = () => setOnline(false),
      connected = () => setOnline(true);
    window.addEventListener("offline", offline);
    window.addEventListener("online", connected);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connected);
    };
  }, []);
  const [role, setRole] = useState<Role>("creator_observer"),
    [cycle, setCycle] = useState(0);
  const [binding, setBinding] = useState<{ line: string; actor: string }>();
  const [session, setSession] = useState<HostSession>(),
    [lines, setLines] = useState<Worldline[]>([]);
  const [frame, setFrame] = useState<Envelope>(),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("正在连接本机宿主…");
  const selectedSeq = params.get('seq');
  const history = selectedSeq !== null && /^\d+$/.test(selectedSeq) ? Number(selectedSeq) : null;
  function setHistory(seq: number | null) {
    setParams(previous => { if (seq === null) previous.delete('seq'); else previous.set('seq', String(seq)); return previous; });
  }
  const [actor, setActor] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    current = useRef<Envelope>(undefined);
  useWorkspaceTrail([{ label: "世界模拟" }]);

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setSession(undefined);
    setFrame(undefined);
    current.current = undefined;
    setLines([]);
    setError("");
    setConnection("正在连接本机宿主…");
    async function connect() {
      try {
        if (
          !window.aetherloomRuntime ||
          !(await window.aetherloomRuntime.available())
        )
          throw new Error("host_unavailable");
        const next = await window.aetherloomRuntime.session(
          world,
          role,
          binding?.line,
          binding?.actor,
        );
        if (!active || !next) return;
        const saved = await runtimeRequest<Worldline[]>(
          next,
          "/worldlines",
          abort.signal,
        );
        if (active) {
          setSession(next);
          setLines(saved);
          setConnection("已连接本机宿主");
        }
      } catch (e) {
        if (active) {
          setError(
            window.aetherloomRuntime
              ? failMessage(e)
              : "请从已启用新世界线功能的桌面宿主打开。",
          );
          setConnection("尚未连接");
        }
      }
    }
    void connect();
    return () => {
      active = false;
      abort.abort();
    };
  }, [world, role, cycle, binding]);

  useEffect(() => {
    const run = ++generation.current,
      abort = new AbortController();
    setFrame((old) =>
      old?.projection.viewer_scope === session?.viewer_scope &&
      old?.projection.worldline_id === line
        ? old
        : undefined,
    );
    current.current = undefined;
    setError("");
    setBusy(false);
    setConnection(history === null ? "正在读取实时状态…" : "正在读取历史状态…");
    if (!session || !line) return () => abort.abort();
    let active = true;
    const receive = (next: Envelope) => {
      if (!active || generation.current !== run) return;
      current.current = acceptEnvelope(
        current.current,
        next,
        session.viewer_scope,
        line,
      );
      setFrame(current.current);
      setConnection(history === null ? "实时同步已连接" : "历史状态 · 只读");
    };
    async function synchronize() {
      while (active) {
        try {
          const next = await runtimeRequest<Envelope>(
            session!,
            `/worldlines/${encodeURIComponent(line!)}/snapshot${history === null ? "" : "?seq=" + history}`,
            abort.signal,
          );
          receive(next);
          if (history !== null) return;
          await runtimeStream(
            session!,
            line!,
            next.cursor,
            abort.signal,
            receive,
          );
        } catch (e) {
          if (!active) return;
          if (e instanceof RuntimeError && [401, 403].includes(e.status)) {
            current.current = undefined;
            setFrame(undefined);
            setLines([]);
            setError(failMessage(e));
            setConnection("授权不可用");
            return;
          }
          if (
            e instanceof RuntimeError &&
            e.status === 409 &&
            e.message !== "resnapshot_required"
          ) {
            setError("无法读取此状态：" + e.message);
            setConnection("读取失败");
            return;
          }
          if (
            e instanceof RuntimeError &&
            e.message === "resnapshot_required"
          ) {
            // Drop the stream cursor while keeping the last authorized view read-only.
            current.current = undefined;
          }
          setConnection("连接中断，正在重新获取快照…");
          await new Promise<void>((resolve) => {
            const finish = () => {
              clearTimeout(timer);
              abort.signal.removeEventListener("abort", finish);
              resolve();
            };
            const timer = setTimeout(finish, 1500);
            abort.signal.addEventListener("abort", finish, { once: true });
            if (abort.signal.aborted) finish();
          });
        }
      }
    }
    void synchronize();
    return () => {
      active = false;
      abort.abort();
    };
  }, [session, line, history]);

  function switchRole(next: Role) {
    if (next === "participant") {
      const selected =
        actor in (frame?.projection.agents || {})
          ? actor
          : Object.keys(frame?.projection.agents || {})[0];
      if (!line || !selected) return;
      setBinding({ line, actor: selected });
    } else setBinding(undefined);
    ++generation.current;
    setFrame(undefined);
    current.current = undefined;
    setSession(undefined);
    setHistory(null);
    setRole(next);
  }
  function switchLine(next: string, seq?: number) {
    if (next === line && seq === undefined) return;
    ++generation.current;
    setFrame(undefined);
    current.current = undefined;
    setActor("");
    setParams({ line: next, ...(seq === undefined ? {} : {seq: String(seq)}), ...(mode === "2d" ? { view: "2d" } : {}) });
  }
  async function control(action: string) {
    if (!session || !line || busy || history !== null) return;
    const run = generation.current;
    setBusy(true);
    setError("");
    try {
      // The stream owns replacement order; control response must not race it.
      await runtimeRequest(
        session,
        `/worldlines/${encodeURIComponent(line)}/control/${action}`,
        undefined,
        "POST",
      );
    } catch (e) {
      if (run === generation.current) {
        setError(failMessage(e));
        if (e instanceof RuntimeError && [401, 403].includes(e.status)) {
          setFrame(undefined);
          setLines([]);
          current.current = undefined;
        }
      }
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  const p = frame?.projection,
    actorId = p
      ? actor in p.agents
        ? actor
        : p.actor_id || Object.keys(p.agents)[0] || ""
      : "";
  return (
    <RuntimeMonitor
      world={world}
      frame={frame}
      session={session}
      lines={lines}
      line={line}
      role={role}
      history={history}
      busy={busy}
      error={error}
      connection={connection}
      online={online}
      actor={actorId}
      onActor={setActor}
      onLine={switchLine}
      onForked={async next => {
        if (!session) return;
        setLines(await runtimeRequest<Worldline[]>(session, '/worldlines'));
        switchLine(next);
      }}
      onRole={switchRole}
      onHistory={setHistory}
      onControl={control}
      onReturnToReview={fromReview && role === "creator_observer" ? () => navigate(-1) : undefined}
      onReconnect={() => {
        ++generation.current;
        setFrame(undefined);
        setSession(undefined);
        setCycle((n) => n + 1);
      }}
    />
  );
}
