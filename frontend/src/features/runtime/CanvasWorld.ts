import type { ViewerLayout } from "./api";
import type { Point, Scene2D, Sprite2D } from "./scene2d";

const hues = ["#6a8e81", "#658eaa", "#b58b63", "#8e80a2", "#7e9b69", "#b67a80"];
const tint = (id: string) => hues[Array.from(id).reduce((n, c) => n + c.codePointAt(0)!, 0) % hues.length];
const key = (s: Sprite2D) => `${s.kind}:${s.id}`;
interface Tween { from: Point; to: Point; start: number }

/** A disposable renderer. No network, Runtime, timers for simulation, or state writes. */
export class CanvasWorld {
  scene: Scene2D = { places: [], sprites: [], edges: [] };
  camera: ViewerLayout["camera"] = { x: 0, y: 0, zoom: 1 };
  selected = "";
  target = "";
  private context: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private raf = 0;
  private transitions = new Map<string, Tween>();
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private pulses = new Map<string, number>();
  private draws = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("当前设备无法初始化 2D 画布，文本模式仍可使用。");
    this.context = context;
  }
  resize(width: number, height: number) {
    this.width = width; this.height = height;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
    this.request();
  }
  update(scene: Scene2D, animate: boolean, changed: string[] = []) {
    const now = performance.now(), previous = new Map(this.scene.sprites.map(s => [key(s), this.position(s, now)]));
    this.transitions.clear();
    if (animate && !this.reduced.matches) for (const sprite of scene.sprites) {
      const old = previous.get(key(sprite));
      if (old && Math.hypot(old.x-sprite.x, old.y-sprite.y) > .1)
        this.transitions.set(key(sprite), { from: old, to: sprite, start: now });
    }
    this.scene = scene;
    this.pulses.clear();
    if (animate && !this.reduced.matches) changed.forEach(id => this.pulses.set(id, now));
    this.canvas.dataset.actorCount = String(scene.sprites.filter(s => s.kind === "actor").length);
    this.request();
  }
  position(sprite: Sprite2D, now: number): Point {
    const tween = this.transitions.get(key(sprite));
    if (!tween) return sprite;
    const progress = Math.min(1, Math.max(0, (now-tween.start)/550)), ease = progress*progress*(3-2*progress);
    return { x: tween.from.x+(tween.to.x-tween.from.x)*ease, y: tween.from.y+(tween.to.y-tween.from.y)*ease };
  }
  point(x: number, y: number): Point { return { x: (x-this.camera.x)/this.camera.zoom, y: (y-this.camera.y)/this.camera.zoom }; }
  hit(x: number, y: number) {
    const point = this.point(x,y), now = performance.now();
    for (const sprite of [...this.scene.sprites].reverse()) {
      const at = this.position(sprite,now);
      if (Math.hypot(at.x-point.x, at.y-8-point.y) < (sprite.kind === "actor" ? 22 : 11)) return { kind:sprite.kind, id:sprite.id };
    }
    const place = this.scene.places.find(p => Math.abs(point.x-p.x) <= p.width/2 && Math.abs(point.y-p.y) <= p.height/2);
    return place ? { kind:"place", id:place.id } : null;
  }
  request() { if (!this.raf) this.raf = requestAnimationFrame(now => { this.raf = 0; this.draw(now); }); }
  destroy() { cancelAnimationFrame(this.raf); this.raf = 0; this.transitions.clear(); this.pulses.clear(); }

  private label(text: string, x: number, y: number, color = "#3f574d", size = 12) {
    const c = this.context; c.font = `${size}px "Microsoft YaHei", sans-serif`; c.fillStyle=color;
    c.textAlign="center"; c.fillText(text.length > 16 ? text.slice(0,15)+"…" : text, x,y);
  }
  private draw(now: number) {
    const started = performance.now(), c = this.context, ratio = this.canvas.width / Math.max(1,this.width);
    c.setTransform(ratio,0,0,ratio,0,0); c.fillStyle="#f3f7f3"; c.fillRect(0,0,this.width,this.height);
    c.save(); c.translate(this.camera.x,this.camera.y); c.scale(this.camera.zoom,this.camera.zoom);
    // The grid is a layout aid; there is deliberately no coordinate/geographic scale.
    const a=this.point(0,0), b=this.point(this.width,this.height);
    c.fillStyle="#cfdbd133";
    const step=24*Math.max(1,Math.ceil(.6/this.camera.zoom));
    for(let x=Math.floor(a.x/step)*step;x<b.x;x+=step) for(let y=Math.floor(a.y/step)*step;y<b.y;y+=step){c.beginPath();c.arc(x,y,.8,0,Math.PI*2);c.fill();}
    const places=new Map(this.scene.places.map(p=>[p.id,p])), drawn=new Set<string>();
    for(const edge of this.scene.edges){
      const from=places.get(edge.from),to=places.get(edge.to);if(!from||!to||drawn.has(JSON.stringify([edge.from,edge.to])))continue;
      drawn.add(JSON.stringify([edge.to,edge.from]));
      const dx=to.x-from.x,dy=to.y-from.y,angle=Math.atan2(dy,dx),mid={x:(to.x+from.x)/2,y:(to.y+from.y)/2};
      c.strokeStyle="#a2b9aa";c.lineWidth=2;c.setLineDash([5,7]);c.beginPath();c.moveTo(from.x,from.y);c.lineTo(to.x,to.y);c.stroke();c.setLineDash([]);
      const arrow=(x:number,y:number,rotation:number)=>{c.save();c.translate(x,y);c.rotate(rotation);c.fillStyle="#7c9b8a";c.beginPath();c.moveTo(7,0);c.lineTo(-4,-4);c.lineTo(-4,4);c.closePath();c.fill();c.restore();};
      arrow(mid.x+Math.cos(angle)*10,mid.y+Math.sin(angle)*10,angle);
      if(this.scene.edges.some(e=>e.from===edge.to&&e.to===edge.from))arrow(mid.x-Math.cos(angle)*10,mid.y-Math.sin(angle)*10,angle+Math.PI);
    }
    for(const p of this.scene.places){
      c.shadowColor="#547f6214";c.shadowBlur=18;c.shadowOffsetY=5;
      c.fillStyle=p.known?"#fffefb":"#f4f8f6";c.strokeStyle=this.target===p.id?"#6c9d84":"#d7e3da";c.lineWidth=this.target===p.id?2.5:1.2;
      c.setLineDash(p.known?[]:[5,5]);c.beginPath();c.roundRect(p.x-p.width/2,p.y-p.height/2,p.width,p.height,19);c.fill();c.shadowBlur=0;c.shadowOffsetY=0;c.stroke();c.setLineDash([]);
      c.fillStyle="#e4efe5";c.beginPath();c.roundRect(p.x-p.width/2+17,p.y-p.height/2+17,28,28,9);c.fill();
      c.strokeStyle="#789780";c.lineWidth=1.5;c.beginPath();c.moveTo(p.x-p.width/2+23,p.y-p.height/2+31);c.lineTo(p.x-p.width/2+31,p.y-p.height/2+24);c.lineTo(p.x-p.width/2+39,p.y-p.height/2+31);c.lineTo(p.x-p.width/2+39,p.y-p.height/2+39);c.lineTo(p.x-p.width/2+23,p.y-p.height/2+39);c.closePath();c.stroke();
      c.textAlign="left";c.font='600 15px "Microsoft YaHei",sans-serif';c.fillStyle="#3e5c4a";c.fillText(p.id.slice(0,16),p.x-p.width/2+56,p.y-p.height/2+35);
      const count=this.scene.sprites.filter(s=>s.kind==='actor'&&s.place===p.id).length;
      this.label(p.known?`${count} 位角色`:'可见出口 · 内部未知',p.x,p.y+p.height/2-12,"#8a9a8c",10);
    }
    for(const sprite of this.scene.sprites){
      const at=this.position(sprite,now);c.save();c.translate(at.x,at.y);
      if(sprite.kind==='actor'){
        const selected=sprite.id===this.selected;
        if(selected){c.fillStyle="#dfece1";c.beginPath();c.ellipse(0,9,22,11,0,0,Math.PI*2);c.fill();c.strokeStyle="#91b29b";c.stroke();}
        c.fillStyle="#68897420";c.beginPath();c.ellipse(0,10,11,4,0,0,Math.PI*2);c.fill();
        const walking=this.transitions.has(key(sprite))&&now-this.transitions.get(key(sprite))!.start<550;
        const stride=walking?Math.sin(now/65)*3:0;
        c.strokeStyle="#5f7368";c.lineWidth=4;c.lineCap='round';c.beginPath();c.moveTo(-4,3);c.lineTo(-5+stride,10);c.moveTo(4,3);c.lineTo(5-stride,10);c.stroke();
        c.fillStyle=tint(sprite.id);c.beginPath();c.roundRect(-10,-15,20,21,7);c.fill();
        c.fillStyle="#f2d9bc";c.beginPath();c.arc(0,-21,8,0,Math.PI*2);c.fill();
        c.fillStyle="#53675c";c.beginPath();c.ellipse(0,-24,8,5,0,Math.PI,Math.PI*2);c.fill();
        this.label(sprite.id,0,29,selected?"#294b38":"#6d8072",10);
        const pulse=this.pulses.get(sprite.id);
        if(pulse!==undefined&&now-pulse<900){c.strokeStyle=`rgba(102,158,132,${1-(now-pulse)/900})`;c.lineWidth=2;c.beginPath();c.arc(0,-10,19+(now-pulse)/45,0,Math.PI*2);c.stroke();}
      }else{
        c.fillStyle="#d4aa68";c.strokeStyle="#b48e53";c.lineWidth=1;c.beginPath();c.moveTo(0,-8);c.lineTo(7,-3);c.lineTo(7,5);c.lineTo(0,9);c.lineTo(-7,5);c.lineTo(-7,-3);c.closePath();c.fill();c.stroke();
        if(sprite.holder===sprite.place)this.label(sprite.id,0,22,"#947d57",9);
      }
      c.restore();
    }
    c.restore();
    this.canvas.dataset.drawCount=String(++this.draws);this.canvas.dataset.drawMs=(performance.now()-started).toFixed(2);
    const moving=[...this.transitions.values()].some(t=>now-t.start<550), glowing=[...this.pulses.values()].some(t=>now-t<900);
    if(moving||glowing)this.request();
  }
}
