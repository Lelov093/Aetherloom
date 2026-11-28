import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GitBranch, ArrowRight } from 'lucide-react';
import { Button, ErrorNotice } from '../../components/ui';
import { useWorkspaceTrail } from '../../components/WorkspaceContext';
import { SimulationSetup } from './SimulationSetup';
import { SimulationMonitor } from './SimulationMonitor';
import { simApi, simStatus, type Session, type SessionSummary } from './api';
import { ExperienceLibrary } from '../runtime/ExperienceLibrary';
import { ScenarioSetup } from '../runtime/ScenarioSetup';
import { AuthoredPreparation } from '../runtime/AuthoredPreparation';
import { RuntimeWorkspace } from '../runtime/RuntimeWorkspace';

export function SimulationWorkspace({ world }: { world: string }) {
  const [params, setParams] = useSearchParams(), id = params.get('session');
  const requestedEvent = Number(params.get('event')) || undefined;
  const [sessions, setSessions] = useState<SessionSummary[]>([]), [session, setSession] = useState<Session>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [connection, setConnection] = useState('');
  const [loading, setLoading] = useState(true), [sessionLoading, setSessionLoading] = useState(Boolean(id));
  const [purpose,setPurpose] = useState('all'),[experienceAvailable,setExperienceAvailable]=useState(false);
  const requestedId = useRef(id), retry = useRef<() => void>(() => {});
  requestedId.current = id;
  useWorkspaceTrail([{ label: id ? session?.title || '正在打开世界线' : '世界模拟' }]);
  const reloadList = () => simApi.list(world).then(setSessions);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void simApi.list(world).then(list => { if (active) setSessions(list); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [world]);
  useEffect(() => {
    setError(''); setConnection('');
    if (!id) { setSession(undefined); setSessionLoading(false); return; }
    let active = true, sequence = 0;
    setSessionLoading(true);
    const load = async () => {
      const request = ++sequence;
      try {
        const value = await simApi.get(id);
        if (active && request === sequence) { setSession(value); setSessionLoading(false); setError(''); }
      } catch (e) { if (active && request === sequence) { setError((e as Error).message); setSessionLoading(false); } }
    };
    retry.current = () => { setSessionLoading(true); void load(); };
    void load();
    const stream = new EventSource(`/api/simulations/${id}/stream`);
    stream.addEventListener('committed', () => { void load(); });
    stream.addEventListener('status', event => {
      if (!active) return;
      const status = JSON.parse((event as MessageEvent).data);
      setSession(previous => {
        if (previous?.id !== id) return previous;
        // A commit arrives as a complete snapshot. Keep its draft and old cursor
        // together until the matching saved event/state has finished loading.
        if (status.cursor > previous.cursor) return { ...previous, status: status.status, calls: status.calls, cost: status.cost, error: status.error };
        return { ...previous, ...status };
      });
      setConnection('');
    });
    stream.onerror = () => { if (active) setConnection('连接暂时中断，正在重连；已保存结果和世界运行独立于页面。'); };
    return () => { active = false; stream.close(); };
  }, [id]);
  const switching = Boolean(id && session && id !== session.id);
  async function control(action: string) {
    if (!id || session?.id !== id || busy || sessionLoading) return;
    const target = id;
    setBusy(true); setError('');
    try {
      await simApi.control(target, action);
      const value = await simApi.get(target);
      if (requestedId.current === target) setSession(value);
      await reloadList();
    } catch (e) { if (requestedId.current === target) setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function newScene() { setParams({ prepare: '1' }); }
  if(params.has('line')) return <RuntimeWorkspace world={world}/>;
  if(params.get('series')==='modern-academy')return <ScenarioSetup world={world} sourceNodeId={params.get('source') || undefined} onBack={()=>setParams({})} onCreated={(line,view)=>setParams({line,view})}/>;
  if (params.has('prepare')) return <AuthoredPreparation key={`${world}:${params}`} world={world} onCreated={line => setParams({line})}/>;
  if (id && session) return <SimulationMonitor key={session.id} session={session} sessions={sessions} requestedSession={id} busy={busy || sessionLoading || switching}
    switching={switching} initialEvent={requestedEvent} error={error} connection={connection} onSession={next => setParams({ session: next })} onControl={control}
    onBack={() => setParams({})} onRetry={() => retry.current()}/>;
  if (id) return <main id="main-content" className="simulation-loading" aria-busy={sessionLoading}>
    <h1>打开保存的世界线</h1><p role="status">{error || '正在读取已保存的起点与演化记录…'}</p>
    {error && <Button onClick={() => retry.current()}>重新读取</Button>}<Button variant="ghost" onClick={() => setParams({})}>返回世界线列表</Button>
  </main>;
  const setup = params.has('setup') || params.has('source');
  return <main id="main-content" className="page simulation-page"><header className="page-heading"><div><span className="eyebrow">{setup ? 'TEXT SIMULATION · 旧 Setup' : 'SIMULATION · 独立世界线'}</span>
    <h1>{setup ? '为故事准备一个起点' : '你的世界线'}</h1><p>{setup ? '配置旧版文本世界线的起点与运行范围。' : '重开已有起点，观察人物、对话与世界变化。'}</p></div>{!setup && <Button variant="primary" onClick={newScene}>准备文本模拟</Button>}</header>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!setup&&<>{experienceAvailable&&<label className="academy-purpose-filter">模拟用途<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="all">全部世界线</option><option value="original_projection">原作推演</option><option value="template_parallel">模板平行世界</option><option value="sandbox">自由沙盒</option><option value="unclassified">既有未分类</option></select></label>}<ExperienceLibrary world={world} onAvailable={setExperienceAvailable} filter={purpose} onOpen={line=>setParams({line})}/></>}
    {setup ? <><Button variant="ghost" onClick={() => setParams({})}>← 返回世界线列表</Button><SimulationSetup world={world} onCreated={() => { void reloadList(); }}/></> : loading ? <p role="status">正在读取世界线…</p> : <section className="sim-library" aria-label="已保存旧世界线">
      {!experienceAvailable && <Button variant="ghost" onClick={() => setParams({setup:'legacy'})}>打开旧版文本设置</Button>}
      {sessions.length === 0 ? !experienceAvailable && <div className="sim-library-empty"><GitBranch size={32}/><h2>暂无已保存的世界线</h2></div>
        : sessions.filter(()=>['all','unclassified'].includes(purpose)).map(value => <article className="sim-worldline" key={value.id}><span className="sim-worldline-icon"><GitBranch size={22}/></span><div>
          {experienceAvailable&&<span className="eyebrow">既有未分类</span>}<span className={`sim-library-status is-${value.status}`}>{simStatus[value.status] || value.status}</span><h2>{value.title}</h2>
          <p className="sim-worldline-start">{value.start_label}</p><p className="sim-worldline-summary">{value.latest_narration || '起点已保存，尚未开始演化。'}</p>
          <p className="sim-worldline-meta">第{value.cursor}步 · {value.calls}次请求 · 费用／预留 ¥{value.cost.toFixed(4)}</p></div><Button onClick={() => setParams({ session: value.id })}>打开世界线<ArrowRight size={16}/></Button></article>)}
    </section>}
  </main>;
}
