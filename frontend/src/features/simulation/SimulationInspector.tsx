import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Flag, UserRound, ImagePlus, Activity, BookOpen, History, ArrowUpRight, MessageCircle, ShieldAlert, FileText } from 'lucide-react';
import { Button } from '../../components/ui';
import { Portrait } from '../objects/Portrait';
import { simStatus, type Session } from './api';
import type { PresentedEvent } from './presentation';
import { StateChanges } from './StateChanges';

export type Focus = { kind: 'event'; seq: number } | { kind: 'character' | 'location'; id: string };
function Section({ title, icon, children, className = '' }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`inspector-section ${className}`}><h3>{icon}{title}</h3>{children}</section>;
}
export function SimulationInspector({ session, focus, events, portraits, busy, name, onFocus, onPropose, onPortrait, follow, onFollow }: {
  session: Session; focus: Focus | undefined; events: PresentedEvent[]; portraits: Record<string, number>; busy: boolean;
  name: (id: string) => string; onFocus: (focus: Focus) => void; onPropose: (seq: number, kind: string) => void; onPortrait: (id: string) => void; follow: string; onFollow: (id: string) => void;
}) {
  const [tab, setTab] = useState('overview');
  const body = useRef<HTMLDivElement>(null);
  const tabId = useId();
  const focusKey = !focus ? 'world' : focus.kind === 'event' ? `event:${focus.seq}` : `${focus.kind}:${focus.id}`;
  useLayoutEffect(() => { setTab('overview'); }, [focusKey]);
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = 0; }, [focusKey, tab]);
  const p = focus?.kind === 'event' ? events.find(value => value.event.seq === focus.seq) : undefined;
  const character = focus?.kind === 'character' ? focus.id : undefined, agent = character ? session.state.agents[character] : undefined;
  const place = focus?.kind === 'location' ? focus.id : undefined;
  const latest = character ? events.filter(value => value.involved.includes(character)).at(-1) : undefined;
  const tabs = [{ id: 'overview', label: '检视' }, ...(agent ? [{ id: 'history', label: '经历' }] : p ? [{ id: 'changes', label: '变化' }] : []), { id: 'source', label: '来源' }];
  const memories = agent?.memories || [];
  const memoryList = (limit?: number) => (limit ? memories.slice(-limit) : memories).map(memory => <button type="button" className="inspector-memory" key={memory.event_seq} onClick={() => onFocus({ kind: 'event', seq: memory.event_seq })}><span>第{memory.event_seq}步</span><span>{memory.text}</span><ArrowUpRight size={13}/></button>);
  return <>
    <div className="monitor-inspector-tabs" role="tablist" aria-label="模拟详情内容">{tabs.map((value, index) => <button key={value.id} type="button" id={`${tabId}-${value.id}`} role="tab" tabIndex={tab === value.id ? 0 : -1} aria-selected={tab === value.id} aria-controls={`${tabId}-panel`} onClick={() => setTab(value.id)} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      setTab(tabs[next].id); document.getElementById(`${tabId}-${tabs[next].id}`)?.focus();
    }}>{value.label}</button>)}</div>
    <div ref={body} className="monitor-inspector-body" id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`}>
      {tab === 'source' ? <>
        <div className="inspector-identity"><FileText size={26}/><div><span className="inspector-kicker">不可变起点</span><h2>本次冻结资料</h2></div></div>
        <Section title="世界线起点" icon={<MapPin size={15}/>}><p>{session.manifest.setup.start_label}</p><p className="inspector-secondary">{session.manifest.setup.time_basis}</p></Section>
        {agent && <Section title="起点角色背景" icon={<UserRound size={15}/>}><p>{session.initial_state.agents[character!]?.persona || '未填写背景'}</p></Section>}
        <Section title="已保存来源" icon={<BookOpen size={15}/>}>
          {session.manifest.materials.length ? session.manifest.materials.map((material, index) => <Link key={index} className="inspector-source-link" to={`/worlds/${session.world_id}/create/source?simulation=${session.id}&index=${index}`}><span>{material.title}<small>保存版本 v{material.version}</small></span><ArrowUpRight size={15}/></Link>) : <p className="inspector-secondary">本次未选入正文资料。正式起点与角色知识仍按创建时保存的信息读取。</p>}
        </Section><p className="inspector-boundary">旧世界线不随当前Canon或资料编辑改变。</p>
      </> : tab === 'history' && agent ? <>
        <div className="inspector-identity"><History size={25}/><div><span className="inspector-kicker">当前 · 第{session.cursor}步</span><h2>{name(character!)}的经历</h2></div></div>
        <p className="inspector-secondary">共{memories.length}项保存经历，点击回到对应事件。</p>{memories.length ? memoryList() : <p className="inspector-secondary">还没有保存经历。</p>}
      </> : tab === 'changes' && p ? <>
        <div className="inspector-identity"><Activity size={25}/><div><span className="inspector-kicker">第{p.event.seq}步 · 当步事件</span><h2>前后状态</h2></div></div>
        <div className="inspector-change-list"><StateChanges diff={p.event.diff} name={name}/></div>{!p.event.accepted && <p className="inspector-boundary">行动未成立，世界状态未按提议改变。</p>}
      </> : <>
        {!focus && <>
          <div className="inspector-identity"><Activity size={27}/><div><span className="inspector-kicker">独立模拟 · 第{session.cursor}步</span><h2>观察世界中的变化</h2></div></div>
          <p className="inspector-secondary">选择角色查看当前状态，选择记录查看当步变化。</p>
          <Section title="参与角色" icon={<UserRound size={15}/>}><div className="inspector-people">{Object.keys(session.state.agents).map(id => <button type="button" key={id} onClick={() => onFocus({ kind: 'character', id })}><Portrait id={id} name={name(id)} version={portraits[id]} size="small"/><span>{name(id)}<small>{name(session.state.agents[id].location)}</small></span><ArrowUpRight size={14}/></button>)}</div></Section>
          <Section title="场景地点" icon={<MapPin size={15}/>}><div className="inspector-inline-links">{Object.keys(session.state.places).map(id => <button type="button" key={id} onClick={() => onFocus({ kind: 'location', id })}>{name(id)}<ArrowUpRight size={13}/></button>)}</div></Section>
          <p className="inspector-boundary">作者观察视角不会把未获知的信息交给角色。</p>
        </>}
        {character && agent && <>
          <div className="inspector-identity inspector-person"><Portrait id={character} name={name(character)} version={portraits[character]} size="large"/><div><span className="inspector-kicker">模拟角色</span><h2 title={name(character)}>{name(character)}</h2><span className="inspector-badge">当前 · 第{session.cursor}步</span><button type="button" className="inspector-portrait-link" onClick={() => onPortrait(character)}><ImagePlus size={12}/>设置头像</button></div></div>
          <Section title="当前状态" icon={<Activity size={15}/>}>
            <dl className="inspector-state"><div><dt>所在</dt><dd><button type="button" onClick={() => onFocus({ kind: 'location', id: agent.location })}><MapPin size={12}/>{name(agent.location)}<ArrowUpRight size={12}/></button></dd></div>
              <div><dt>世界线</dt><dd>{simStatus[session.status] || session.status}</dd></div><div><dt>知识</dt><dd>已知／收到 {Object.keys(agent.known).length}项</dd></div><div><dt>经历</dt><dd>{agent.memories.length}项</dd></div></dl>
          </Section>
          {latest && <Section title="最近相关行动" icon={<MessageCircle size={15}/>}><button type="button" className="inspector-action-link" onClick={() => onFocus({ kind: 'event', seq: latest.event.seq })}><span className="inspector-kicker">第{latest.event.seq}步 · {latest.kind}</span><span>{latest.event.narration}</span><ArrowUpRight size={14}/></button></Section>}
          <Section title="目标" icon={<Flag size={15}/>} className="inspector-goal"><p>{agent.goal || '未填写目标'}</p></Section>
          <Button className="inspector-follow" aria-pressed={follow === character} onClick={() => onFollow(follow === character ? '' : character)}>{follow === character ? '取消跟随' : '跟随此角色的事件'}</Button>
          <Section title="知识与信念" icon={<BookOpen size={15}/>}><details><summary>查看依据与信念</summary><p>信念（可能错误）：{agent.beliefs.join('；') || '无'}</p>{Object.entries(agent.known).map(([key, value]) => { const record = value as { text?: string; basis?: string; sender_id?: string }; return <p key={key}>{record.text}<small>{record.basis === 'reported' ? `收到${name(record.sender_id || '')}的报告，不自动确认为真` : '用户确认的起点知识'}</small></p>; })}</details></Section>
          <Section title="近期经历" icon={<History size={15}/>}>
            {memories.length ? memoryList(2) : <p className="inspector-secondary">还没有保存经历。</p>}<button type="button" className="inspector-show-all" onClick={() => setTab('history')}>查看全部{memories.length}项经历<ArrowUpRight size={13}/></button>
          </Section><Link className="inspector-source-link" to={`/worlds/${session.world_id}/create/objects/${character}`}><span>查看正式对象资料</span><ArrowUpRight size={15}/></Link>
        </>}
        {p && <>
          <div className="inspector-identity"><span className={`inspector-event-icon ${!p.event.accepted ? 'is-blocked' : ''}`}>{p.event.accepted ? <Activity size={24}/> : <ShieldAlert size={24}/>}</span><div><span className="inspector-kicker">第{p.event.seq}步 · 当步事件</span><h2>{p.kind}</h2><span className={`inspector-badge ${!p.event.accepted ? 'is-blocked' : ''}`}>{p.event.accepted ? '已提交' : '未成立'}</span></div></div>
          <p className="inspector-event-text">{p.event.narration}</p><p className="inspector-boundary">这是当步记录；角色详情展示当前第{session.cursor}步状态。</p>
          <Section title="参与者与地点" icon={<UserRound size={15}/>}><div className="inspector-inline-links"><button type="button" onClick={() => onFocus({ kind: 'character', id: p.event.actor_id })}>{name(p.event.actor_id)}<ArrowUpRight size={13}/></button>{p.recipients.map(id => <button type="button" key={id} onClick={() => onFocus({ kind: 'character', id })}>{name(id)}<ArrowUpRight size={13}/></button>)}{p.location && <button type="button" onClick={() => onFocus({ kind: 'location', id: p.location })}><MapPin size={13}/>{name(p.location)}<ArrowUpRight size={13}/></button>}</div></Section>
          <Section title="本步变化" icon={<Activity size={15}/>}><div className="inspector-change-list"><StateChanges diff={p.event.diff} name={name}/></div>{!p.event.accepted && <p>行动未成立，世界状态未按提议改变。</p>}</Section>
          {!!p.event.accepted && <Section title="交给你审阅" icon={<FileText size={15}/>} className="inspector-review"><p className="inspector-secondary">选择只建立提案，接受前不会写入正式设定。</p>{session.proposals.filter(value => value.seq === p.event.seq).map(value => <Link key={value.id} className="inspector-source-link" to={`/worlds/${session.world_id}/review/simulation?proposal=${value.id}`}><span>{value.kind === 'event' ? '事件' : '状态事实'} · {({ pending: '待审阅', accepted: '已接受', rejected: '已拒绝' } as Record<string, string>)[value.status]}</span><ArrowUpRight size={14}/></Link>)}
            <Button disabled={busy} onClick={() => onPropose(p.event.seq, 'event')}>选择事件进入 Review</Button>{['move', 'transfer', 'take', 'goal'].includes(p.event.payload.type) && <Button disabled={busy} onClick={() => onPropose(p.event.seq, 'assertion')}>选择状态事实进入 Review</Button>}
          </Section>}
        </>}
        {place && <>
          <div className="inspector-identity"><MapPin size={28}/><div><span className="inspector-kicker">当前地点 · 第{session.cursor}步</span><h2>{name(place)}</h2></div></div><p>{session.state.places[place]?.public_description || '未填写环境描述'}</p>
          <Section title="现在在场" icon={<UserRound size={15}/>}><div className="inspector-people">{Object.entries(session.state.agents).filter(([, agent]) => agent.location === place).map(([id]) => <button type="button" key={id} onClick={() => onFocus({ kind: 'character', id })}><Portrait id={id} name={name(id)} version={portraits[id]} size="small"/>{name(id)}<ArrowUpRight size={14}/></button>)}</div></Section>
          <Section title="物品与持有者" icon={<BookOpen size={15}/>}>
            {Object.entries(session.state.items).filter(([, holder]) => holder === place || session.state.agents[holder]?.location === place).map(([id, holder]) => <p key={id}>{name(id)} → {name(holder)}</p>)}
            {!Object.values(session.state.items).some(holder => holder === place || session.state.agents[holder]?.location === place) && <p className="inspector-secondary">此处没有记录的物品。</p>}
          </Section>
        </>}
      </>}
    </div>
  </>;
}
