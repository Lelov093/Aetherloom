import {useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {GitBranch,ArrowRight} from 'lucide-react';
import {Button,ErrorNotice} from '../../components/ui';
import {useWorkspaceTrail} from '../../components/WorkspaceContext';
import {SimulationSetup} from './SimulationSetup';
import {SimulationMonitor} from './SimulationMonitor';
import {simApi,simStatus,type Session} from './api';

export function SimulationWorkspace({world}:{world:string}){
 const [params,setParams]=useSearchParams(),id=params.get('session');
 const [sessions,setSessions]=useState<Session[]>([]),[session,setSession]=useState<Session>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[connection,setConnection]=useState(''),[draftCycle,setDraftCycle]=useState(0),[loading,setLoading]=useState(true);
 useWorkspaceTrail([{label:session?.title||'世界模拟'}]);
 const reloadList=()=>simApi.list(world).then(setSessions);
 const reload=()=>id?simApi.get(id).then(setSession).catch(e=>setError(e.message)):reloadList();
 useEffect(()=>{let active=true;setLoading(true);void simApi.list(world).then(list=>{if(active)setSessions(list)}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[world,id]);
 useEffect(()=>{
  setSession(undefined);setError('');setConnection('');if(!id)return;
  let active=true;const load=()=>simApi.get(id).then(s=>{if(active)setSession(s)}).catch(e=>{if(active)setError(e.message)});
  void load();const stream=new EventSource(`/api/simulations/${id}/stream`);
  stream.addEventListener('committed',()=>{void load()});
  stream.addEventListener('status',event=>{const status=JSON.parse((event as MessageEvent).data);if(active){setSession(s=>s?{...s,...status}:s);setConnection('')}});
  stream.onerror=()=>{if(active)setConnection('连接暂时中断，正在重连；已保存结果和世界运行独立于页面。')};
  return()=>{active=false;stream.close()};
 },[id]);
 async function control(action:string){if(!id)return;setBusy(true);setError('');try{await simApi.control(id,action);setSession(await simApi.get(id));await reloadList()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function propose(seq:number,kind:string){if(!id)return;setBusy(true);try{const p=await simApi.propose(id,seq,kind);setSession(await simApi.get(id));setError('');window.location.hash=`/worlds/${world}/review/simulation?proposal=${p.id}`}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 function newScene(){sessionStorage.removeItem(`aetherloom:simulation-draft:${world}`);setDraftCycle(n=>n+1);setParams({setup:'new'})}
 if(id&&session)return <SimulationMonitor key={id} session={session} busy={busy} error={error} connection={connection} onControl={control} onPropose={propose} onBack={()=>setParams({})} onRetry={()=>{void reload()}}/>;
 const setup=params.has('setup')||params.has('source');
 return <main id="main-content" className="page simulation-page"><header className="page-heading"><div><span className="eyebrow">SIMULATION · 独立世界线</span><h1>{setup?'为故事准备一个起点':'你的世界线'}</h1><p>{setup?'只准备本次真正需要的人物、地点与信息，再冻结起点。':'从已保存的起点观察人物、对话与世界变化。结果进入正式设定仍需你的审阅。'}</p></div>{!setup&&<Button variant="primary" onClick={newScene}>准备新场景</Button>}</header>
 {error&&<ErrorNotice>{error}</ErrorNotice>}
 {id?<><p role="status">{error?'世界线读取失败，请重试。':'正在打开已保存世界线…'}</p>{error&&<Button onClick={()=>{void reload()}}>重新读取</Button>}</>:setup?<><Button variant="ghost" onClick={()=>setParams({})}>← 返回世界线列表</Button><SimulationSetup key={draftCycle} world={world} onCreated={()=>{void reloadList()}}/></>:loading?<p role="status">正在读取世界线…</p>:<section className="sim-library" aria-label="已保存世界线">{sessions.length===0?<div className="sim-library-empty"><GitBranch size={32}/><h2>让第一段世界线从这里开始</h2><p>选取已有资料，安排参与角色与起点。创建不会调用模型。</p><Button variant="primary" onClick={newScene}>准备新场景</Button></div>:sessions.map(s=><article className="sim-worldline" key={s.id}><span className="sim-worldline-icon"><GitBranch size={22}/></span><div><span className="eyebrow">{simStatus[s.status]||s.status}</span><h2>{s.title}</h2><p>第{s.cursor}步 · {s.calls}次请求 · 费用／预留 ¥{s.cost.toFixed(4)}</p></div><Button onClick={()=>setParams({session:s.id})}>打开世界线<ArrowRight size={16}/></Button></article>)}</section>}
 </main>;
}
