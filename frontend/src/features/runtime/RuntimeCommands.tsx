import { useState, useRef } from "react";
import { Button, ErrorNotice } from "../../components/ui";
import { executionText } from './SocialInspector';
import { adjudicationKinds, adjudicationLabels, adjudicationPayload, emptyAdjudication, RuntimeAdjudicationFields } from './RuntimeAdjudication';
import {
  runtimeRequest,
  displayName,
  evidenceText,
  RuntimeError,
  type Envelope,
  type HostSession,
} from "./api";

interface Props {
  session: HostSession;
  frame: Envelope;
  connected: boolean;
  authorOnly?: boolean;
  onCommit: (previousCursor: string) => void;
}
interface Receipt {
  status: string;
  reason_code?: string;
}
const messages: Record<string, string> = {
  item_text_unavailable:'该物品未配置可读片段。',
  comparison_source_unavailable:'请选择本人已经获知的两个文本来源。',
  comparison_requires_two_sources:'核对需要两个不同来源。',
  comparison_quote_mismatch:'片段必须逐字存在于所选来源中。',
  committed: "已提交，等待同步结果。",
  rule_rejected: "行动被世界规则拒绝，失败经历已保存。",
  paused: "世界线已暂停，请由创作者继续。",
  stale_state: "状态已变化，请确认当前画面后重新提交。",
  stale_view: "所见已变化，请确认当前画面后重新提交。",
  invalid_event_audience: "请重新选择场景事件的接收角色。",
  recipient_cannot_hear_words: "接收者听不清定向发言。",
  ordinary_past_unavailable: '这条往事已成立或不在当前角色的授权范围内。',
  expression_basis_unavailable: '这条依据不在角色当前已知的范围内。',
  expression_basis_conflict: '请选择一项表达依据。',
  key_unknown_unauthorized: '这条关键未知没有获准在本线确定。',
  key_unknown_already_resolved: '答案已经确定，可从记录回查。',
  candidate_unavailable: "这位候选已参与或不在本场候选范围内。",
  conflict_pending: '关键冲突正在等待作者处理。',
  conflict_resolved: '冲突已处理，可继续世界线。',
  awaiting_activity: '暂无可行动角色、定时事件或到期等待。',
  observation_pause: '观察条件已命中，可回查触发记录。',
  segment_complete: '已推进本段设定的步数。',
  worldline_switched: '切换世界线时已暂停。',
  conflict_unavailable: '这条冲突已经处理，请查看提交记录。',
  conflict_state_changed: '争用条件已变化，请核对当前状态。',
  invalid_conflict_choice: '请选择符合当时规则的角色。',
  invalid_item_conflict: '请选择有效的物品和争用角色。',
  consequence_rule_unavailable: '当前规则无法兑现这个后果，可以先搁置。',
  adjudication_requires_author_view: '关闭防泄底后可查看和处理冲突。',
  no_eligible_claimants: '参与角色均未满足拾取条件，实际归属保持不变。',
  entry_requires_item: '规则拒绝了这次尝试。查看记录可核对所需物品。',
  epoch_invalid: "运行控制已变化，请重新连接后提交。",
  zero_time_limit: "本时刻的零时间提交已达上限，需要先推进世界时间。",
  resnapshot_required: "观察凭据已过期，请重新连接。",
  autonomy_budget_exhausted: '本轮行动额度已用完。',
  model_not_enabled: '模型未配置；请先明确配置模型与费用额度。',
  'model:model_budget_exhausted': '模型请求、费用或token额度已用完。',
  'model:model_run_limit': '本线的行动、认知或运行时长已达上限。',
  'model:runtime_limit': '本线模型运行时长已达上限。',
  worldline_model_budget_required: '这条世界线尚未分配模型额度。',
  fork_model_budget_required: '分支不继承模型额度，请单独分配。',
};

const creatorScenarioPaths = [
  {
    action: 'scene_event',
    title: '场景事件',
    description: '在指定地点加入一条可观察记录，让世界线向前推进一步。',
    reason: '验证场景事件对当前世界线的影响',
  },
  {
    action: 'relocate',
    title: '角色场景调整',
    description: '把一个角色调整到另一个地点，保留其知识与经历。',
    reason: '验证角色场景调整对当前世界线的影响',
  },
] as const;

