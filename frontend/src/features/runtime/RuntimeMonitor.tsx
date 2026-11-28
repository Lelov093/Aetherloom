import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  Flag,
  Shield,
  Info,
} from "lucide-react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { MonitorFrame } from "../simulation/MonitorFrame";
import { useMonitorLayout } from "../simulation/useMonitorLayout";
type AcademyViewportProps = {
  frame: Envelope;
  place: string;
  actor: string;
  follow: boolean;
  onActor: (id: string) => void;
  onExit: (id: string) => void;
};
type LibraryViewportProps = Pick<AcademyViewportProps, "frame" | "actor" | "onActor" | "onExit">;
type GodotAcademyViewportProps = AcademyViewportProps & {
  assetVersion: string;
  onText: () => void;
  onCompatibility: () => void;
};

const loadAcademy = import.meta.glob<{ AcademyViewport: ComponentType<AcademyViewportProps> }>(
  "./AcademyViewport.tsx",
)["./AcademyViewport.tsx"];
const AcademyViewport = loadAcademy
  ? lazy(() => loadAcademy().then((m) => ({ default: m.AcademyViewport })))
  : undefined;
const loadGodotLibrary = import.meta.glob<{ GodotLibraryViewport: ComponentType<LibraryViewportProps> }>(
  "./GodotLibraryViewport.tsx",
)["./GodotLibraryViewport.tsx"];
const GodotLibraryViewport = loadGodotLibrary
  ? lazy(() => loadGodotLibrary().then((m) => ({ default: m.GodotLibraryViewport })))
  : undefined;
const loadGodotAcademy = import.meta.glob<{ GodotAcademyViewport: ComponentType<GodotAcademyViewportProps> }>(
  "./GodotAcademyViewport.tsx",
)["./GodotAcademyViewport.tsx"];
const GodotAcademyViewport = loadGodotAcademy
  ? lazy(() => loadGodotAcademy().then((m) => ({ default: m.GodotAcademyViewport })))
  : undefined;
import { RuntimeCommands } from "./RuntimeCommands";
import { ObservationLabels, RuntimeRunSettings } from './RuntimeRunSettings';
import { RuntimeModelBudget } from './RuntimeModelBudget';
import { ReopenDifferences } from './ReopenDifferences';
import { RulingInspection } from './RuntimeAdjudication';
import { OpeningInspection } from "./OpeningReadiness";
import { SocialInspector, executionText } from './SocialInspector';
import { RuntimeLineageTools } from './RuntimeLineageTools';
import { RuntimeObservationExport } from './RuntimeObservationExport';
import { RuntimeReplay } from './RuntimeReplay';
import { RuntimeTranscript } from './RuntimeTranscript';
import { eventText, eventTitle, reasons } from './eventText';
import { PerceptionSummary } from "./PerceptionPreparation";
import {
  displayName,
  perceptionText,
  evidenceText,
  openingLabels,
  purposeNames,
  scenarioPeriodLabel,
  runtimeRequest,
  RuntimeError,
  type Envelope,
  type HostSession,
  type Worldline,
  type Role,
  type OpeningCitation,
  type PremiseSource,
  type RuntimeEvent,
} from "./api";
import "./academy.css";
import.meta.glob("./godot-library.css", { eager: true });

