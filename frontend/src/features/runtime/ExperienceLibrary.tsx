import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, ErrorNotice } from "../../components/ui";
import { purposeNames, runtimeRequest, type Worldline } from "./api";
export function ExperienceLibrary({
  world,
  filter,
  onOpen,
  onAvailable,
}: {
  world: string;
  filter: string;
  onOpen: (id: string) => void;
  onAvailable: (ready: boolean) => void;
}) {
  const [available, setAvailable] = useState(false),
    [lines, setLines] = useState<Worldline[]>([]),
    [error, setError] = useState("");
  const [statusFilter,setStatusFilter]=useState('all'),[sort,setSort]=useState('recent'),[query,setQuery]=useState('');
  useEffect(() => {
    setAvailable(false);
    setLines([]);
    onAvailable(false);
    let active = true;
    const abort = new AbortController();
    (async () => {
      try {
        if (!(await window.aetherloomRuntime?.available())) return;
        const session = await window.aetherloomRuntime!.session(
          world,
          "creator_observer",
        );
        if (!session || !active) return;
        setAvailable(true);
        onAvailable(true);
        const list = await runtimeRequest<Worldline[]>(
          session,
          "/worldlines",
          abort.signal,
        );
        if (active) setLines(list);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
      abort.abort();
    };
  }, [world, onAvailable]);
  const visibleLines=useMemo(()=>{
    const filtered=lines.filter(line=>{
      const haystack=[line.title,line.purpose,line.control_status,...(line.event_types||[]),...(line.actor_ids||[]),...(line.location_ids||[])].filter(Boolean).join(' ').toLowerCase();
      return (filter==='all'||(line.purpose||'unclassified')===filter) && (statusFilter==='all'||(line.control_status||'paused')===statusFilter) && (!query||haystack.includes(query.toLowerCase()));
    });
    return filtered.sort((left, right) => sort === 'title'
      ? String(left.title || left.worldline_id).localeCompare(String(right.title || right.worldline_id), 'zh-CN')
      : sort === 'oldest'
        ? (left.seq || 0) - (right.seq || 0)
        : (right.seq || 0) - (left.seq || 0));
  },[lines,filter,statusFilter,sort,query]);
  function depth(line:Worldline){let current=line,count=0;const byId=new Map(lines.map(value=>[value.worldline_id,value]));while(current.parent_worldline_id&&count<8){count++;const parent=byId.get(current.parent_worldline_id);if(!parent)break;current=parent;}return count;}
  const statusNames:Record<string,string>={paused:'已暂停',running:'运行中',recovery_required:'需要恢复',completed:'已完成',error:'错误'};
  if (!available) return null;
  return (
    <section className="academy-library" aria-label="已保存的新世界线">
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="academy-library-filters" aria-label="世界线浏览筛选"><label>搜索世界线、角色、地点或事件<input aria-label="世界线检索" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索世界线…"/></label><label>运行状态<select aria-label="世界线状态筛选" value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="all">全部状态</option>{Object.entries(statusNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>排序<select aria-label="世界线排序" value={sort} onChange={event=>setSort(event.target.value)}><option value="recent">最近活动</option><option value="oldest">最早起点</option><option value="title">名称</option></select></label></div>
      {visibleLines.map((line) => (
          <article key={line.worldline_id} className="sim-worldline" style={{marginLeft:`${Math.min(depth(line),4)*18}px`}}>
            <div>
              <span className="eyebrow">
                {purposeNames[line.purpose || ""] || "既有 Runtime · 未分类"}
              </span>
              <h2>{line.title || line.worldline_id}</h2>
              <p>{line.parent_worldline_id ? `分支 · 父线第${line.parent_anchor_seq}步 · ` : "独立保存的起点与演化 · "}{statusNames[line.control_status||'paused']||line.control_status||'已暂停'} · 第{line.seq||0}步 · 逻辑时刻 {line.sim_time_tick ?? '未知'} · 不自动进入原作 Canon</p>
              {line.event_types?.length?<small>事件 {line.event_types.join('、')} · 角色 {line.actor_ids?.length||0} · 地点 {line.location_ids?.length||0}</small>:null}
            </div>
            <Button onClick={() => onOpen(line.worldline_id)}>
              打开世界线
              <ArrowRight size={15} />
            </Button>
          </article>
        ))}
      {!visibleLines.length&&<p className="context-hint">没有符合当前筛选条件的世界线。</p>}
    </section>
  );
}