export function RuntimeCommands({ session, frame, connected, authorOnly = false, onCommit }: Props) {
  const p = frame.projection,
    participant = p.role === "participant";
  const sharedModelStop = p.model_budget?.exploration && p.control.reason.startsWith('model:');
  const [selection, setKind] = useState(participant ? "speak" : authorOnly ? 'attempt_action' : "environment");
  const kind = !participant && p.pending_conflict ? 'resolve_conflict' : selection;
  const [rulingDraft, setRulingDraft] = useState(emptyAdjudication);
  const usesRuling = adjudicationKinds.some(key => key === kind);
  const rulingPayload = adjudicationPayload(kind, p, rulingDraft);
  const [text, setText] = useState(""),
    [target, setTarget] = useState(""),
    [item, setItem] = useState("");
  const [eventAudience, setEventAudience] = useState<string[] | null>(null);
  const [hideEvent, setHideEvent] = useState(false);
  const [key, setKey] = useState("weather"),
    [value, setValue] = useState(""),
    [reason, setReason] = useState("");
  const [due, setDue] = useState("1"),
    [priority, setPriority] = useState("0");
  const [limit, setLimit] = useState("6"),
    [controlled, setControlled] = useState<string[]>([]);
  const [policyMode, setPolicyMode] = useState<"rules" | "model">(
    p.autonomy?.mode || "rules",
  );
  const modelActive = p.autonomy?.mode === "model";
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [error, setError] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [socialTurn,setSocialTurn] = useState('continue'), [acceptPromise,setAcceptPromise] = useState('');
  const [leftSource,setLeftSource]=useState(''),[rightSource,setRightSource]=useState('');
  const [leftQuote,setLeftQuote]=useState(''),[rightQuote,setRightQuote]=useState('');
  const [expression, setExpression] = useState('');
  const [waitMode, setWaitMode] = useState('step'), [waitDuration, setWaitDuration] = useState('3');
  const pending = useRef<{ cursor: string; request_id: string; action_type: string; args: Record<string, unknown>; reason: string }>(undefined);
  const people = Object.keys(p.agents),
    self = p.actor_id || "",
    me = p.agents[self];
  const places = Object.keys(p.world.place_topology),
    exits = me ? p.world.place_topology[me.location] || [] : [];
  const colocated = people.filter((actor) => actor !== self && p.agents[actor].location === me?.location);
  const recipients = kind === "speak" ? p.world.speech_recipients ?? colocated : colocated;
  const canSetEventAudience = p.role === "creator_observer" && kind === "scene_event" &&
    (p.capabilities.includes('direct_scene_events') || people.some(id => p.agents[id].social));
  const present = people.filter((id) => p.agents[id].location === target);
  const availableCandidates = p.candidate_targets ?? p.scene?.preparation?.readiness?.roles.filter(role =>
    role.candidate && !people.includes(role.id)) ?? [];
  const unknowns = Object.entries(p.premises?.unknowns ?? {}).filter(([id, entry]) => entry.may_resolve && !p.premises?.resolved[id]);
  const pastOptions = Object.entries(p.expression_options?.past ?? {});
  const basisOptions = Object.entries(p.expression_options?.basis ?? {});
  const unavailableExpression = expression && !pastOptions.some(([id]) => expression === `past:${id}`)
    && !basisOptions.some(([id]) => expression === `basis:${id}`);
  const invalidEventAudience = canSetEventAudience && eventAudience !== null &&
    (!eventAudience.length || eventAudience.some((id) => !present.includes(id)));
  const canWrite = connected && !p.historical && !busy;
  const path = `/worldlines/${encodeURIComponent(p.worldline_id)}`;
  async function send() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      let args: Record<string, unknown> = {};
      if (participant) {
        if (kind === "speak")
          args = {
            speech: text,
            ...(target ? { recipient_id: target } : {}),
            share_ids: [],
            ...(expression.startsWith('past:') ? { past_id: expression.slice(5) } : {}),
            ...(expression.startsWith('basis:') ? { basis_id: expression.slice(6) } : {}),
            ...(me?.social && target ? {social:{turn:socialTurn, ...(acceptPromise?{accept_promise:acceptPromise}:{})}}:{}),
          };
        if (kind === "move") args = { destination_id: target };
        if (kind === "take") args = { item_id: item };
        if (kind === "read") args = { item_id: item };
        if (kind === "compare") args = {left_id:leftSource,left_quote:leftQuote,right_id:rightSource,right_quote:rightQuote};
        if (kind === "transfer") args = { item_id: item, recipient_id: target };
        if (kind === 'wait' && waitMode === 'event') args = { until_event: true };
        if (kind === 'wait' && waitMode === 'duration') args = { duration: Number(waitDuration) };
      } else {
        if (rulingPayload) args = rulingPayload;
        if (kind === "environment") args = { key, value };
        if (kind === "relocate")
          args = { actor_id: item, destination_id: target };
        if (kind === "scene_event") {
          args = { place_id: target, text };
          if (canSetEventAudience && eventAudience !== null) args.audience = eventAudience;
          if (hideEvent) args.spoiler = true;
        }
        if (kind === "candidate_invite") args = { actor_id: target, text: text.trim() };
        if (kind === "resolve_unknown") args = { unknown_id: target, answer: text.trim() };
        if (kind === "schedule")
          args = {
            id: crypto.randomUUID(),
            due_tick: Number(due),
            priority: Number(priority),
            kind: "scene_event",
            payload: { place_id: target, text },
          };
      }
      pending.current ||= {
        cursor: frame.cursor,
        request_id: crypto.randomUUID(),
        action_type: kind,
        args,
        reason: participant ? "" : kind === "resolve_unknown" ? '作者确定本线关键未知' : reason,
      };
      const receipt = await runtimeRequest<Receipt>(
        session,
        path + (participant ? "/actions" : "/interventions"),
        undefined,
        "POST",
        pending.current,
      );
      if (receipt.status === 'committed' || receipt.status === 'rule_rejected') onCommit(pending.current.cursor);
      pending.current = undefined;
      setResult(
        (kind === 'resolve_conflict' && receipt.status === 'committed' && messages.conflict_resolved) ||
          (receipt.status==='rule_rejected'&&receipt.reason_code&&messages[receipt.reason_code]) || messages[receipt.status] ||
          `未提交：${receipt.reason_code || receipt.status}`,
      );
      if (receipt.status === "committed" && kind === "speak") {
        setText("");
        setExpression('');
      }
      if (receipt.status === "committed" && (kind === "candidate_invite" || kind === "resolve_unknown")) {
        setKind("environment");
        setText("");
        setTarget("");
        setReason("");
      }
      if (receipt.status === 'committed' && kind === 'resolve_conflict') {
        setRulingDraft(emptyAdjudication);
        setReason('');
      }
    } catch (e) {
      if (e instanceof RuntimeError) pending.current = undefined;
      setError(
        messages[(e as Error).message] ||
          "提交结果尚未确认。请重试上次提交，原请求编号将保持不变。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function configure(stop = false) {
    setBusy(true);
    setError("");
    setResult("");
    try {
      await runtimeRequest(session, path + "/autonomy", undefined, "POST", {
        actors: stop ? [] : controlled,
        limit: Number(limit),
        mode: policyMode,
      });
      onCommit(frame.cursor);
      setResult(
        stop
          ? "自动调度已关闭。"
          : "调度已保存；继续世界线后执行，到达行动或模型费用上限自动暂停。",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const controls = (
    <div className="runtime-command-form">
      <fieldset disabled={busy || Boolean(pending.current)}>
        {!p.pending_conflict && <label>
          {participant ? "角色行动" : authorOnly ? '介入方式' : "正式干预"}
          <select
            aria-label={participant ? "角色行动" : authorOnly ? '介入方式' : "正式干预"}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setTarget("");
              setItem("");
              setEventAudience(null);
              setHideEvent(false);
              setRulingDraft(emptyAdjudication);
              if (e.target.value === "candidate_invite") {
                setReason("向本场候选发送定向邀请");
                setText("");
              }
              if (e.target.value === 'resolve_unknown') setText('');
              setResult("");
            }}
          >
            {participant ? (
              <>
                <option value="speak">交谈</option>
                <option value="move">移动</option>
                <option value="take">拾取</option>
                <option value="transfer">转交物品</option>
                <option value="observe">观察</option>
                <option value="wait">等待</option>
                {p.capabilities.includes('read')&&<option value="read">阅读持有物品</option>}
                {p.capabilities.includes('compare')&&<option value="compare">核对已知片段</option>}
              </>
            ) : (
              <>
                {p.capabilities.includes('adjudicate') && adjudicationKinds.filter(key => key !== 'resolve_conflict').map(key =>
                  <option value={key} key={key}>{adjudicationLabels[key]}</option>)}
                <option value="environment">调整环境</option>
                <option value="relocate">调整角色所在场景</option>
                <option value="scene_event">触发场景事件 · +1 量子</option>
                <option value="schedule">安排定时场景事件</option>
                {(availableCandidates.length > 0 || kind === "candidate_invite") &&
                  <option value="candidate_invite">定向邀请候选</option>}
                {(unknowns.length > 0 || kind === 'resolve_unknown') && <option value="resolve_unknown">确定本线关键未知</option>}
              </>
            )}
          </select>
        </label>}
        {usesRuling && <RuntimeAdjudicationFields kind={kind} p={p} draft={rulingDraft} onChange={setRulingDraft} />}
        {participant && kind === 'wait' && <>
          <label>等待方式<select value={waitMode} onChange={event => setWaitMode(event.target.value)}>
            <option value="step">等一步</option><option value="event">等本人收到新见闻</option><option value="duration">等一段时间</option>
          </select></label>
          {waitMode === 'duration' && <label>等待多久（逻辑时刻）<input type="number" min={1} max={10000} value={waitDuration}
            onChange={event => setWaitDuration(event.target.value)} /></label>}
        </>}
        {kind === 'resolve_unknown' && <>
          <label>获准确定的问题<select value={target} onChange={event => setTarget(event.target.value)}>
            <option value="">选择问题</option>
            {unknowns.map(([id, entry]) => <option value={id} key={id}>{entry.title}</option>)}
          </select></label>
          <label>本线答案<textarea rows={3} maxLength={450} value={text} onChange={event => setText(event.target.value)} /></label>
        </>}
        {kind === "environment" && (
          <div className="runtime-command-row">
            <label>
              环境字段
              <input
                aria-label="环境字段"
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <label>
              环境值
              <input
                aria-label="环境值"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
          </div>
        )}
        {kind === "candidate_invite" && <>
          <label>邀请对象<select value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">选择尚未参与的候选</option>
            {availableCandidates.map(role => <option key={role.id} value={role.id}>{role.name} · {role.location_name}</option>)}
          </select></label>
          <label>邀请内容<textarea rows={2} maxLength={500} value={text} onChange={e => setText(e.target.value)} /></label>
        </>}
        {(kind === "move" ||
          kind === "relocate" ||
          kind === "scene_event" ||
          kind === "schedule" ||
          kind === "transfer" ||
          kind === "speak") && (
          <label>
            {kind === "speak" || kind === "transfer" ? "接收角色" : "目标地点"}
            <select
              aria-label={
                kind === "speak" || kind === "transfer"
                  ? "接收角色"
                  : "目标地点"
              }
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                if (eventAudience !== null) setEventAudience([]);
              }}
            >
              <option value="">
                {kind === "speak" ? "公开交谈" : "请选择"}
              </option>
              {(kind === "speak" || kind === "transfer"
                ? recipients
                : kind === "move"
                  ? exits
                  : places
              ).map((id) => (
                <option key={id} value={id}>
                  {displayName(p, id)}
                </option>
              ))}
            </select>
          </label>
        )}
        {canSetEventAudience && (
          <>
            <label>
              接收范围
              <select
                aria-label="场景事件接收范围"
                value={eventAudience === null ? "all" : "selected"}
                onChange={(e) => setEventAudience(e.target.value === "all" ? null : [])}
              >
                <option value="all">在场所有角色</option>
                <option value="selected">指定在场角色</option>
              </select>
            </label>
            {eventAudience !== null && (
              <fieldset>
                <legend>场景事件接收者</legend>
                {!present.length && <p className="runtime-muted">请选择有角色在场的地点。</p>}
                {people.filter((id) => present.includes(id) || eventAudience.includes(id)).map((id) => (
                  <label className="runtime-checkbox" key={id}>
                    <input
                      type="checkbox"
                      checked={eventAudience.includes(id)}
                      onChange={(e) => setEventAudience(e.target.checked
                        ? [...eventAudience, id]
                        : eventAudience.filter((actor) => actor !== id))}
                    />
                    {displayName(p, id)}{!present.includes(id) && " · 已离开"}
                  </label>
                ))}
                {eventAudience.some((id) => !present.includes(id)) && (
                  <p role="status">请取消已离开的接收者。</p>
                )}
              </fieldset>
            )}
          </>
        )}
        {(kind === "take" || kind === "transfer" || kind === "read" || kind === "relocate") && (
          <label>
            {kind === "relocate" ? "调整角色" : "物品"}
            <select
              aria-label={kind === "relocate" ? "调整角色" : "物品"}
              value={item}
              onChange={(e) => setItem(e.target.value)}
            >
              <option value="">请选择</option>
              {(kind === "relocate"
                ? people
                : Object.entries(p.world.items)
                    .filter(([id, holder]) =>
                      kind === "transfer"
                        ? holder === self
                        : kind === 'read' ? holder === self && p.world.readable_items?.includes(id)
                        : holder === me?.location,
                    )
                    .map(([id]) => id)
              ).map((id) => (
                <option key={id} value={id}>
                  {displayName(p, id)}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind==='compare'&&<>
          <p>选择两个本人已知的来源，逐字填写各自片段；只比较字面，不判断世界真相。</p>
          {([['左侧来源',leftSource,setLeftSource,leftQuote,setLeftQuote],['右侧来源',rightSource,setRightSource,rightQuote,setRightQuote]] as const).map(([label,source,setSource,quote,setQuote])=><div key={label}>
            <label>{label}<select value={source} onChange={e=>setSource(e.target.value)}>
              <option value="">请选择</option>{Object.entries(me?.known||{}).map(([id,record])=><option key={id} value={id}>{(evidenceText(record)||id).slice(0,70)}</option>)}
            </select></label>
            <label>{label}逐字片段<input value={quote} maxLength={400} onChange={e=>setQuote(e.target.value)}/></label>
          </div>)}
        </>}
        {(kind === "speak" ||
          kind === "scene_event" ||
          kind === "schedule") && (
          <label>
            {kind === "speak" ? "想说的话" : "事件内容"}
            <textarea
              aria-label={kind === "speak" ? "想说的话" : "事件内容"}
              value={text}
              maxLength={1500}
              rows={2}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        {kind === 'scene_event' && <label className="runtime-checkbox">
          <input type="checkbox" checked={hideEvent} onChange={event => setHideEvent(event.target.checked)} />
          防泄底时隐藏此事件的原话
        </label>}
        {kind === "schedule" && (
          <div className="runtime-command-row">
            <label>
              到期时刻
              <input
                aria-label="到期时刻"
                type="number"
                min={p.sim_time_tick || 0}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
            <label>
              优先级
              <input
                aria-label="优先级"
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </label>
          </div>
        )}
        {participant && kind === 'speak' && (pastOptions.length > 0 || basisOptions.length > 0 || expression) && <label>
          表达依据<select value={expression} onChange={event => setExpression(event.target.value)}>
            <option value="">角色陈述</option>
            {unavailableExpression && <option value={expression} disabled>先前所选已不可用</option>}
            {pastOptions.map(([id, text]) => <option value={`past:${id}`} key={id}>补充本线 · {text}</option>)}
            {basisOptions.map(([id, type]) => <option value={`basis:${id}`} key={id}>
              {type === 'original' ? '原作依据' : '本线依据'} · {evidenceText(me?.known?.[id])}
            </option>)}
          </select>
        </label>}
        {!participant && kind !== 'resolve_unknown' && (
          <label>
            {usesRuling ? kind === 'resolve_conflict' ? '处理说明' : '作者意图' : '干预理由'}
            <textarea
              aria-label={usesRuling ? kind === 'resolve_conflict' ? '处理说明' : '作者意图' : '干预理由'}
              rows={2}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <p className="runtime-muted">
          {participant
            ? "行动受角色权限与世界规则约束，不调用模型。"
            : kind === 'attempt_action' ? '本次尝试交给世界规则裁决。'
              : kind === 'resolve_conflict' ? '处理完成后，点「继续」交还原有角色调度。'
              : kind === 'item_conflict' ? '在同一时刻检查这些角色的拾取条件。'
              : kind === 'hold_consequence' ? '世界线停在后果生效之前，等待作者处理。'
              : kind === "candidate_invite"
              ? "邀请提交后，只有候选收到消息，角色从其原位置开始参与。"
              : kind === 'resolve_unknown'
                ? '答案提交后固定在本线，只有准备时指定的角色直接获知。'
              : kind === "scene_event"
              ? "事件提交推进 1 个逻辑时间量子。"
              : "此调整不推进逻辑时间，仍保存操作主体、理由与前后效果。"}
        </p>
      </fieldset>
      <Button
        onClick={() => void send()}
        disabled={
          !canWrite ||
          (Boolean(p.conflict_pending) && kind !== 'resolve_conflict') ||
          (!pending.current && usesRuling && !rulingPayload) ||
          (!pending.current && invalidEventAudience) ||
          (!pending.current && kind === "candidate_invite" && (!text.trim() || !availableCandidates.some(role => role.id === target))) ||
          (!pending.current && kind === 'speak' && Boolean(unavailableExpression)) ||
          (!pending.current && kind === 'wait' && waitMode === 'duration' &&
            (!Number.isInteger(Number(waitDuration)) || Number(waitDuration) < 1 || Number(waitDuration) > 10000)) ||
          (!pending.current && kind === 'resolve_unknown' && (!text.trim() || !unknowns.some(([id]) => id === target))) ||
          (!participant && kind !== 'resolve_unknown' && !reason.trim()) ||
          (participant && p.control.status !== "running")
        }
      >
        {busy
          ? "正在提交…"
          : pending.current
            ? "重试上次提交"
            : participant
              ? "提交角色行动"
              : kind === "candidate_invite" ? "发送邀请" : kind === 'resolve_unknown' ? '确定答案'
                : kind === 'attempt_action' ? '提交尝试' : kind === 'resolve_conflict' ? '确认处理'
                : kind === 'item_conflict' ? '提交争用' : kind === 'hold_consequence' ? '暂停待处理' : "提交正式干预"}
      </Button>
    </div>
  );
  return (
    <div className="runtime-command-area">
      {p.role==='creator_observer' && <p role="status">{executionText(p)} · 模型{p.execution?.model_enabled?'已配置':'关闭'}
        {p.control.reason && p.control.reason !== 'awaiting_activity' && !p.conflict_pending && !sharedModelStop && ` · 暂停原因：${messages[p.control.reason]||p.control.reason}`}</p>}
      {participant ? (
        <section aria-label="角色行动输入">
          <h3>作为 {displayName(p, self)} 参与</h3>
          {kind==='speak' && me?.social && <>
            <label>交谈方式<select value={socialTurn} onChange={e=>setSocialTurn(e.target.value)}><option value="continue">发起／回应</option><option value="decline">拒绝继续</option><option value="end">结束交谈</option></select></label>
            <label>回应对方承诺（先选择交谈对象）<select value={acceptPromise} onChange={e=>setAcceptPromise(e.target.value)}><option value="">不裁决承诺</option>{Object.entries(me.social.incoming_promises).filter(([,v])=>v.sender_id===target && ['pending','overdue'].includes(v.status)).map(([id,v])=><option key={id} value={id}>{v.text}</option>)}</select></label>
          </>}
          {controls}
        </section>
      ) : authorOnly ? (
        p.conflict_pending && !p.pending_conflict ? <p>{messages.adjudication_requires_author_view}</p> : controls
      ) : (
        <>
          <section className="runtime-scenario-paths" aria-label="可复用创作者路径">
            <h3>可复用创作者路径</h3>
            <p className="runtime-muted">从当前已保存的世界线选择一种有限情境。完成后，结果会保留在日志中，并可用于分支比较。</p>
            <div className="runtime-scenario-path-grid">
              {creatorScenarioPaths.map(path => (
                <button
                  type="button"
                  className={`runtime-scenario-path ${kind === path.action ? "is-selected" : ""}`}
                  key={path.action}
                  disabled={busy || Boolean(pending.current)}
                  onClick={() => {
                    setKind(path.action);
                    setTarget("");
                    setItem("");
                    setEventAudience(null);
                    setHideEvent(false);
                    setReason(path.reason);
                    setResult("");
                    setError("");
                    setCreatorOpen(true);
                  }}
                >
                  <strong>{path.title}</strong>
                  <span>{path.description}</span>
                </button>
              ))}
            </div>
          </section>
          <details open={creatorOpen} onToggle={event => setCreatorOpen(event.currentTarget.open)}>
            <summary>创作者干预 · 可追溯的正式操作</summary>
            {controls}
          </details>
          <details>
            <summary>
              {modelActive ? "模型角色调度" : "无模型规则调度"} ·{" "}
              {p.autonomy?.enabled
                ? `已用 ${p.autonomy.used}/${p.autonomy.limit}`
                : "未启用"}
            </summary>
            <div className="runtime-command-form">
              <p className="runtime-muted">
                只使用角色已授权的观察、记忆和本地计划。
                {policyMode === "model"
                  ? p.model_budget?.exploration
                    ? "模型请求使用本轮共享额度。可在运行设置中预准一次重试。"
                    : "模型请求受本机总费用与调用次数上限约束。"
                  : "规则策略不会调用模型。"}
              </p>
              {p.capabilities.includes("model_autonomy") && (
                <label>
                  角色策略
                  <select
                    aria-label="角色策略"
                    value={policyMode}
                    onChange={(e) =>
                      setPolicyMode(e.target.value as "rules" | "model")
                    }
                  >
                    <option value="rules">无模型规则</option>
                    <option value="model">模型决策 · 产生费用</option>
                  </select>
                </label>
              )}
              {p.model_budget?.charged_micro != null && p.model_budget.limit_micro != null && (
                <p className="runtime-muted">
                  模型账本保守计费 ¥
                  {(p.model_budget.charged_micro / 1_000_000).toFixed(4)} / ¥
                  {(p.model_budget.limit_micro / 1_000_000).toFixed(2)}；
                  {p.model_budget.calls}/{p.model_budget.max_calls}{" "}
                  次。取消或未知用量保留预留费用。
                </p>
              )}
              {p.model_budget?.allocation && <p className="runtime-muted">
                本线已分配 ¥{(p.model_budget.allocation.limit_micro/1_000_000).toFixed(2)}；
                已用 {p.model_budget.allocation.calls}/{p.model_budget.allocation.max_calls} 次；
                {p.model_budget.allocation.used_actions!=null && p.model_budget.allocation.max_actions!=null && <>模型行动 {p.model_budget.allocation.used_actions}/{p.model_budget.allocation.max_actions}（含规则拒绝）；</>}
                {p.model_budget.allocation.used_cognition!=null && p.model_budget.allocation.max_cognition!=null && <>认知修订 {p.model_budget.allocation.used_cognition}/{p.model_budget.allocation.max_cognition}；</>}
                运行用时 {p.model_budget.allocation.elapsed_seconds}/{p.model_budget.allocation.runtime_seconds} 秒；
                输入 {p.model_budget.allocation.used_input_tokens}/{p.model_budget.allocation.input_tokens} token，
                输出 {p.model_budget.allocation.used_output_tokens}/{p.model_budget.allocation.output_tokens} token。
              </p>}
              <fieldset>
                <legend>
                  交给{policyMode === "model" ? "模型" : "规则"}策略的角色
                </legend>
                {people.map((actor) => (
                  <label className="runtime-checkbox" key={actor}>
                    <input
                      type="checkbox"
                      checked={controlled.includes(actor)}
                      onChange={(e) =>
                        setControlled(
                          e.target.checked
                            ? [...controlled, actor]
                            : controlled.filter((id) => id !== actor),
                        )
                      }
                    />
                    {displayName(p, actor)}
                  </label>
                ))}
              </fieldset>
              <label>
                行动上限
                <input
                  aria-label="行动上限"
                  type="number"
                  min="1"
                  max="100"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </label>
              <div className="runtime-command-row">
                <Button
                  disabled={!canWrite || !controlled.length}
                  onClick={() => void configure()}
                >
                  {policyMode === "model" ? "保存模型调度" : "保存规则调度"}
                </Button>
                <Button
                  disabled={!canWrite || !p.autonomy?.enabled}
                  onClick={() => void configure(true)}
                >
                  关闭调度
                </Button>
              </div>
            </div>
          </details>
          {!!p.scheduler?.pending_jobs.length && (
            <p className="runtime-muted">
              待触发：
              {p.scheduler.pending_jobs
                  .map((job) => `${job.payload?.text || job.payload?.key || job.id}（时刻 ${job.due_tick}）`)
                .join("、")}
            </p>
          )}
        </>
      )}
      {result && (
        <p role="status" className="runtime-command-result">
          {result}
        </p>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  );
}
