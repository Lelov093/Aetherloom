import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, List, MapPin, PenTool, Plus, Settings, Type } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { useWorkspaceTrail } from '../../components/WorkspaceContext';
import { featureKinds, featureName, mapPath, mapsApi, type FeatureKind, type MapDetail, type MapDirectory, type MapFeature, type MapInfo, type Point } from './api';
import { MapBoard, type MapLocate } from './MapBoard';
import { FeatureForm, MapForm, type DrawFeature } from './MapForms';
import { momentLabel, periodCardPath, readMoment, storyParams, withMoment, type StoryMoment } from '../periods/api';
import { MapPeriodDialog } from '../periods/PeriodViews';
import '../../styles/author-maps.css';

type MapCrumb = { id: string; item?: string };

function mapAncestors(directory: MapDirectory | undefined, target: string, visited: MapCrumb[] | undefined): MapCrumb[] {
  if (!directory || !target) return [];
  if (Array.isArray(visited) && visited.length && visited.every((entry, index) => directory.links.some(
    link => link.map_id === entry?.id && link.child_map_id === (visited[index + 1]?.id ?? target)
  ))) return visited;
  const first = directory.maps[0]?.id;
  if (!first || first === target) return [];
  const paths = [[first]];
  const seen = new Set([first]);
  for (const path of paths) {
    for (const link of directory.links) {
      if (link.map_id !== path.at(-1) || seen.has(link.child_map_id)) continue;
      if (link.child_map_id === target) return path.map(id => ({ id }));
      seen.add(link.child_map_id);
      paths.push([...path, link.child_map_id]);
    }
  }
  return [];
}

