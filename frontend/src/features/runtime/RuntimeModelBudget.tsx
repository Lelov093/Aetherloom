import { useState } from 'react';
import { Button, ErrorNotice } from '../../components/ui';
import { runtimeRequest, type Envelope, type HostSession } from './api';

export const modelStopMessages: Record<string, string> = {
  story_time_limit: '已达故事时限',
  'model:model_budget_exhausted': '已达共享模型额度',
  'model:model_connection_lost': '请求发出后连接中断 · 等待核对原步',
  'model:model_not_sent': '连接失败 · 请求未发出',
  'model:model_run_limit': '已达共享运行上限',
  'model:runtime_limit': '已达共享运行时限',
  'model:model_usage_unknown': '模型用量待核对',
  'model:invalid_model_proposal': '模型返回无效提案',
  'model:empty_model_cognition': '模型返回空认知提案',
  'model:commit_unknown': '提交回执待核对',
  'model:model_recovery_required': '请先核对原步与账本',
  'model:model_retry_used': '本步的重试机会已用',
  'model:model_retry_not_approved': '本步没有可用的预准重试',
  model_recovery_required: '请先核对原步与账本。',
  model_commit_unknown: '暂时无法确认原步是否提交，世界线保持暂停。',
  model_retry_not_approved: '本步没有可用的预准重试。你可以改用规则调度。',
  model_retry_used: '本步的重试机会已用。你可以改用规则调度。',
  model_attempt_inflight: '上一请求仍在收尾，请稍后核对。',
  approval_allocation_exceeded: '追加后将超过宿主审批额度。',
  invalid_model_budget_extension: '追加只能提高当前探索的上限。',
};

const money = (micro: number) => `¥${(micro / 1_000_000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

export function RuntimeModelBudget({ session, frame, connected, onCommit }: {
  session: HostSession; frame: Envelope; connected: boolean; onCommit: (cursor: string) => void;
}) {
  const projection = frame.projection;
  const budget = projection.model_budget?.exploration;
  const [editing, setEditing] = useState(false);
  const [calls, setCalls] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!budget) return null;
  const { line, recovery } = budget;
  const writable = connected && !projection.historical && projection.control.status === 'paused' && !busy;
  const limit = Math.round(Number(cost) * 1_000_000);
  const valid = Number.isInteger(Number(calls)) && Number(calls) >= budget.max_calls && Number(calls) <= 2000 &&
    limit >= budget.limit_micro && limit <= 10_000_000 && (Number(calls) > budget.max_calls || limit > budget.limit_micro);

  async function update(action: 'model-recovery' | 'model-budget') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = action === 'model-budget' ? { max_calls: Number(calls), limit_micro: limit } : undefined;
      const next = await runtimeRequest<Envelope>(session, `/worldlines/${encodeURIComponent(projection.worldline_id)}/${action}`,
        undefined, 'POST', body);
      if (next.cursor !== frame.cursor) onCommit(frame.cursor);
      if (action === 'model-budget') {
        setEditing(false);
        setNotice('共享额度已更新。');
      }
    } catch (problem) {
      setError(modelStopMessages[(problem as Error).message] ?? '暂时无法更新模型账本。');
    } finally { setBusy(false); }
  }

  return <details>
    <summary>共享预算与恢复</summary>
    <div className="runtime-command-form">
      <p>同轮已发 {budget.sent_calls} / {budget.max_calls} 次{budget.pending_calls > 0 && ` · 发送待核对 ${budget.pending_calls} 次`} · 已确认提交 {budget.committed_steps} 步</p>
      <p>同轮可确认费用 {money(budget.confirmed_micro)} · 待核对占额 {money(budget.held_micro)} · 费用上限 {money(budget.limit_micro)}</p>
      <p>本线已发 {line.sent_calls} 次{line.pending_calls > 0 && ` · 发送待核对 ${line.pending_calls} 次`} · 已确认提交 {line.committed_steps} 步</p>
      <p className="runtime-muted">本线可确认费用 {money(line.confirmed_micro)} · 待核对占额 {money(line.held_micro)}</p>
      {recovery?.status === 'commit_recovered' && <p role="status">已找回第 {recovery.step} 步的提交回执。</p>}
      {recovery?.status === 'not_committed' && <p role="status">已核对，第 {recovery.step} 步未提交。{recovery.retry_approved ? '可以用原额度重试一次。' : '本步没有可用的预准重试。'}</p>}
      {(recovery?.status === 'check_required' || recovery?.status === 'commit_unknown') && <div>
        <p>第 {recovery.step} 步待核对。</p>
        <Button disabled={!writable} onClick={() => void update('model-recovery')}>核对原步与账本</Button>
      </div>}
      {editing ? <fieldset disabled={!writable}>
        <label>新的调用上限<input type="number" min={budget.max_calls} max={2000} step={1} value={calls} onChange={event => setCalls(event.target.value)} /></label>
        <label>新的费用上限（元）<input type="number" min={budget.limit_micro / 1_000_000} max={10} step={0.000001} value={cost} onChange={event => setCost(event.target.value)} /></label>
        <p className="runtime-muted">可追加至宿主已审批的范围。</p>
        <div className="runtime-command-row">
          <Button disabled={!valid} onClick={() => void update('model-budget')}>确认追加</Button>
          <Button variant="ghost" onClick={() => setEditing(false)}>取消</Button>
        </div>
      </fieldset> : <div><Button disabled={!writable} onClick={() => {
        setCalls(String(budget.max_calls));
        setCost(String(budget.limit_micro / 1_000_000));
        setEditing(true);
        setNotice('');
      }}>追加共享额度</Button></div>}
      {notice && <p role="status">{notice}</p>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  </details>;
}
