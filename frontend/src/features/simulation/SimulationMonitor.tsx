import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Pause, Play, PanelLeft, PanelRight, MapPin, ChevronDown, Info, Radio, Grid2X2, Ellipsis, CheckCheck, RotateCcw } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { WorkspaceHeader } from '../../components/WorkspaceContext';
import { Select } from '../../components/FormControls';
import { Portrait, PortraitEditor, usePortraits } from '../objects/Portrait';
import { simStatus, type Session, type SessionSummary } from './api';
import { presentEvents } from './presentation';
import { useMonitorLayout } from './useMonitorLayout';
import { MonitorPane } from './MonitorPane';
import { SimulationLog } from './SimulationLog';
import { SimulationMessage } from './SimulationMessage';
import { SimulationInspector, type Focus } from './SimulationInspector';

export function SimulationMonitor({ session, sessions, requestedSession, busy, switching, initialEvent, error, connection, onSession, onControl, onPropose, onBack, onRetry }: {
  session: Session; sessions: SessionSummary[]; requestedSession: string; busy: boolean; switching: boolean; initialEvent?: number; error: string; connection: string;
  onSession: (id: string) => void; onControl: (action: string) => void; onPropose: (seq: number, kind: string) => void; onBack: () => void; onRetry: () => void;
}) {
  const { layout, set, narrow, resize, start, move, end, reset, bounds } = useMonitorLayout();
  const { portraits, reload } = usePortraits(session.world_id);
  const [focus, setFocus] = useState<Focus>(), [location, setLocation] = useState(''), [follow, setFollow] = useState('');
  const [auto, setAuto] = useState(!initialEvent), [budget, setBudget] = useState(false), [portrait, setPortrait] = useState(''), [unread, setUnread] = useState(false);
  const feed = useRef<HTMLDivElement>(null), log = useRef<HTMLDivElement>(null), atBottom = useRef(true), jumping = useRef(false);
  const events = useMemo(() => presentEvents(session), [session.initial_state, session.events]);
  const visible = events.filter(p => (!location || p.location === location) && (!follow || p.involved.includes(follow)));
  const name = (id: string) => session.manifest.entities[id]?.name || '保存的对象';
  const running = ['running', 'queued'].includes(session.status), selected = focus?.kind === 'event' ? focus.seq : undefined;
  const exhausted = session.cursor >= session.manifest.setup.max_steps || session.calls >= session.manifest.setup.max_calls || session.cost >= session.manifest.setup.budget_yuan;
  const budgetNotice = session.status === 'paused' && /预算|额度/.test(session.error || '');
  const contentKey = `${session.events.length}:${session.stream.map(value => `${value.id}:${value.draft.length}`).join(',')}`;
  useLayoutEffect(() => {
    const element = feed.current;
    if (!element) return;
    if (auto && atBottom.current && !jumping.current) { element.scrollTop = element.scrollHeight; setUnread(false); }
    else setUnread(true);
  }, [contentKey, auto]);
  function latest() { setAuto(true); setUnread(false); atBottom.current = true; if (feed.current) feed.current.scrollTop = feed.current.scrollHeight; }
  function select(seq: number, fromLog = false) {
    setFocus({ kind: 'event', seq });
    if (!narrow || !fromLog) set({ inspector: true });
    if (fromLog) {
      const p = events.find(value => value.event.seq === seq);
      if (p) { if (location && p.location !== location) setLocation(''); if (follow && !p.involved.includes(follow)) setFollow(''); }
      setAuto(false); jumping.current = true;
      if (narrow) set({ log: false, inspector: false });
    }
    requestAnimationFrame(() => {
      const element = feed.current, target = document.getElementById(`monitor-event-${seq}`);
      if (fromLog && element && target) element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 16;
      jumping.current = false;
      const row = document.getElementById(`monitor-log-${seq}`), list = log.current;
      if (row && list) { const y = row.getBoundingClientRect().top - list.getBoundingClientRect().top; if (y < 0 || y > list.clientHeight - row.clientHeight) list.scrollTop += y - 16; }
    });
  }
  function inspect(next: Focus) {
    if (next.kind === 'event') { select(next.seq, true); if (narrow) set({ inspector: true }); }
    else { setFocus(next); set({ inspector: true }); }
  }
  useLayoutEffect(() => {
    if (!switching && initialEvent && events.some(p => p.event.seq === initialEvent)) select(initialEvent, true);
  }, [initialEvent, session.id, switching]);
  const toggle = (side: 'log' | 'inspector') => set({ [side]: !layout[side] });
  const divider = (side: 'left' | 'right') => <button type="button" className="monitor-divider" role="separator" aria-label={side === 'left' ? '调整世界日志宽度' : '调整详情宽度'}
    aria-orientation="vertical" aria-valuemin={bounds[side].min} aria-valuemax={bounds[side].max} aria-valuenow={layout[side]} title="拖动调宽；方向键微调；Home / End 调至两端"
    onPointerDown={event => start(side, event)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
    onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); resize(side, event.key === 'Home' ? bounds[side].min : event.key === 'End' ? bounds[side].max : layout[side] + (event.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1)); } }}/>
  const currentInList = sessions.some(value => value.id === session.id);
  return <main id="main-content" className="simulation-monitor" aria-busy={switching} style={{ '--monitor-left': `${layout.left}px`, '--monitor-right': `${layout.right}px` } as CSSProperties}>
    <h1 className="sr-only">{session.title}</h1>
    <WorkspaceHeader><div className="simulation-context">
      <button type="button" className="monitor-icon" aria-label="返回世界线列表" onClick={onBack}><ArrowLeft size={18}/></button>
      <Select className="sim-session-picker" aria-label="当前世界线" title={sessions.find(value => value.id === requestedSession)?.title || session.title} value={requestedSession} disabled={busy && !switching} onChange={event => onSession(event.target.value)}>
        {!currentInList && <option value={session.id}>{session.title}</option>}{sessions.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
      </Select>
      <span className={`monitor-status ${running ? 'is-running' : ''}`} title={session.error || undefined}><Radio size={13}/>{simStatus[session.status] || session.status}</span>
      <span className="monitor-step">第{session.cursor}步</span>
      <button type="button" className={`monitor-icon ${budgetNotice ? 'has-notice' : ''}`} aria-label="额度与起点" disabled={switching} title={session.error || '起点与运行额度'} onClick={() => setBudget(true)}><Info size={17}/></button>
    </div></WorkspaceHeader>
    {switching && <div className="monitor-switch-status" role="status">{error || '正在切换世界线…'}{error && <Button variant="ghost" onClick={onRetry}>重试</Button>}</div>}
    <div className={`monitor-body ${layout.log ? 'has-log' : ''} ${layout.inspector ? 'has-inspector' : ''}`} inert={switching}>
      {layout.log && <><MonitorPane side="log" floating={narrow} onClose={() => set({ log: false })}>
        <SimulationLog session={session} events={events} name={name} portraits={portraits} selected={selected} character={focus?.kind === 'character' ? focus.id : undefined} onSelect={seq => select(seq, true)} scrollRef={log}/>
      </MonitorPane>{!narrow && divider('left')}</>}
      <section className="monitor-scene" aria-label="文本世界场景">
        <header className="scene-heading"><div className="scene-view-label"><Grid2X2 size={17}/><h2>世界视图</h2></div>
          <label className="scene-location"><MapPin size={15}/><span className="sr-only">查看场景地点</span><Select aria-label="查看场景地点" value={location} onChange={event => { setLocation(event.target.value); setAuto(false); }}><option value="">全部场景</option>{Object.keys(session.state.places).map(id => <option key={id} value={id}>{name(id)}</option>)}</Select></label>
          <span className="scene-observer">作者观察 · 独立模拟</span>
        </header>
        <div className="scene-participants">{Object.keys(session.state.agents).map(id => <button type="button" key={id} aria-label={name(id)} aria-pressed={focus?.kind === 'character' && focus.id === id} className={focus?.kind === 'character' && focus.id === id ? 'is-selected' : ''} onClick={() => inspect({ kind: 'character', id })}><Portrait id={id} name={name(id)} version={portraits[id]} size="small"/>{name(id)}</button>)}</div>
        {!switching && (error || (session.error && !budgetNotice) || connection) && <div className="monitor-feedback">{(error || (session.error && !budgetNotice)) && <ErrorNotice>{error || session.error}</ErrorNotice>}{connection && <div role="status">{connection}<Button variant="ghost" onClick={onRetry}>重新读取</Button></div>}</div>}
        {follow && <div className="scene-follow">跟随 {name(follow)} 的相关事件<Button variant="ghost" onClick={() => setFollow('')}>取消跟随</Button></div>}
        <div className="scene-feed" ref={feed} tabIndex={0} aria-label="可滚动的对话与演化记录" onScroll={() => { const element = feed.current; if (element) atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 50; }}>
          <div className="scene-start"><span>{session.manifest.setup.start_label}</span><small>起点已冻结 · 作者观察不改变角色知识</small></div>
          {!visible.length && <p className="monitor-empty">{events.length ? '没有符合场景或跟随条件的事件。' : '角色尚未开始行动。继续运行后，对话与世界变化会在这里出现。'}</p>}
          {visible.map(p => <SimulationMessage key={`${p.event.actor_id}:${p.event.seq}`} p={p} name={name} portraits={portraits} selected={selected === p.event.seq} related={focus?.kind === 'character' && p.involved.includes(focus.id)} onSelect={() => select(p.event.seq)} onCharacter={id => inspect({ kind: 'character', id })}/>)}
          {session.stream.filter(value => (!location || session.state.agents[value.actor_id]?.location === location) && (!follow || value.actor_id === follow)).map(value => <article key={value.id} className="scene-entry scene-entry--pending" aria-label="生成中待确认文本"><Portrait id={value.actor_id} name={name(value.actor_id)} version={portraits[value.actor_id]}/><div className="scene-entry-content"><header><strong>{name(value.actor_id)}</strong><span className="scene-entry-meta">生成中 · 尚未提交</span></header><div className="scene-bubble">{value.draft || '正在决定下一步行动…'}</div></div></article>)}
          <div className="scene-end">{running ? '世界正在演化' : session.status === 'completed' ? '本段演化结束' : '世界已暂停'} · 已保存第{session.cursor}步</div>
          {budgetNotice && <p className="scene-budget-note">{session.error}<button type="button" onClick={() => setBudget(true)}>查看额度</button></p>}
        </div>
        {(unread || !auto) && <button type="button" className="scene-latest" onClick={latest}><ChevronDown size={15}/>{unread ? '回到最新消息' : '跟随最新消息'}</button>}
        <footer className="monitor-dock" aria-label="世界线控制">
          <button type="button" className="monitor-icon" aria-label="显示世界日志" aria-pressed={layout.log} onClick={() => toggle('log')}><PanelLeft size={18}/></button>
          <button type="button" className="dock-run" aria-label={running ? '暂停并保存' : '继续运行'} disabled={busy || session.status === 'completed' || (!running && exhausted)} title={session.status === 'completed' ? '本段已完成' : exhausted ? '本段运行额度已到达' : running ? '暂停并保存' : '继续运行会调用模型'} onClick={() => onControl(running ? 'pause' : 'resume')}><span>{running ? <Pause size={19}/> : <Play size={19}/>}</span>{session.status === 'completed' ? '已完成' : !running && exhausted ? '已到额度' : running ? '暂停' : '继续'}</button>
          <button type="button" className="dock-follow" aria-label="跟随最新消息" aria-pressed={auto} onClick={() => auto ? setAuto(false) : latest()}><ChevronDown size={15}/><span>跟随最新</span></button>
          <Link to={`/worlds/${session.world_id}/review/simulation`}><CheckCheck size={17}/><span>审阅结果</span></Link>
          <button type="button" className="monitor-icon" aria-label="显示模拟详情" aria-pressed={layout.inspector} onClick={() => toggle('inspector')}><PanelRight size={18}/></button>
          <details className="monitor-more"><summary aria-label="更多模拟操作" title="更多操作"><Ellipsis size={19}/></summary><div onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.parentElement?.removeAttribute('open'); }}>
            <button type="button" onClick={() => setBudget(true)}><Info size={15}/>起点与额度</button><button type="button" onClick={reset}><RotateCcw size={15}/>恢复默认布局</button><button type="button" onClick={onBack}><ArrowLeft size={15}/>世界线列表</button>
          </div></details>
        </footer>
      </section>
      {layout.inspector && <>{!narrow && divider('right')}<MonitorPane side="inspector" floating={narrow} onClose={() => set({ inspector: false })}>
        <SimulationInspector session={session} focus={focus} events={events} portraits={portraits} busy={busy} name={name} onFocus={inspect} onPropose={onPropose} onPortrait={setPortrait} follow={follow} onFollow={setFollow}/>
      </MonitorPane></>}
    </div>
    {budget && <Dialog title="这段世界线的起点与额度" onClose={() => setBudget(false)}><p>{session.manifest.setup.start_label}</p><p>{session.manifest.setup.time_basis}</p><p>行动步：{session.cursor} / {session.manifest.setup.max_steps}</p><p>模型请求：{session.calls} / {session.manifest.setup.max_calls}</p><p>费用／预留：¥{session.cost.toFixed(4)} / ¥{session.manifest.setup.budget_yuan.toFixed(2)}</p>{session.error && <p>{session.error}</p>}<p>继续运行会调用模型。创建起点、阅读记录和选择审阅提案无需调用模型。</p><p>模拟结果进入正式设定仍需你显式接受。</p><Button onClick={() => setBudget(false)}>关闭</Button></Dialog>}
    {portrait && <PortraitEditor id={portrait} name={name(portrait)} world={session.world_id} onSaved={() => { void reload().catch(() => setPortrait('')); }} onClose={() => setPortrait('')}/>}
  </main>;
}