export function AuthorMaps({ world, archived }: { world: string; archived: boolean }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [directory, setDirectory] = useState<MapDirectory>();
  const [map, setMap] = useState<MapDetail>();
  const [directoryProblem, setDirectoryProblem] = useState('');
  const [mapProblem, setMapProblem] = useState('');
  const [refreshDirectory, setRefreshDirectory] = useState(0);
  const [refreshMap, setRefreshMap] = useState(0);
  const [mapForm, setMapForm] = useState<{ map?: MapInfo; parent?: MapFeature }>();
  const [tool, setTool] = useState<DrawFeature>();
  const [vertices, setVertices] = useState<Point[]>([]);
  const [form, setForm] = useState<DrawFeature & { points: Point[] }>();
  const [listOpen, setListOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [locate, setLocate] = useState<MapLocate>();
  const [notice, setNotice] = useState('');
  const mapId = params.get('map') || directory?.maps[0]?.id || '';
  const current = map?.id === mapId ? map : undefined;
  const target = params.get('locate');
  const selected = current?.features.find(item => item.id === (target || params.get('item')));
  const parents = mapAncestors(directory, mapId, location.state?.mapAncestors);
  const moment = readMoment(params);
  const branch = target ? { id: target, key: location.key } : locate;
  useWorkspaceTrail([{ label: current?.title || '作者地图' }]);

  useEffect(() => {
    let active = true;
    setDirectoryProblem('');
    mapsApi.list(world).then(value => { if (active) setDirectory(value); })
      .catch(e => { if (active) setDirectoryProblem(e.message); });
    return () => { active = false; };
  }, [world, refreshDirectory]);
  useEffect(() => {
    if (!mapId) return;
    let active = true;
    setMapProblem('');
    mapsApi.map(world, mapId).then(value => { if (active) setMap(value); })
      .catch(e => { if (active) setMapProblem(e.message); });
    return () => { active = false; };
  }, [world, mapId, refreshMap]);
  useEffect(() => {
    setTool(undefined); setForm(undefined); setVertices([]); setLocate(undefined); setNotice(''); setPeriodOpen(false);
  }, [mapId]);

  function select(item?: string) {
    const next = new URLSearchParams(params);
    next.delete('locate');
    if (item) next.set('item', item); else next.delete('item');
    if (params.toString() !== next.toString()) setParams(next, { replace: true, state: location.state });
  }
  function located(id: string) {
    if (id === target) {
      const found = current?.features.some(item => item.id === id);
      select(found ? id : undefined);
      if (!found) setNotice('这项标注已移除。可从地图要素列表选择其他位置。');
    }
    setLocate(undefined);
  }
  function locateItem(item: MapFeature) {
    select(item.id);
    setLocate({ id: item.id, key: crypto.randomUUID() });
  }
  function changeMoment(point: StoryMoment) {
    const next = new URLSearchParams(params);
    for (const key of ['at_year','at_event','event_side']) next.delete(key);
    for (const [key,value] of Object.entries(storyParams(point))) next.set(key,value);
    setParams(next,{replace:true,state:location.state});
  }
  function begin(kind: FeatureKind, feature?: MapFeature) {
    setVertices([]);
    setTool({ kind, feature });
  }
  function finish(points: Point[]) {
    if (!tool) return;
    setForm({ ...tool, points });
    setTool(undefined); setVertices([]);
  }
  function addPoint(point: Point) {
    if (tool?.kind === 'region') {
      if (vertices.length < 120) setVertices([...vertices, point]);
    } else finish([point]);
  }
  function saveFeature(feature: MapFeature) {
    setMap(value => value ? { ...value, features: value.features.some(item => item.id === feature.id)
      ? value.features.map(item => item.id === feature.id ? feature : item) : [...value.features, feature] } : value);
    setForm(undefined);
    select(feature.id);
    setRefreshDirectory(n => n + 1);
  }
  function saveMap(saved: MapInfo) {
    const editing = Boolean(mapForm?.map);
    const from = mapForm?.parent && current ? [...parents, { id: current.id, item: mapForm.parent.id }] : [];
    setMapForm(undefined);
    setRefreshDirectory(n => n + 1);
    if (editing) setMap(value => value ? { ...value, ...saved } : value);
    else navigate(withMoment(mapPath(world, saved.id), moment), { state: { mapAncestors: from } });
  }

  return <main id="main-content" className="author-maps">
    <section className="author-map-workbench" aria-label="作者地图">
      <header className="author-map-heading">
        <div>
          {parents.length > 0 && <nav className="author-map-ancestors" aria-label="地图层级">
            {parents.map(({ id, item }, i) => <span key={id}><Link to={withMoment(mapPath(world, id, item ? { id: item } : undefined), moment)} state={{ mapAncestors: parents.slice(0, i) }}>
              {i === 0 && <ArrowLeft size={13}/>} {directory?.maps.find(entry => entry.id === id)?.title}
            </Link><ChevronRight size={12}/></span>)}
          </nav>}
          <h1>{current?.title ?? '作者地图'}</h1>
        </div>
        <div className="author-map-switcher">
          {!!directory?.maps.length && <select aria-label="切换地图" value={mapId} disabled={!!tool}
            onChange={e => navigate(withMoment(mapPath(world, e.target.value), moment))}>
            {directory.maps.map((item, i) => <option key={item.id} value={item.id}>{item.title}{i === 0 ? ' · 主图' : ''}</option>)}
          </select>}
          {!archived && <Button variant="primary" disabled={!!tool} onClick={() => setMapForm({})}><Plus size={16}/>新建地图</Button>}
        </div>
      </header>
      <nav className="author-map-navigation" aria-label="探索视图">
        <Link to={withMoment(`/worlds/${world}/explore`, moment)}>关系</Link>
        <Link to={`/worlds/${world}/explore?view=timeline`}>时间</Link>
        <span aria-current="page">地图</span>
        <Link to={withMoment(`/worlds/${world}/explore?view=map`, moment)}>地点连通</Link>
      </nav>
      {directoryProblem && <div className="author-map-message"><ErrorNotice>{directoryProblem}</ErrorNotice>
        <Button onClick={() => setRefreshDirectory(n => n + 1)}>重新读取地图目录</Button></div>}
      {mapProblem && <div className="author-map-message"><ErrorNotice>{mapProblem}</ErrorNotice>
        <Button onClick={() => setRefreshMap(n => n + 1)}>重新读取地图</Button>
        <Link className="text-link" to={mapPath(world)}>返回地图目录</Link></div>}
      {!current && !mapProblem && !directoryProblem && <div className="author-map-empty">
        {mapId || !directory ? <p role="status">正在读取地图…</p> :
          <><MapPin size={34} strokeWidth={1.35}/><h2>还没有地图</h2><p>新建地图后，可以导入底图或从空白画布开始。</p></>}
      </div>}
      {current && <>
        <div className="author-map-tools" aria-label="地图工具">
          {!archived && <>
            <Button disabled={!!tool} onClick={() => begin('marker')}><MapPin size={16}/>添加地点标记</Button>
            <Button disabled={!!tool} onClick={() => begin('region')}><PenTool size={16}/>勾画区域</Button>
            <Button disabled={!!tool} onClick={() => begin('label')}><Type size={16}/>添加文字标签</Button>
          </>}
          <div className="author-map-tools-end">
            <Button variant="ghost" disabled={!!tool} onClick={() => setListOpen(true)}><List size={16}/>地图要素</Button>
            {!archived && <Button variant="ghost" disabled={!!tool} onClick={() => setMapForm({ map: current })}><Settings size={16}/>地图设置</Button>}
          </div>
        </div>
        <MapBoard key={current.id} world={world} map={current} selected={selected?.id} locate={branch} onLocated={located}
          drawing={Boolean(tool)} vertices={vertices} onPoint={addPoint} onSelect={select}/>
        <div className="author-map-action">
          {tool ? <>
            <span role="status">{tool.kind === 'region' ? `点击转角 · 已放置 ${vertices.length} 个` : '在画布上点击要放置的位置'}</span>
            {tool.kind === 'region' && <>
              <Button disabled={!vertices.length} onClick={() => setVertices(vertices.slice(0, -1))}>撤销转角</Button>
              <Button variant="primary" disabled={vertices.length < 3} onClick={() => finish(vertices)}>完成勾边</Button>
            </>}
            <Button variant="ghost" onClick={() => { setTool(undefined); setVertices([]); }}>取消绘制</Button>
          </> : selected ? <>
            <div className="author-map-selection" title={featureName(selected)}><strong>{featureName(selected)}</strong>
              <small>{moment ? momentLabel(moment) : featureKinds[selected.kind]}{selected.kind !== 'label' && !selected.child_map_id ? ' · 尚无子图' : ''}</small></div>
            {moment && selected.entity && <Button variant="ghost" onClick={() => setPeriodOpen(true)}>查看时期资料</Button>}
            {selected.entity && <Link className="button button--ghost" to={moment ? periodCardPath(world, selected.entity.id, moment) : `/worlds/${world}/create/objects/${selected.entity.id}`}
              state={{ mapWorld: world }}>{selected.entity.kind === 'location' ? '打开地点卡' : '打开对象卡'}</Link>}
            {selected.child_map_id ? <Link className="button button--primary" to={withMoment(mapPath(world, selected.child_map_id), moment)}
              state={{ mapAncestors: [...parents, { id: current.id, item: selected.id }] }}>进入子图<ChevronRight size={14}/></Link> :
              !archived && selected.kind !== 'label' && <Button onClick={() => setMapForm({ parent: selected })}>新建子图</Button>}
            {!archived && <>
              <Button variant="ghost" onClick={() => setForm({ kind: selected.kind, feature: selected, points: selected.points })}>编辑要素</Button>
              <Button variant="ghost" onClick={() => begin(selected.kind, selected)}>{selected.kind === 'region' ? '重画边界' : '重新放置'}</Button>
            </>}
          </> : <span role="status">{notice || `${current.features.length} 项地图要素`}</span>}
        </div>
        {periodOpen && moment && selected?.entity && <MapPeriodDialog world={world} entity={selected.entity.id} moment={moment}
          onChange={changeMoment} onClose={() => setPeriodOpen(false)}/>}
        {listOpen && <Dialog title="地图要素" onClose={() => setListOpen(false)} focusFirstInput={false}>
          {current.features.length ? <ul className="author-map-items">{current.features.map(item =>
            <li key={item.id}><span><strong>{featureName(item)}</strong><small>{featureKinds[item.kind]}</small></span>
              <Button aria-label={`定位 ${featureName(item)}`} onClick={() => { setListOpen(false); locateItem(item); }}>定位</Button>
            </li>)}</ul> : <p>当前地图还没有标注。</p>}
        </Dialog>}
        {form && <FeatureForm world={world} map={current.id} maps={directory?.maps ?? []} {...form}
          onClose={() => setForm(undefined)} onSaved={saveFeature} onRemoved={id => {
            setMap(value => value ? { ...value, features: value.features.filter(item => item.id !== id) } : value);
            setForm(undefined);
            select();
            setRefreshDirectory(n => n + 1);
          }}/>}
      </>}
      {mapForm && <MapForm world={world} {...mapForm} onClose={() => setMapForm(undefined)} onSaved={saveMap}/>}
    </section>
  </main>;
}
