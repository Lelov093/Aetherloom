import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps, type ComponentType } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Grid2X2,
  MapPin,
  Play,
  Pause,
  PanelLeft,
  PanelRight,
  Ellipsis,
  FolderOpen,
  Eye,
  MessageCircle,
  Footprints,
  Flag,
  Shield,
  Info,
} from "lucide-react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { MonitorFrame } from "../simulation/MonitorFrame";
import { useMonitorLayout } from "../simulation/useMonitorLayout";
const AcademyViewport = lazy(() =>
  import("./AcademyViewport").then((m) => ({ default: m.AcademyViewport })),
);
type LibraryViewportProps = Pick<ComponentProps<typeof AcademyViewport>, "frame" | "actor" | "onActor" | "onExit">;
const loadGodotLibrary = import.meta.glob<{ GodotLibraryViewport: ComponentType<LibraryViewportProps> }>(
  "./GodotLibraryViewport.tsx",
)["./GodotLibraryViewport.tsx"];
const GodotLibraryViewport = loadGodotLibrary
  ? lazy(() => loadGodotLibrary().then((m) => ({ default: m.GodotLibraryViewport })))
  : undefined;
const GodotAcademyViewport = lazy(() =>
  import("./GodotAcademyViewport").then((m) => ({
    default: m.GodotAcademyViewport,
  })),
);
import { RuntimeCommands } from "./RuntimeCommands";
import { SocialInspector, executionText } from './SocialInspector';
import { RuntimeLineageTools, RuntimeReviewResults } from './RuntimeLineageTools';
import { RuntimeObservationExport } from './RuntimeObservationExport';
import { RuntimeReplay } from './RuntimeReplay';
import {
  displayName,
  evidenceText,
  purposeNames,
  runtimeRequest,
  RuntimeError,
  type Envelope,
  type HostSession,
  type Worldline,
  type Role,
  type RuntimeEvent,
} from "./api";
import "./academy.css";
import.meta.glob("./godot-library.css", { eager: true });

const actionNames: Record<string, string> = {
  read:'阅读冻结文本', compare:'核对文本片段',
  speak: "交谈",
  observe: "观察",
  move: "移动",
  take: "拾取",
  transfer: "交接",
  wait: "等待",
  goal: "目标变化",
  cognition: "认知更新",
  environment: "环境调整",
  relocate: "场景调整",
  scene_event: "场景事件",
  schedule: "安排事件",
  trigger: "定时事件",
  advance_idle: "等待唤醒 · 推进一个逻辑量子",
};
const reasons: Record<string, string> = {
  entry_requires_item: "未满足进入地点所需物品条件",
  not_connected: "地点之间不可直接通行",
  item_not_available: "物品不在当前地点",
  item_not_owned: "角色未持有该物品",
  recipient_not_colocated: "接收者不在同一地点",
};
export function eventText(frame: Envelope, event: RuntimeEvent) {
  const p = frame.projection,
    name = displayName(p, event.actor_id),
    a = event.args || {};
  if (!event.accepted)
    return `${name}的行动被拒绝：${reasons[event.reason_code || ""] || event.reason_code || "规则未满足"}。`;
  if (event.action_type === "speak")
    return `${name}：${event.text || a.speech || "已提交交谈"}`;
  if (event.action_type === "move" && a.destination_id)
    return `${name}从${displayName(p, event.location_id)}前往${displayName(p, String(a.destination_id))}。`;
  if (event.action_type === "goal")
    return `${name}调整了自身目标${a.goal ? `：${a.goal}` : "。"}`;
  if (["scene_event", "trigger"].includes(event.action_type))
    return event.text || "一项场景事件已发生。";
  return `${name} · ${actionNames[event.action_type] || event.action_type}${event.action_type === "cognition" ? "（暂定信念／计划，不是世界事实）" : ""}`;
}