export function RuntimeMonitor({
  world,
  frame,
  session,
  lines,
  line,
  role,
  spoilerFree,
  onSpoilerFree,
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
  returnTo,
  onReconnect,
}: {
  world: string;
  frame?: Envelope;
  session?: HostSession;
  lines: Worldline[];
  line: string | null;
  role: Role;
  spoilerFree: boolean;
  onSpoilerFree: (value: boolean) => void;
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
  returnTo?: { label: string; goBack: () => void };
  onReconnect: () => void;
}) {
  const layout = useMonitorLayout(), [params, setParams] = useSearchParams();
  const [place, setPlace] = useState(""),
    [follow, setFollow] = useState(false),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [selection, setSelection] = useState<{ event: RuntimeEvent; scope: string; line: string }>();
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
  const [messageScope, setMessageScope] = useState('all');
  const [submittedCursor, setSubmittedCursor] = useState('');
  const moveRequest = useRef<unknown>(undefined);
  const [reveal, setReveal] = useState<{ event: RuntimeEvent; scope: string; text?: string; error?: string; busy?: boolean }>();
  const p = frame?.projection,
    scene = p?.scene,
    academy = scene?.series_id === 'modern-academy',
    mode = academy && AcademyViewport && params.get('view') === '2d' ? '2d' : 'text',
    prepared = scene?.preparation,
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
  const commandsSynced = frame?.cursor !== submittedCursor;
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
    setSelection(undefined);
    setReveal(undefined);
    setMessageScope('all');
    setHistoryMode('log');
    setPlace("");
    setFollow(false);
    setDialog("");
    setDestination("");
    moveRequest.current = undefined;
    setMoveError("");
    setSubmittedCursor('');
  }, [line, session?.viewer_scope]);
  function selectEvent(event: RuntimeEvent) {
    if (!p) return;
    setSelection({ event, scope: p.viewer_scope, line: p.worldline_id });
    setTab("inspect");
    layout.set({ inspector: true, ...(layout.narrow ? { log: false } : {}) });
    if (
      event.location_id &&
      event.location_id in (scene?.places || {}) &&
      p?.role !== "participant"
    )
      setPlace(event.location_id);
  }
  function chooseActor(id: string) {
    onActor(id);
    setSelection(undefined);
    layout.set({ inspector: true });
  }
  function citationLink(source: OpeningCitation) {
    const index = scene?.materials?.findIndex(row => row.node_id === source.node_id && row.version === source.version &&
      row.start === source.start && row.end === source.end) ?? -1;
    return p && index >= 0 ? <Link className="runtime-origin-link" to={`/worlds/${world}/create/source?${new URLSearchParams({
      worldline: p.worldline_id, index: String(index),
      ...(p.historical && p.seq !== null ? { seq: String(p.seq) } : {}),
    })}`}>查看冻结依据 · {scene?.materials?.[index].title} · v{source.version}</Link> : `冻结依据 · v${source.version}`;
  }
  function jumpToStep(source: PremiseSource) {
    if (p?.worldline_id === source.worldline_id) onHistory(source.seq);
    else onLine(source.worldline_id, source.seq);
  }
  function premiseAnchor(source: PremiseSource) {
    return <button type="button" className="text-link" onClick={() => jumpToStep(source)}>回到确定依据的第 {source.seq} 步</button>;
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
  const events = frame?.events || [];
  const selectedEvent = selection && p && selection.scope === p.viewer_scope && selection.line === p.worldline_id
    && (!p.historical || (selection.event.seq ?? 0) <= (p.seq ?? 0)) ? selection.event : undefined;
  const selected = selectedEvent?.event_id;
  const gatedReveal = reveal && p?.spoiler_free && reveal.scope === p.viewer_scope ? reveal : undefined;
  async function requestReveal() {
    if (!gatedReveal || !session || !p || gatedReveal.event.seq == null) return;
    const pending = gatedReveal;
    setReveal({ ...pending, busy: true });
    try {
      const result = await runtimeRequest<{ event_id: string; text: string }>(session,
        `/worldlines/${encodeURIComponent(p.worldline_id)}/messages/${pending.event.seq}/reveal`, undefined, 'POST');
      if (result.event_id !== pending.event.event_id) throw new Error('event_changed');
      setReveal(value => value?.scope === pending.scope && value.event.event_id === result.event_id
        ? { ...value, text: result.text, busy: false } : value);
    } catch {
      setReveal(value => value?.scope === pending.scope && value.event.event_id === pending.event.event_id
        ? { ...value, busy: false, error: '暂时无法查证这条原话。' } : value);
    }
  }
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
        aria-label={returnTo?.label ?? "返回世界线列表"}
        title={returnTo?.label ?? "返回世界线列表"}
        onClick={returnTo?.goBack ?? (() => setParams({}))}
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
      {p?.seq != null && <span className="monitor-step">第{p.seq}步{p.run && ` · 时刻 ${p.sim_time_tick}`}</span>}
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
      {frame&&session&&line&&<RuntimeReplay world={world} line={line} frame={frame} session={session} history={history} onHistory={onHistory} onActor={chooseActor} onPlace={id=>setPlace(id)} onInspect={selectEvent} onSource={()=>{setTab('source');layout.set({inspector:true});}}/>}
    </> : (
    <>
      <div className="runtime-log-mode" role="tablist" aria-label="模拟历史入口">
        <button role="tab" aria-selected={true} onClick={()=>setHistoryMode('log')}>世界日志</button>
        {p?.role === 'creator_observer' && <button role="tab" aria-selected={false} onClick={()=>setHistoryMode('replay')}>Replay</button>}
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
                  {eventTitle(e)}
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
        ) : tab === "source" && p.spoiler_free ? (
          <p>防泄底已开启，整份冻结资料与角色内幕暂时隐藏。</p>
        ) : tab === "source" ? (
          <>
            <h2>本次世界线的来源</h2>
            <span className="academy-purpose">
              {purposeNames[scene?.purpose || ""] || "既有 Runtime · 未分类"}
            </span>
            <p>
              场景来源：
              {academy
                ? "学院与周边街区 · v" + scene.series_version
                : prepared ? "作者准备的文本起点" : "既有冻结起点"}
            </p>
            {scene?.reopen && <ReopenDifferences difference={scene.reopen} world={world} line={p.worldline_id} />}
            {prepared && <div>
              <h3>冻结开场 · {openingLabels[prepared.opening.mode]}</h3>
              <p>{prepared.opening.location_name} · {prepared.opening.time || '未标注时间'}</p>
              {prepared.opening.anchor && <p>接续 {prepared.opening.anchor.path} · v{prepared.opening.anchor.version}</p>}
              {prepared.opening.situation && <p className="sim-source-text">{prepared.opening.situation}</p>}
              <p>背景时期 · {scenarioPeriodLabel(prepared.period)}</p>
              {prepared.origin && <p>发起章幕 · <Link className="runtime-origin-link" to={`/worlds/${world}/create?${new URLSearchParams({
                  work: prepared.origin.work_id, node: prepared.origin.id, mode: 'read',
                })}`}>{prepared.origin.path}</Link></p>}
              {prepared.readiness && <details>
                <summary>冻结的开局检查与角色输入</summary>
                <OpeningInspection check={prepared.readiness} citation={citationLink} />
              </details>}
              {p.premises && <details>
                <summary>本线往事与关键未知</summary>
                <ul className="opening-input-list">
                  {Object.entries(p.premises.ordinary).map(([id, past]) => <li key={id}>
                    <strong>{past.text}</strong>
                    <small>{p.premises?.resolved[id] ? '已成立的本线往事' : '已授权，尚未补充'} · 亲历者 {past.witnesses.map(name).join('、')}</small>
                    {p.premises?.resolved[id] && premiseAnchor(p.premises.resolved[id].source)}
                  </li>)}
                  {Object.entries(p.premises.unknowns).map(([id, entry]) => {
                    const resolved = p.premises?.resolved[id];
                    return <li key={id}>
                      <strong>{entry.title}</strong>
                      <small>{resolved ? '答案已确定' : entry.may_resolve ? '已授权 · 答案留白' : '未授权 · 答案留白'}</small>
                      {resolved && <><p>{resolved.text}</p>{premiseAnchor(resolved.source)}</>}
                    </li>;
                  })}
                </ul>
              </details>}
              <details open>
                <summary>冻结的关联范围 · {prepared.scope.length} 项</summary>
                {prepared.scope.map(item => <p key={item.key}><strong>{item.title} · v{item.version}</strong><br />
                  <small>{item.reasons.join(' · ')}</small></p>)}
              </details>
            </div>}
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
                {scene.materials.map((material, index) => (
                  <p key={`${material.node_id}:${material.version}:${index}`}>
                    {material.work_title} / {material.title} · v{material.version}
                    <br />
                    <small>
                      {material.purpose === "author_reference"
                        ? "作者参考，未自动交给角色"
                        : "已配置为角色可知资料"}
                    </small>
                    <Link to={`/worlds/${world}/create/source?${new URLSearchParams({
                      worldline: p.worldline_id,
                      index: String(index),
                      ...(p.historical && p.seq !== null ? { seq: String(p.seq) } : {}),
                      ...(mode === "2d" ? { view: "2d" } : {}),
                    })}`}>
                      查看冻结版本与选区
                    </Link>
                    {" · "}
                    <a
                      href={`#/worlds/${world}/create?work=${material.work_id}&node=${material.node_id}&mode=read`}
                    >
                      打开当前资料
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
                  <li key={id}>{name(id)} · {name(location)}{academy && ` · 外观 ${(scene.actors[id]?.avatar ?? 0) + 1}`}
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
                {scene.initial_setup.perception && <PerceptionSummary layout={scene.initial_setup.perception} nameOf={name} />}
              </details>
            )}
            <p>世界线起点保留保存时的作品与模板版本。</p>
          </>
        ) : selectedEvent ? (
          <>
            <span className="eyebrow">
              {selectedEvent.seq ? `第${selectedEvent.seq}步` : "角色经历"}
            </span>
            <h2>{eventTitle(selectedEvent)}{selectedEvent.message_kind && selectedEvent.message_kind !== 'premise' && ' · 原话与出处'}</h2>
            {selectedEvent.message_kind && selectedEvent.message_kind !== 'premise' && <p>{selectedEvent.actor_id ? name(selectedEvent.actor_id) : '场景'}
              {selectedEvent.recipient_ids?.length ? ` → ${selectedEvent.recipient_ids.map(name).join('、')}` : ''}</p>}
            {selectedEvent.action_type === 'speak' && selectedEvent.accepted && <h3>角色陈述</h3>}
            {selectedEvent.decision_source && <p>角色自主 · {selectedEvent.decision_source === 'rules' ? '无模型规则调度' : '模型决策'}</p>}
            {selectedEvent.ruling ? <RulingInspection p={p} event={selectedEvent} onSource={jumpToStep} /> : selectedEvent.concealed ? <Button onClick={() => {
              setReveal({ event: selectedEvent, scope: p.viewer_scope });
              if (layout.narrow) layout.set({ inspector: false });
            }}>{selectedEvent.message_kind === 'premise' ? '查证答案' : '查证原话'}</Button> : selectedEvent.message_kind === 'premise' ? null : selectedEvent.message_kind
              ? <blockquote className="transcript-quote">{eventText(frame!, selectedEvent)}</blockquote>
              : <p>{eventText(frame!, selectedEvent)}</p>}
            {selectedEvent.expression && <div className="runtime-expression">
              <h3>{{ original: '原作依据', line_past: '本线补充', key_unknown: '本线关键未知' }[selectedEvent.expression.kind]}</h3>
              {selectedEvent.expression.kind === 'key_unknown' && <strong>{selectedEvent.expression.title}</strong>}
              <p>{selectedEvent.expression.text}</p>
              {selectedEvent.expression.kind === 'original' ? citationLink(selectedEvent.expression.citation)
                : selectedEvent.expression.source.worldline_id === p.worldline_id && selectedEvent.expression.source.seq === selectedEvent.seq
                  ? <small>本步确定</small> : premiseAnchor(selectedEvent.expression.source)}
            </div>}
            {selectedEvent.location_id && (
              <p>记录发生地：{name(selectedEvent.location_id)}</p>
            )}
            {selectedEvent.message_kind === 'scene' && <p>接收范围 · 在场角色</p>}
            <ObservationLabels hits={selectedEvent.observations} />
            {selectedEvent.seq != null && p.role !== "participant" && (
              <Button onClick={() => onHistory(selectedEvent.seq!)}>
                查看这一步的历史状态
              </Button>
            )}
            {selectedEvent.seq!=null&&p.role==='creator_observer'&&p.capabilities.includes('observation_export')&&session&&<RuntimeObservationExport key={`${p.worldline_id}:${selectedEvent.event_id}:${session.viewer_scope}`} session={session} world={world} line={p.worldline_id} seq={selectedEvent.seq} eventOptions={events.filter(event=>event.seq!=null).map(event=>({seq:event.seq!,label:eventText(frame!,event),logicalTick:event.sim_time_after}))} connected={Boolean(online&&["实时同步已连接","历史状态 · 只读"].includes(connection))}/>}
          </>
        ) : person ? (
          <>
            {academy && AcademyViewport && (
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
            {person.waiting && <p>{person.waiting.until_tick === null ? '等待本人收到新见闻' : `等待至时刻 ${person.waiting.until_tick}`}</p>}
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
                      {m.channel ? perceptionText(p, m) : m.text.startsWith("{")
                        ? "现场观察记录（仅包含当时获准信息）"
                        : m.text}
                      <small>
                        {m.channel === "sound" ? "声音证据" : m.basis === "reported"
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
                            {{ reported: '转述，不自动为真', read: '实际阅读的文本，不自动为真',
                              checked: '选定片段的字面核对结果', established: '本线已确定的前提',
                              experienced: (value as {premise_id?: string}).premise_id ? '本线补充 · 亲历' : '亲历',
                            }[(value as {basis:string}).basis] || '起点明确已知'}
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
          {dialog === 'unshield' && <Dialog title="关闭防泄底" onClose={() => setDialog('')} focusFirstInput={false}>
            <p>关闭后，消息、历史和比较会显示隐藏的原话与已确定的关键未知。</p>
            <Button variant="primary" onClick={() => { setDialog(''); onSpoilerFree(false); }}>确认关闭</Button>
          </Dialog>}
          {dialog && dialog !== 'unshield' && (
            <Dialog
              title={
                dialog === "results"
                  ? "独立世界线近期记录"
                  : dialog === "commands"
                    ? p?.role === "participant"
                      ? "角色行动"
                      : "作者介入"
                    : "起点与运行设置"
              }
              onClose={() => setDialog("")}
            >
              {dialog === "results" ? (
                frame && <>
                  {!events.length && <p>还没有可查看的近期记录。</p>}
                  {events.map(event => <article className="review-context-card" key={event.event_id}>
                    <p>{event.seq != null && `第${event.seq}步 · `}{eventText(frame, event)}</p>
                    <Button onClick={() => { setDialog(''); selectEvent(event); }}>查看{event.seq != null ? `第${event.seq}步` : '记录'}</Button>
                  </article>)}
                </>
              ) : frame && session ? (
                <>
                  <p>
                    {scene?.title || title} ·{" "}
                    {purposeNames[scene?.purpose || ""] || "未分类"}
                  </p>
                  {p?.role === "creator_observer" && dialog !== 'commands' && (
                    <p>
                      规则策略仅执行有限的已提交计划，不会自主交谈。模型策略只有在宿主另行启用并授权预算后才可使用。
                    </p>
                  )}
                  {p?.role === 'creator_observer' && !p.spoiler_free && p.capabilities.includes('autonomy') && dialog === 'settings' &&
                    <div key={`${p.worldline_id}:${session.viewer_scope}`}>
                      <RuntimeRunSettings session={session} frame={frame} connected={Boolean(connected && commandsSynced)} onCommit={setSubmittedCursor} />
                      <RuntimeModelBudget session={session} frame={frame} connected={Boolean(connected && commandsSynced)} onCommit={setSubmittedCursor} />
                    </div>}
                  {(p?.role === "participant" ||
                    p?.capabilities.includes("intervene")) && (
                    <RuntimeCommands
                      session={session}
                      frame={frame}
                      connected={Boolean(connected && commandsSynced)}
                      authorOnly={p?.role === 'creator_observer' && dialog === 'commands'}
                      onCommit={setSubmittedCursor}
                    />
                  )}
                </>
              ) : (
                <p>尚未读取世界状态。</p>
              )}
            </Dialog>
          )}
          {gatedReveal && <Dialog title={gatedReveal.event.message_kind === 'premise' ? '查证本线答案' : '查证这条原话'} busy={gatedReveal.busy} onClose={() => setReveal(undefined)} focusFirstInput={false}>
            {gatedReveal.text !== undefined ? <blockquote className="transcript-quote">{gatedReveal.text}</blockquote>
              : <p>查看可能提前得知尚未揭晓的情节。此次查证只打开当前这条记录。</p>}
            {gatedReveal.error && <ErrorNotice>{gatedReveal.error}</ErrorNotice>}
            {gatedReveal.text === undefined && <Button variant="primary" disabled={gatedReveal.busy}
              onClick={() => void requestReveal()}>{gatedReveal.event.message_kind === 'premise' ? '确认查看答案' : '确认查看原话'}</Button>}
          </Dialog>}
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
          {academy ? " · 学院系列" : ""}
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
        {AcademyViewport && godotEnabled && scene?.asset_version === "academy-art-v1" && (
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
        {academy && AcademyViewport && <div className="academy-modes" role="tablist" aria-label="世界表现模式">
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
        </div>}
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
      ) : mode === "2d" && scene && AcademyViewport ? (
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
          {godot && GodotAcademyViewport ? (
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
      ) : session && p && <RuntimeTranscript key={`${p.worldline_id}:${p.viewer_scope}:${p.historical ? p.seq : 'live'}`}
        frame={frame} session={session} title={title} selected={selected} filter={messageScope} onFilter={setMessageScope} onSelect={selectEvent} onSpoiler={() => {
          if (spoilerFree) setDialog('unshield');
          else onSpoilerFree(true);
        }} />}
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
            disabled={!connected || busy || !commandsSynced || p.conflict_pending}
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
            {p.control.status === "running" ? "暂停" : p.run?.settings.mode === 'segment' ? '推进一段' : '继续'}
          </button>
        ) : p?.role === "participant" ? (
          <button onClick={() => setDialog("commands")}>角色行动</button>
        ) : null}
        {p?.role === 'creator_observer' && !p.historical && (p.capabilities.includes('adjudicate') || p.conflict_pending) &&
          <button onClick={() => setDialog('commands')}>{p.conflict_pending ? '处理冲突' : '作者介入'}</button>}
        {mode === "2d" && <button aria-pressed={follow} onClick={() => setFollow(v => !v)}>跟随角色</button>}
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
