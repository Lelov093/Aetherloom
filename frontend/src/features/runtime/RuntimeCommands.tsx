import { useState, useRef } from "react";
import { Button, ErrorNotice } from "../../components/ui";
import { executionText } from './SocialInspector';
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

export function RuntimeCommands({ session, frame, connected }: Props) {
  const p = frame.projection,
    participant = p.role === "participant";
  const [kind, setKind] = useState(participant ? "speak" : "environment");
  const [text, setText] = useState(""),
    [target, setTarget] = useState(""),
    [item, setItem] = useState("");
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
  const pending = useRef<unknown>(undefined);
  const people = Object.keys(p.agents),
    self = p.actor_id || "",
    me = p.agents[self];
  const places = Object.keys(p.world.place_topology),
    exits = me ? p.world.place_topology[me.location] || [] : [];
  const recipients = people.filter((actor) => actor !== self);
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
            ...(me?.social && target ? {social:{turn:socialTurn, ...(acceptPromise?{accept_promise:acceptPromise}:{})}}:{}),
          };
        if (kind === "move") args = { destination_id: target };
        if (kind === "take") args = { item_id: item };
        if (kind === "read") args = { item_id: item };
        if (kind === "compare") args = {left_id:leftSource,left_quote:leftQuote,right_id:rightSource,right_quote:rightQuote};
        if (kind === "transfer") args = { item_id: item, recipient_id: target };
      } else {
        if (kind === "environment") args = { key, value };
        if (kind === "relocate")
          args = { actor_id: item, destination_id: target };
        if (kind === "scene_event") args = { place_id: target, text };
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
        reason: participant ? "" : reason,
      };
      const receipt = await runtimeRequest<Receipt>(
        session,
        path + (participant ? "/actions" : "/interventions"),
        undefined,
        "POST",
        pending.current,
      );
      pending.current = undefined;
      setResult(
        (receipt.status==='rule_rejected'&&receipt.reason_code&&messages[receipt.reason_code]) || messages[receipt.status] ||
          `未提交：${receipt.reason_code || receipt.status}`,
      );
      if (receipt.status === "committed" && kind === "speak") setText("");
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
        <label>
          {participant ? "角色行动" : "正式干预"}
          <select
            aria-label={participant ? "角色行动" : "正式干预"}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setTarget("");
              setItem("");
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
                <option value="environment">调整环境</option>
                <option value="relocate">调整角色所在场景</option>
                <option value="scene_event">触发场景事件 · +1 量子</option>
                <option value="schedule">安排定时场景事件</option>
              </>
            )}
          </select>
        </label>
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
              onChange={(e) => setTarget(e.target.value)}
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
        {!participant && (
          <label>
            干预理由
            <textarea
              aria-label="干预理由"
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
            : kind === "scene_event"
              ? "事件提交推进 1 个逻辑时间量子。"
              : "此调整不推进逻辑时间，仍保存操作主体、理由与前后效果。"}
        </p>
      </fieldset>
      <Button
        onClick={() => void send()}
        disabled={
          !canWrite ||
          (!participant && !reason.trim()) ||
          (participant && p.control.status !== "running")
        }
      >
        {busy
          ? "正在提交…"
          : pending.current
            ? "重试上次提交"
            : participant
              ? "提交角色行动"
              : "提交正式干预"}
      </Button>
    </div>
  );
  return (
    <div className="runtime-command-area">
      {p.role==='creator_observer' && <p role="status">{executionText(p)} · 模型{p.execution?.model_enabled?'已配置':'关闭'}
        {p.control.reason && ` · 暂停原因：${messages[p.control.reason]||p.control.reason}`}</p>}
      {participant ? (
        <section aria-label="角色行动输入">
          <h3>作为 {displayName(p, self)} 参与</h3>
          {kind==='speak' && me?.social && <>
            <label>交谈方式<select value={socialTurn} onChange={e=>setSocialTurn(e.target.value)}><option value="continue">发起／回应</option><option value="decline">拒绝继续</option><option value="end">结束交谈</option></select></label>
            <label>回应对方承诺（先选择交谈对象）<select value={acceptPromise} onChange={e=>setAcceptPromise(e.target.value)}><option value="">不裁决承诺</option>{Object.entries(me.social.incoming_promises).filter(([,v])=>v.sender_id===target && ['pending','overdue'].includes(v.status)).map(([id,v])=><option key={id} value={id}>{v.text}</option>)}</select></label>
          </>}
          {controls}
        </section>
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
                  onClick={() => {
                    setKind(path.action);
                    setTarget("");
                    setItem("");
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
                  ? "模型请求受本机总费用与调用次数上限约束，失败暂停，不自动重试。"
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
              {p.model_budget && (
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
                .map((job) => `${job.id}（时刻 ${job.due_tick}）`)
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