export function RuntimeMonitor({
  world,
  frame,
  session,
  lines,
  line,
  role,
  history,
  busy,
  connection,
  error,
  online,
  actor,
  onActor,
  onLine,
  onForked,
  onRole,
  onHistory,
  onControl,
  onReturnToReview,
  onReconnect,
}: {
  world: string;
  frame?: Envelope;
  session?: HostSession;
  lines: Worldline[];
  line: string | null;
  role: Role;
  history: number | null;
  busy: boolean;
  connection: string;
  error: string;
  online: boolean;
  actor: string;
  onActor: (id: string) => void;
  onLine: (id: string, seq?: number) => void;
  onForked: (id: string) => Promise<void>;
  onRole: (role: Role) => void;
  onHistory: (seq: number | null) => void;
  onControl: (action: string) => void;
  onReturnToReview?: () => void;
  onReconnect: () => void;
}) {
  const layout = useMonitorLayout(),
    [params, setParams] = useSearchParams(),
    mode = params.get("view") === "2d" ? "2d" : "text";
  const [place, setPlace] = useState(""),
    [follow, setFollow] = useState(false),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const [godotEnabled, setGodotEnabled] = useState(false);
  const comparison = godotEnabled && params.get("renderer") === "godot";
  useEffect(() => {
    if (!GodotLibraryViewport) return;
    let active = true;
    window.aetherloomRuntime
      ?.experiments?.()
      .then((c) => {
        if (active) setGodotEnabled(c.godotLibrary);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [tab, setTab] = useState("inspect"),
    [historyMode, setHistoryMode] = useState<'log'|'replay'>('log'),
    [dialog, setDialog] = useState(""),
    [destination, setDestination] = useState(""),
    [moveBusy, setMoveBusy] = useState(false),
    [moveError, setMoveError] = useState("");
  const moveRequest = useRef<unknown>(undefined),
    feed = useRef<HTMLDivElement>(null),
    [latest, setLatest] = useState(true);
  const p = frame?.projection,
    scene = p?.scene,
    person = p?.agents[actor],
    name = (id: string | null | undefined) =>
      p ? displayName(p, id) : id || "世界";
  const godot =
    scene && scene.asset_version !== "academy-art-v1" &&
    params.get("renderer") !== "three";
  function showText() {
    setParams((value) => {
      value.delete("view");
      return value;
    }, { replace: true });
  }
  const connected =
    online &&
    connection === "实时同步已连接" &&
    history === null &&
    p &&
    !p.historical;
  const activePlace =
    p?.role === "participant"
      ? p.agents[p.actor_id!].location
      : follow && person
        ? person.location
        : place in (p?.world.place_topology || {})
          ? place
          : person?.location ||
            Object.keys(p?.world.place_topology || {})[0] ||
            "";
  useEffect(() => {
    setSelected("");
    setPlace("");
    setFollow(false);
    setDialog("");
    setDestination("");
    moveRequest.current = undefined;
    setMoveError("");
  }, [line, session?.viewer_scope]);
  useEffect(() => {
    if (latest && mode === "text" && feed.current)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [frame?.events.length, latest, mode]);
  function selectEvent(event: RuntimeEvent) {
    setSelected(event.event_id);
    setTab("inspect");
    layout.set({ inspector: true });
    setLatest(false);
    if (
      event.location_id &&
      event.location_id in (scene?.places || {}) &&
      p?.role !== "participant"
    )
      setPlace(event.location_id);
    requestAnimationFrame(() =>
      document
        .getElementById(`experience-event-${event.event_id}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  function chooseActor(id: string) {
    onActor(id);
    setSelected("");
    layout.set({ inspector: true });
  }
  function chooseExit(id: string) {
    if (!p) return;
    if (p.role === "participant") {
      if (!p.world.place_topology[activePlace]?.includes(id)) return;
      setDestination(id);
      setMoveError("");
    } else if (id in p.world.place_topology) setPlace(id);
  }
  async function move() {
    if (!session || !frame || !connected) return;
    setMoveBusy(true);
    setMoveError("");
    try {
      moveRequest.current ||= {
        cursor: frame.cursor,
        request_id: crypto.randomUUID(),
        action_type: "move",
        args: { destination_id: destination },
      };
      const receipt = await runtimeRequest<{
        status: string;
        reason_code: string;
      }>(
        session,
        `/worldlines/${encodeURIComponent(p!.worldline_id)}/actions`,
        undefined,
        "POST",
        moveRequest.current,
      );
      moveRequest.current = undefined;
      if (receipt.status === "committed") setDestination("");
      else
        setMoveError(
          reasons[receipt.reason_code] || receipt.reason_code || receipt.status,
        );
    } catch (e) {
      if (e instanceof RuntimeError) moveRequest.current = undefined;
      setMoveError("移动未确认，可重试同一请求。" + (e as Error).message);
    } finally {
      setMoveBusy(false);
    }
  }
  const events = frame?.events || [],
    selectedEvent = events.find((e) => e.event_id === selected);
  const filtered = events.filter(
    (e) =>
      (filter === "all" ||
        (filter === "speech"
          ? e.action_type === "speak"
          : filter === "blocked"
            ? !e.accepted
            : filter === "changes"
              ? e.accepted &&
                !["observe", "wait", "speak"].includes(e.action_type)
              : e.accepted && e.action_type !== "speak")) &&
      (!query ||
        eventText(frame!, e).toLowerCase().includes(query.toLowerCase())),
  );
  const title =
    scene?.title ||
    lines.find((l) => l.worldline_id === line)?.title ||
    "世界模拟";
  const header = (
    <div className="simulation-context academy-context">
      <button
        className="monitor-icon"
        aria-label={onReturnToReview ? "返回审阅" : "返回世界线列表"}
        title={onReturnToReview ? "返回审阅" : "返回世界线列表"}
        onClick={onReturnToReview ?? (() => setParams({}))}
      >
        <ArrowLeft size={18} />
      </button>
      <select
        className="sim-session-picker"
        aria-label="当前世界线"
        value={line || ""}
        onChange={(e) => onLine(e.target.value)}
      >
        <option value="" disabled>
          选择世界线
        </option>
        {lines.map((l) => (
          <option key={l.worldline_id} value={l.worldline_id}>
            {l.parent_worldline_id ? "↳ " : ""}{l.title || l.worldline_id}
          </option>
        ))}
      </select>
      <span className="monitor-status">
        {p ? executionText(p) : '正在读取'}
      </span>
      {p?.seq != null && <span className="monitor-step">第{p.seq}步</span>}
      <button
        className="monitor-icon"
        aria-label="起点与运行设置"
        onClick={() => setDialog("settings")}
      >
        <Info size={17} />
      </button>
      <select
        aria-label="观察权限"
        value={role}
        onChange={(e) => onRole(e.target.value as Role)}
      >
        <option value="creator_observer">作者观察</option>
        <option value="observer">观察者</option>
        {(p?.capabilities.includes("participate") ||
          role === "participant") && (
          <option value="participant">角色参与</option>
        )}
      </select>
    </div>
  );
  const log = historyMode === 'replay' ? <>
      <div className="runtime-log-mode" role="tablist" aria-label="模拟历史入口">
        <button role="tab" aria-selected={false} onClick={()=>setHistoryMode('log')}>世界日志</button>
        <button role="tab" aria-selected={true} onClick={()=>setHistoryMode('replay')}>Replay</button>
      </div>
      {frame&&session&&line&&<RuntimeReplay world={world} line={line} frame={frame} session={session} history={history} onHistory={onHistory} onActor={chooseActor} onPlace={id=>setPlace(id)} onSource={()=>{setTab('source');layout.set({inspector:true});}}/>}
    </> : (
    <>
      <div className="runtime-log-mode" role="tablist" aria-label="模拟历史入口">
        <button role="tab" aria-selected={true} onClick={()=>setHistoryMode('log')}>世界日志</button>
        <button role="tab" aria-selected={false} onClick={()=>setHistoryMode('replay')}>Replay</button>
      </div>
      <div className="monitor-log-tabs" role="tablist" aria-label="日志类别">
        {[
          ["all", "全部"],
          ["speech", "对话"],
          ["action", "行动"],
          ["changes", "变化"],
          ["blocked", "未成立"],
        ].map(([id, label]) => (
          <button
            role="tab"
            key={id}
            aria-selected={filter === id}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="academy-log-search">
        <span className="sr-only">搜索世界日志</span>
        <input
          placeholder="搜索记录…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="monitor-log-scroll">
        {filtered.map((e) => (
          <button
            key={e.event_id}
            className={`monitor-log-row ${selected === e.event_id ? "is-selected" : ""} ${e.actor_id === actor ? "is-related" : ""} ${!e.accepted ? "is-blocked" : ""}`}
            onClick={() => selectEvent(e)}
          >
            <span className="log-sequence">
              {e.seq ? String(e.seq).padStart(2, "0") : "·"}
            </span>
            <span className="log-node">
              {!e.accepted ? (
                <Shield size={16} />
              ) : e.action_type === "speak" ? (
                <MessageCircle size={16} />
              ) : e.action_type === "move" ? (
                <MapPin size={16} />
              ) : (
                <Flag size={16} />
              )}
            </span>
            <span className="log-content">
              <span className="log-summary">{eventText(frame!, e)}</span>
              <span className="log-tags">
                <span>
                  {e.accepted
                    ? actionNames[e.action_type] || e.action_type
                    : "规则阻止"}
                </span>
                <span>{name(e.actor_id)}</span>
                {e.location_id && <span>{name(e.location_id)}</span>}
              </span>
            </span>
          </button>
        ))}
        {!filtered.length && (
          <p className="monitor-empty">
            {events.length ? "没有匹配的记录。" : "尚无已提交事件。"}
          </p>
        )}
      </div>
      <small className="academy-pane-note">
        {events.length} 条近期记录 ·{" "}
        {purposeNames[scene?.purpose || ""] || "未分类"}
      </small>
    </>
  );
  const inspector = (
    <>
      <div
        className="monitor-inspector-tabs"
        role="tablist"
        aria-label="模拟详情内容"
      >
        <button
          role="tab"
          aria-selected={tab === "inspect"}
          onClick={() => setTab("inspect")}
        >
          检视
        </button>
        <button
          role="tab"
          aria-selected={tab === "source"}
          onClick={() => setTab("source")}
        >
          来源
        </button>
      </div>
      <div className="monitor-inspector-body academy-inspector">
        {!p ? (
          <p>读取授权世界后可选择角色或事件。</p>
        ) : tab === "source" ? (
          <>
            <h2>本次世界线的来源</h2>
            <span className="academy-purpose">
              {purposeNames[scene?.purpose || ""] || "既有 Runtime · 未分类"}
            </span>
            <p>
              场景来源：
              {scene
                ? "学院与周边街区 · v" + scene.series_version
                : "既有冻结起点"}
            </p>
            {scene?.sources?.[actor] ? (
              <p>
                角色来源：已冻结作品对象 v{scene.sources[actor].entity_version}
                <br />
                <small>{scene.sources[actor].entity_id}</small>
                <a
                  href={`#/worlds/${world}/create/objects/${scene.sources[actor].entity_id}`}
                >
                  查看当前作品对象（非本线冻结快照）
                </a>
              </p>
            ) : (
              <p>
                {p.role === "creator_observer"
                  ? "角色来源：模板／本次手工配置"
                  : "当前权限不提供角色绑定来源"}
              </p>
            )}
            {p.role === "creator_observer" && scene?.materials?.length ? (
              <div>
                <h3>本次选定资料</h3>
                {scene.materials.map((material) => (
                  <p key={`${material.node_id}:${material.version}`}>
                    {material.work_title} / {material.title} · v{material.version}
                    <br />
                    <small>
                      {material.purpose === "author_reference"
                        ? "作者参考，未自动交给角色"
                        : "已配置为角色可知资料"}
                    </small>
                    <a
                      href={`#/worlds/${world}/create?work=${material.work_id}&node=${material.node_id}&mode=read`}
                    >
                      返回资料阅读
                    </a>
                  </p>
                ))}
              </div>
            ) : null}
            {scene?.background && (
              <details>
                <summary>作者背景参考</summary>
                <p>{scene.background}</p>
              </details>
            )}
            {scene?.adaptations && (
              <details open>
                <summary>模板新增与本次覆盖</summary>
                <p>{scene.adaptations}</p>
              </details>
            )}
            {p.role === "creator_observer" && scene?.initial_setup && (
              <details className="academy-start-summary">
                <summary>冻结场景配置</summary>
                <p>资源版本 · {scene.asset_version}</p>
                <h3>角色初始位置</h3>
                <ul>{Object.entries(scene.initial_setup.role_locations).map(([id, location]) => (
                  <li key={id}>{name(id)} · {name(location)} · 外观 {(scene.actors[id]?.avatar ?? 0) + 1}
                    {scene.sources?.[id] && <small>作品对象 v{scene.sources[id].entity_version}</small>}
                  </li>
                ))}</ul>
                <h3>地点与出口</h3>
                <ul>{Object.entries(scene.initial_setup.exits).map(([id, exits]) => (
                  <li key={id}>{name(id)} · {exits.map(name).join("、") || "无相邻出口"}
                    {scene.sources?.[id] && <small>作品对象 v{scene.sources[id].entity_version}</small>}
                  </li>
                ))}</ul>
                <h3>道具初始归属</h3>
                <ul>{Object.entries(scene.initial_setup.item_holders).map(([id, holder]) => (
                  <li key={id}>{name(id)} → {name(holder)}</li>
                ))}</ul>
                {scene.initial_setup.access_rules.map((rule) => (
                  <p key={`${rule.destination_id}:${rule.item_id}`}>进入{name(rule.destination_id)}需持有{name(rule.item_id)}</p>
                ))}
              </details>
            )}
            <p>
              保存后修改作品或模板，不会重新计算本线起点。结果进入 Canon
              仍需正式审阅，可在“结果记录”主动挑选提案。
            </p>
          </>
        ) : selectedEvent ? (
          <>
            <span className="eyebrow">
              {selectedEvent.seq ? `第${selectedEvent.seq}步` : "角色经历"}
            </span>
            <h2>
              {selectedEvent.accepted
                ? actionNames[selectedEvent.action_type] ||
                  selectedEvent.action_type
                : "规则阻止"}
            </h2>
            <p>{eventText(frame!, selectedEvent)}</p>
            {selectedEvent.location_id && (
              <p>记录发生地：{name(selectedEvent.location_id)}</p>
            )}
            <small>场景默认显示当前所选状态；选取记录不会偷偷还原世界。</small>
            {selectedEvent.seq != null && p.role !== "participant" && (
              <Button onClick={() => onHistory(selectedEvent.seq!)}>
                查看这一步的历史状态
              </Button>
            )}
            {selectedEvent.seq!=null&&p.role==='creator_observer'&&p.capabilities.includes('review')&&session&&<RuntimeObservationExport key={`${p.worldline_id}:${selectedEvent.event_id}:${session.viewer_scope}`} session={session} world={world} line={p.worldline_id} seq={selectedEvent.seq} eventOptions={events.filter(event=>event.seq!=null).map(event=>({seq:event.seq!,label:eventText(frame!,event),logicalTick:event.sim_time_after,actionType:event.action_type}))} connected={Boolean(online&&["实时同步已连接","历史状态 · 只读"].includes(connection))}/>}
          </>
        ) : person ? (
          <>
            {scene && (
              <div
                className="academy-portrait"
                style={{
                  backgroundImage: `url('/assets/academy/v1/characters.png')`,
                  backgroundPosition: `${(scene.actors[actor]?.avatar || 0) * 20}% 0%`,
                }}
              />
            )}
            <h2>{name(actor)}</h2>
            <span className="academy-purpose">
              {purposeNames[scene?.purpose || ""] || "未分类"}
            </span>
            <p>
              <MapPin size={14} /> 当前地点：{name(person.location)}
            </p>
            {p.capabilities.some((c) =>
              ["inspect_cognition", "inspect_own_cognition"].includes(c),
            ) &&
            (p.role !== "participant" || actor === p.actor_id) ? (
              <>
                <label>当前目标</label>
                <p className="academy-current-goal">
                  {person.goal || "未设置"}
                </p>
                {scene?.actors[actor]?.persona && (
                  <details>
                    <summary>人设</summary>
                    <p>{scene.actors[actor].persona}</p>
                  </details>
                )}
                <details>
                  <summary>经历与记忆 · {person.memories?.length || 0}</summary>
                  {person.memories?.slice(-20).map((m, i) => (
                    <p key={i}>
                      {m.text.startsWith("{")
                        ? "现场观察记录（仅包含当时获准信息）"
                        : m.text}
                      <small>
                        {m.basis === "reported"
                          ? "他人转述"
                          : m.basis === "observed"
                            ? "现场观察"
                            : "自身经历"}
                      </small>
                    </p>
                  ))}
                </details>
                {(["known", "beliefs"] as const).map((key) => (
                  <details key={key}>
                    <summary>
                      {key === "known" ? "已知信息" : "暂定信念"}
                    </summary>
                    {Object.entries(person[key] || {}).map(([id, value]) => (
                      <p key={id}>
                        {evidenceText(value)}
                        {typeof value !== "string" && (
                          <small>
                            {String((value as { basis: string }).basis) ===
                            "reported"
                              ? "转述，不自动为真"
                              : (value as {basis:string}).basis==='read' ? '实际阅读的文本，不自动为真'
                              : (value as {basis:string}).basis==='checked' ? '选定片段的字面核对结果'
                              : "起点明确已知"}
                          </small>
                        )}
                      </p>
                    ))}
                  </details>
                ))}
                <details>
                  <summary>行动计划</summary>
                  {person.committed_plans?.map((plan, i) => (
                    <p key={i}>{String(plan)}</p>
                  ))}
                </details>
                <SocialInspector p={p} actor={actor}/>
              </>
            ) : (
              <p>此观察权限不提供角色认知。</p>
            )}
          </>
        ) : (
          <h2>观察世界中的变化</h2>
        )}
        {p && (
          <>
            <h3>参与角色</h3>
            <div className="academy-inspector-people">
              {Object.keys(p.agents).map((id) => (
                <button key={id} onClick={() => chooseActor(id)}>
                  {name(id)}
                  <small>{name(p.agents[id].location)}</small>
                </button>
              ))}
            </div>
            <h3>可见物品</h3>
            {Object.entries(p.world.items).map(([id, holder]) => (
              <p key={id}>
                {name(id)}
                <small>当前归属：{name(holder)}</small>
              </p>
            ))}
            <h3>环境状态</h3>
            {Object.entries(p.world.environment || {}).length ? Object.entries(p.world.environment || {}).map(([key, value]) => (
              <p key={key}>{key}<small>{String(value)}</small></p>
            )) : <p className="runtime-muted">当前没有显式环境记录。</p>}
            <small className="academy-pane-note">
              作者观察不会改变角色知识。
            </small>
          </>
        )}
      </div>
    </>
  );
  return (
    <MonitorFrame
      className={`academy-runtime${mode === "2d" ? " academy-runtime-2d" : ""}`}
      title={title}
      layout={layout}
      header={header}
      log={log}
      inspector={inspector}
      notice={
        (error || !online || (!connected && p)) && (
          <div className="monitor-switch-status" role="status">
            {error ||
              (!online ? "连接中断，等待网络恢复；操作已停用。" : connection)}
            <Button variant="ghost" onClick={onReconnect}>
              重新连接
            </Button>
          </div>
        )
      }
      overlays={
        <>
          {dialog && (
            <Dialog
              title={
                dialog === "results"
                  ? "独立世界线近期记录"
                  : dialog === "commands"
                    ? p?.role === "participant"
                      ? "角色行动"
                      : "正式干预"
                    : "起点与运行设置"
              }
              onClose={() => setDialog("")}
            >
              {dialog === "results" ? (
                p?.role === 'creator_observer' && frame && session ? <RuntimeReviewResults key={p.worldline_id} world={world} frame={frame} session={session} connected={Boolean(online && frame && ["实时同步已连接", "历史状态 · 只读"].includes(connection))}/> : <>
                  <p>
                    {purposeNames[scene?.purpose || ""] || "未分类"} ·
                    已保存。不会自动加入原作主要待审队列。
                  </p>
                  {events.map((e) => (
                    <p key={e.event_id}>
                      {e.seq ? `第${e.seq}步 · ` : ""}
                      {eventText(frame!, e)}
                    </p>
                  ))}
                </>
              ) : frame && session ? (
                <>
                  <p>
                    {scene?.title || title} ·{" "}
                    {purposeNames[scene?.purpose || ""] || "未分类"}
                  </p>
                  {p?.role === "creator_observer" && (
                    <p>
                      规则策略仅执行有限的已提交计划，不会自主交谈。模型策略只有在宿主另行启用并授权预算后才可使用。
                    </p>
                  )}
                  {(p?.role === "participant" ||
                    p?.capabilities.includes("intervene")) && (
                    <RuntimeCommands
                      session={session}
                      frame={frame}
                      connected={Boolean(connected)}
                    />
                  )}
                </>
              ) : (
                <p>尚未读取世界状态。</p>
              )}
            </Dialog>
          )}
          {destination && (
            <Dialog
              title={`前往${name(destination)}`}
              onClose={() => {
                if (!moveBusy) {
                  setDestination("");
                  moveRequest.current = undefined;
                }
              }}
            >
              <p>移动受当前连通与通行规则裁决。确认后才提交行动。</p>
              {moveError && <ErrorNotice>{moveError}</ErrorNotice>}
              <Button
                variant="primary"
                disabled={
                  !connected || p?.control.status !== "running" || moveBusy
                }
                onClick={() => void move()}
              >
                {moveBusy ? "正在提交…" : "确认移动"}
              </Button>
              {p?.control.status !== "running" && (
                <p>世界线已暂停，需要作者先继续。</p>
              )}
            </Dialog>
          )}
        </>
      }
    >
      <header className="scene-heading">
        <div className="scene-view-label">
          <Grid2X2 size={17} />
          <h2>世界视图</h2>
        </div>
        {p && (
          <label className="scene-location">
            <MapPin size={15} />
            <select
              aria-label="查看场景地点"
              value={activePlace}
              disabled={p.role === "participant"}
              onChange={(e) => {
                setPlace(e.target.value);
                setFollow(false);
              }}
            >
              {Object.keys(p.world.place_topology).map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="scene-observer">
          {purposeNames[scene?.purpose || ""] || "独立模拟"}
          {scene ? " · 学院系列" : ""}
          {p?.lineage?.ancestors.at(-1) && <button className="runtime-parent-link" onClick={() => { const anchor = p.lineage!.ancestors.at(-1)!; onLine(anchor.worldline_id, anchor.seq); }}>查看分叉点 · 第{p.lineage.ancestors.at(-1)!.seq}步</button>}
        </span>
      </header>
      <div className="scene-participants academy-participants">
        {p &&
          Object.keys(p.agents).map((id) => (
            <button
              key={id}
              className={id === actor ? "is-selected" : ""}
              aria-pressed={id === actor}
              onClick={() => chooseActor(id)}
            >
              {name(id)}
            </button>
          ))}
        {godotEnabled && scene?.asset_version === "academy-art-v1" && (
          <select
            className="godot-renderer-select"
            aria-label="2.5D 对照渲染器"
            value={comparison ? "godot" : "three"}
            onChange={(e) => {
              const value = e.target.value;
              setParams(
                (v) => {
                  v.set("view", "2d");
                  if (value === "godot") v.set("renderer", "godot");
                  else v.delete("renderer");
                  return v;
                },
                { replace: true },
              );
              if (value === "godot" && p?.role !== "participant")
                setPlace("library");
            }}
          >
            <option value="three">Three.js</option>
            <option value="godot">Godot 对照</option>
          </select>
        )}
        <div className="academy-modes" role="tablist" aria-label="世界表现模式">
          <button
            role="tab"
            aria-selected={mode === "text"}
            onClick={showText}
          >
            文本
          </button>
          <button
            role="tab"
            aria-selected={mode === "2d"}
            disabled={!scene}
            onClick={() =>
              setParams(
                (v) => {
                  v.set("view", "2d");
                  return v;
                },
                { replace: true },
              )
            }
          >
            2.5D
          </button>
          <button
            role="tab"
            aria-selected={false}
            disabled
            title="该系列尚未提供实际 3D 资源"
          >
            3D
          </button>
        </div>
      </div>
      {p?.historical && (
        <div className="academy-history-note">
          历史状态 · 第{p.seq}步 · 只读
          <Button variant="ghost" onClick={() => onHistory(null)}>
            返回实时
          </Button>
        </div>
      )}
      {!frame ? (
        <div className="academy-empty">
          <Eye size={28} />
          <h2>{line ? "正在读取授权世界状态" : "选择一条已保存世界线"}</h2>
          <p>{error || connection}</p>
        </div>
      ) : mode === "2d" && scene ? (
        <Suspense fallback={<div className="academy-empty">正在载入场景…</div>}>
          {scene.asset_version !== "academy-art-v1" && !godot && (
            <div className="academy-history-note">
              正在使用兼容视图
              <Button
                variant="ghost"
                onClick={() =>
                  setParams(
                    (v) => {
                      v.delete("renderer");
                      return v;
                    },
                    { replace: true },
                  )
                }
              >
                返回标准场景
              </Button>
            </div>
          )}
          {godot ? (
            <GodotAcademyViewport
              key={`${p!.viewer_scope}:${line}:${scene.asset_version}`}
              frame={frame}
              assetVersion={scene.asset_version}
              place={activePlace}
              actor={actor}
              follow={follow}
              onActor={chooseActor}
              onExit={chooseExit}
              onText={showText}
              onCompatibility={() =>
                setParams(
                  (v) => {
                    v.set("renderer", "three");
                    return v;
                  },
                  { replace: true },
                )
              }
            />
          ) : comparison && GodotLibraryViewport ? (
            activePlace === "library" ? (
              <GodotLibraryViewport
                key={`${p!.viewer_scope}:${line}`}
                frame={frame}
                actor={actor}
                onActor={chooseActor}
                onExit={chooseExit}
              />
            ) : (
              <div className="academy-empty">
                <h2>本次 Godot 对照仅包含图书馆</h2>
                <p>
                  其他地点可使用 Three.js
                  或文本；角色参与时只能查看本人所在地点。
                </p>
                {p?.role !== "participant" && (
                  <Button onClick={() => setPlace("library")}>
                    查看图书馆
                  </Button>
                )}
              </div>
            )
          ) : (
            <AcademyViewport
              key={`${p!.viewer_scope}:${line}:${activePlace}`}
              frame={frame}
              place={activePlace}
              actor={actor}
              follow={follow}
              onActor={chooseActor}
              onExit={chooseExit}
            />
          )}
        </Suspense>
      ) : (
        <div
          className="scene-feed"
          ref={feed}
          tabIndex={0}
          aria-label="对话与演化记录"
        >
          <div className="scene-start">
            <span>冻结起点 · {title}</span>
            <small>同一世界线 · 表现切换不改变世界</small>
          </div>
          {!events.length && (
            <p className="monitor-empty">
              起点已保存，角色尚未开始行动。可配置运行策略，或进入角色模式提交行动。
            </p>
          )}
          {events.map((e) => (
            <article
              id={`experience-event-${e.event_id}`}
              key={e.event_id}
              className={`academy-event ${!e.accepted ? "is-blocked" : ""} ${e.event_id === selected ? "is-selected" : ""}`}
              onClick={() => selectEvent(e)}
            >
              <div>
                {!e.accepted ? (
                  <Shield size={20} />
                ) : e.action_type === "speak" ? (
                  <MessageCircle size={20} />
                ) : e.action_type === "move" ? (
                  <Footprints size={20} />
                ) : (
                  <Flag size={20} />
                )}
              </div>
              <div>
                <header>
                  <strong>{name(e.actor_id)}</strong>
                  <small>
                    {e.seq ? `第${e.seq}步` : "角色经历"}
                    {e.location_id && ` · ${name(e.location_id)}`}
                  </small>
                </header>
                <p>{eventText(frame, e)}</p>
              </div>
            </article>
          ))}
          <div className="scene-end">
            {p ? executionText(p) : '正在读取'} ·
            已提交结果已保存
          </div>
        </div>
      )}
      <footer className="monitor-dock">
        <button
          className="monitor-icon"
          aria-label="显示世界日志"
          aria-pressed={layout.layout.log}
          onClick={() => layout.set({ log: !layout.layout.log })}
        >
          <PanelLeft size={18} />
        </button>
        {p?.capabilities.includes("control") ? (
          <button
            className="dock-run"
            disabled={!connected || busy}
            onClick={() =>
              onControl(p.control.status === "running" ? "pause" : "resume")
            }
          >
            <span>
              {p.control.status === "running" ? (
                <Pause size={19} />
              ) : (
                <Play size={19} />
              )}
            </span>
            {p.control.status === "running" ? "暂停" : "继续"}
          </button>
        ) : p?.role === "participant" ? (
          <button onClick={() => setDialog("commands")}>角色行动</button>
        ) : null}
        <button
          aria-pressed={mode === "2d" ? follow : latest}
          onClick={() =>
            mode === "2d" ? setFollow((v) => !v) : setLatest((v) => !v)
          }
        >
          {mode === "2d" ? "跟随角色" : "跟随最新"}
        </button>
        <button onClick={() => setDialog("results")} disabled={!frame}>
          <FolderOpen size={16} />
          结果记录
        </button>
        {frame && session && p?.role === 'creator_observer' && <RuntimeLineageTools key={`${p.worldline_id}:${session.viewer_scope}`} world={world} frame={frame} lines={lines} session={session} connected={Boolean(online && ["实时同步已连接", "历史状态 · 只读"].includes(connection))} onCreated={onForked} onJump={onLine}/>}
        <button
          className="monitor-icon"
          aria-label="显示模拟详情"
          aria-pressed={layout.layout.inspector}
          onClick={() => layout.set({ inspector: !layout.layout.inspector })}
        >
          <PanelRight size={18} />
        </button>
        <button
          className="monitor-icon"
          aria-label="更多运行设置"
          onClick={() => setDialog("settings")}
        >
          <Ellipsis size={18} />
        </button>
      </footer>
    </MonitorFrame>
  );
}
