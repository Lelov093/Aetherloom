import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { CanvasWorld } from "./CanvasWorld";
import { fitCamera, moveAvailable, scene2d } from "./scene2d";
import { runtimeRequest, RuntimeError, type Envelope, type HostSession, type ViewerLayout } from "./api";
import "../../styles/runtime-map.css";

interface Props { frame: Envelope; session: HostSession; connected: boolean; actor: string; onActor: (actor: string) => void }

export function RuntimeMap({ frame, session, connected, actor, onActor }: Props) {
  const p = frame.projection, canvas = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null);
  const renderer = useRef<CanvasWorld | null>(null), previous = useRef<Envelope | null>(null);
  const [layout, setLayout] = useState<ViewerLayout | null>(null), [ready, setReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 }), [target, setTarget] = useState("");
  const [edit, setEdit] = useState(false), [zoom, setZoom] = useState(1), [notice, setNotice] = useState("");
  const [failure, setFailure] = useState(""), [busy, setBusy] = useState(false);
  const cameraReady = useRef(false), savedCamera = useRef<ViewerLayout["camera"] | null>(null);
  const pending = useRef<{ cursor: string; request_id: string; action_type: string; args: { destination_id: string }; reason: string } | null>(null);
  const writes = useRef(Promise.resolve()), alive = useRef(true);
  const scene = useMemo(() => scene2d(p, layout), [p, layout]);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const drag = useRef<{ id: number; x: number; y: number; camera: ViewerLayout["camera"]; place?: { id: string; x: number; y: number }; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    try { renderer.current = new CanvasWorld(canvas.current!); }
    catch (e) { setFailure((e as Error).message); }
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect; setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(stage.current!);
    return () => { observer.disconnect(); renderer.current?.destroy(); renderer.current = null; };
  }, []);
  useEffect(() => {
    let active = true; alive.current = true;
    if (!window.aetherloomRuntime?.viewerLayout) {
      setReady(true); setFailure("桌面宿主版本已变化，请重启应用后使用 2D 视图。");
      return () => { active = false; alive.current = false; };
    }
    window.aetherloomRuntime.viewerLayout(p.worldline_id).then(value => {
      if (!active) return;
      savedCamera.current = value?.camera || null; setLayout(value); setReady(true);
    }).catch(() => { if (active) { setReady(true); setNotice("未能恢复布局，使用自动展示布局；可稍后保存。"); } });
    return () => { active = false; alive.current = false; };
  }, [p.worldline_id]);
  useLayoutEffect(() => {
    const view = renderer.current;
    if (!view || !ready || !size.width || !size.height) return;
    view.resize(size.width, size.height);
    if (!cameraReady.current) {
      view.camera = savedCamera.current || fitCamera(scene, size.width, size.height);
      cameraReady.current = true; setZoom(view.camera.zoom);
    }
    const before = previous.current, changed = frame.events.filter(e => !before?.events.some(old => old.event_id === e.event_id)).flatMap(e => e.actor_id ? [e.actor_id] : []);
    view.selected = actor; view.target = target;
    view.update(scene, Boolean(before && before !== frame && !p.historical && !before.projection.historical && frame.previous_cursor === before.cursor), changed);
    previous.current = frame;
  }, [scene, size, ready, actor, target, frame, p.historical]);

  function save() {
    const view = renderer.current; if (!view || !ready) return;
    const value: ViewerLayout = { version:1, camera:{...view.camera}, places:sceneRef.current.places.map(({id,x,y}) => ({id,x,y})) };
    writes.current = writes.current.catch(() => {}).then(async () => {
      try {
        await window.aetherloomRuntime!.viewerLayout(p.worldline_id, value);
        if (alive.current) setNotice("展示布局与镜头已保存，世界状态未改变。");
      } catch { if (alive.current) setNotice("布局暂未保存，可在连接恢复后重试；世界状态未改变。"); }
    });
  }
  function fit(reset = false) {
    const view = renderer.current; if (!view) return;
    const next = reset ? scene2d(p) : sceneRef.current;
    if (reset) { sceneRef.current = next; setLayout({ version:1, camera:view.camera, places:next.places.map(({id,x,y}) => ({id,x,y})) }); }
    view.camera = fitCamera(next, size.width, size.height); view.request(); setZoom(view.camera.zoom); save();
  }
  function scale(factor: number, at = { x: size.width/2, y:size.height/2 }) {
    const view = renderer.current; if (!view || !ready) return;
    const point = view.point(at.x,at.y), next = Math.min(3,Math.max(.15,view.camera.zoom*factor));
    view.camera = { x:at.x-point.x*next, y:at.y-point.y*next, zoom:next };
    setZoom(next); view.request(); save();
  }
  const scaleRef = useRef(scale); scaleRef.current = scale;
  useEffect(() => {
    const node = canvas.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const rect = node.getBoundingClientRect();
      scaleRef.current(Math.exp(-event.deltaY*.0015), { x:event.clientX-rect.left, y:event.clientY-rect.top });
    };
    node.addEventListener("wheel", wheel, { passive:false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);

  async function move() {
    if (busy || !connected || p.historical || (!pending.current && !moveAvailable(p,target,connected))) return;
    pending.current ||= { cursor:frame.cursor, request_id:crypto.randomUUID(), action_type:"move", args:{ destination_id:target }, reason:"" };
    setBusy(true); setNotice("");
    try {
      const receipt = await runtimeRequest<{ status:string; reason_code?:string }>(session,
        `/worldlines/${encodeURIComponent(p.worldline_id)}/actions`, undefined, "POST", pending.current);
      pending.current = null;
      if (!alive.current) return;
      setNotice(receipt.status === "committed" ? "移动已提交，等待世界同步。" : receipt.status === "rule_rejected"
        ? `移动被世界规则拒绝：${receipt.reason_code === "entry_requires_item" ? "缺少进入所需的物品" : receipt.reason_code}。失败经历已保存。`
        : "状态或运行控制已变化，请确认当前画面后重新提交。");
    } catch (e) {
      if (e instanceof RuntimeError) pending.current = null;
      if (alive.current) setNotice(e instanceof RuntimeError ? "此次移动未提交，请确认连接与当前世界状态。" : "移动结果尚未确认。重试将使用原请求编号。");
    } finally { if (alive.current) setBusy(false); }
  }

  return <section className="runtime-map" aria-label="2D 世界视图">
    <div className="runtime-map-toolbar">
      <div><strong>地点之间，世界之中</strong><span>示意布局 · 非地理坐标</span></div>
      <div className="runtime-map-tools">
        <Button variant="ghost" disabled={!ready} onClick={() => scale(.8)} aria-label="缩小地图">−</Button>
        <span aria-label="地图缩放">{Math.round(zoom*100)}%</span>
        <Button variant="ghost" disabled={!ready} onClick={() => scale(1.25)} aria-label="放大地图">＋</Button>
        <Button variant="ghost" disabled={!ready} onClick={() => fit()}>适应画布</Button>
      </div>
    </div>
    <div ref={stage} className="runtime-map-stage">
      <canvas ref={canvas} tabIndex={0} role="img" aria-label="授权地点、角色与物品的二维示意图；可拖动平移，滚轮缩放，下方提供可访问清单"
        style={{ cursor:edit ? "move" : "grab", visibility:ready ? "visible" : "hidden" }}
        onContextMenu={e => e.preventDefault()}
        onKeyDown={e => {
          const view = renderer.current; if (!view || !ready) return;
          const delta:Record<string,[number,number]> = { ArrowLeft:[35,0],ArrowRight:[-35,0],ArrowUp:[0,35],ArrowDown:[0,-35] };
          if(delta[e.key]){e.preventDefault();view.camera.x+=delta[e.key][0];view.camera.y+=delta[e.key][1];view.request();save();}
          if(e.key==='0'){e.preventDefault();fit();} if(e.key==='+'){e.preventDefault();scale(1.25);} if(e.key==='-'){e.preventDefault();scale(.8);}
        }}
        onPointerDown={e => {
          if(!ready || !renderer.current || (e.button!==0&&e.button!==1))return;
          const rect=e.currentTarget.getBoundingClientRect(),hit=renderer.current.hit(e.clientX-rect.left,e.clientY-rect.top);
          const place=edit&&hit?.kind==='place'?scene.places.find(p=>p.id===hit.id):undefined;
          drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,camera:{...renderer.current.camera},place,moved:false};
          e.currentTarget.setPointerCapture(e.pointerId); e.preventDefault();
        }}
        onPointerMove={e => {
          const d=drag.current,view=renderer.current;if(!d||!view||d.id!==e.pointerId)return;
          const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)>4)d.moved=true;if(!d.moved)return;
          if(d.place){
            const {id,x,y}=d.place;
            setLayout({version:1,camera:view.camera,places:sceneRef.current.places.map(p=>({id:p.id,x:p.id===id?x+dx/view.camera.zoom:p.x,y:p.id===id?y+dy/view.camera.zoom:p.y}))});
          }else{view.camera={...d.camera,x:d.camera.x+dx,y:d.camera.y+dy};view.request();}
        }}
        onPointerUp={e => {
          const d=drag.current,view=renderer.current;drag.current=null;if(!d||!view)return;
          if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
          if(d.moved){save();return;}
          const rect=e.currentTarget.getBoundingClientRect(),hit=view.hit(e.clientX-rect.left,e.clientY-rect.top);
          if(hit?.kind==='actor')onActor(hit.id);
          if(hit?.kind==='place')setTarget(hit.id);
          if(hit?.kind==='item'){const item=scene.sprites.find(s=>s.kind==='item'&&s.id===hit.id);setNotice(`${hit.id} · 持有者或地点：${item?.holder || '未知'}`);}
        }}
        onPointerCancel={() => {drag.current=null;}}
      />
      {!ready && <div className="runtime-map-overlay">正在恢复展示布局…</div>}
      {!connected && <div className="runtime-map-offline">连接中断 · 保留上次画面，行动已停用</div>}
      {failure && <div className="runtime-map-overlay" role="alert">{failure}</div>}
    </div>
    <div className="runtime-map-caption">
      <span>角色位置以已提交状态为准 · 金色方块为物品</span>
      <button type="button" aria-pressed={edit} disabled={!ready} onClick={() => setEdit(v=>!v)}>{edit?"完成布局调整":"调整展示布局"}</button>
      <button type="button" disabled={!ready} onClick={save}>保存布局</button>
      <button type="button" disabled={!ready} onClick={() => fit(true)}>重置布局</button>
    </div>
    {p.role==='participant' && <div className="runtime-map-action">
      <label>选择可见出口<select aria-label="2D 移动目标" value={target} disabled={busy||Boolean(pending.current)} onChange={e=>setTarget(e.target.value)}>
        <option value="">点击地点或选择出口</option>
        {(p.world.place_topology[p.agents[p.actor_id!]?.location] || []).map(id=><option key={id} value={id}>{id}</option>)}
      </select></label>
      <Button disabled={!connected||p.historical||busy||(!pending.current&&!moveAvailable(p,target,connected))} onClick={() => void move()}>{busy?"正在提交…":pending.current?"重试上次移动":`前往${target || '所选地点'}`}</Button>
      {p.control.status!=='running' && <small>请由创作者继续世界线后行动。</small>}
    </div>}
    <p className="runtime-map-notice" role="status">{notice || (edit ? "拖动地点卡片只调整展示位置，不改变地点连通、角色所在地或 Canon。" : "拖动平移，滚轮缩放；点击角色查看获准信息，点击地点选中。")}</p>
    <details className="runtime-map-list"><summary>可访问场景清单 · {scene.places.length} 个可见地点</summary>
      {scene.places.map(place=><div key={place.id} data-place={place.id} data-layout-x={place.x} data-layout-y={place.y}>
        <button type="button" onClick={()=>setTarget(place.id)} aria-label={`查看地点 ${place.id}`}>{place.id}{place.known?'':' · 内部未知'}</button>
        <span>{scene.sprites.filter(s=>s.kind==='item'&&s.place===place.id).map(s=>`${s.id}（${s.holder}）`).join('、')}</span>
        {scene.sprites.filter(s=>s.kind==='actor'&&s.place===place.id).map(s=><button key={s.id} type="button" data-map-actor={s.id} data-place={s.place} onClick={()=>onActor(s.id)}>{s.id} · {s.place}</button>)}
      </div>)}
    </details>
  </section>;
}
