import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Minus, Plus, Maximize2, Save } from "lucide-react";
import { displayName, type Envelope } from "./api";

const ASSETS = "/assets/academy/v1/";
type SpriteFrame = { texture: THREE.Texture; aspect: number };
function frames(
  texture: THREE.Texture,
  columns: number,
  rows: number,
): SpriteFrame[] {
  const image = texture.image as HTMLImageElement,
    canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return Array.from({ length: columns * rows }, (_, i) => {
    const x0 = Math.round(((i % columns) * image.width) / columns),
      x1 = Math.round((((i % columns) + 1) * image.width) / columns);
    const y0 = Math.round((Math.floor(i / columns) * image.height) / rows),
      y1 = Math.round(((Math.floor(i / columns) + 1) * image.height) / rows);
    let left = x1,
      right = x0,
      top = y1,
      bottom = y0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++)
        if (rgba[(y * image.width + x) * 4 + 3] > 32) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
    // Normalize each real alpha silhouette; generation does not guarantee cell baselines.
    if (left > right) {
      left = x0;
      right = x1 - 1;
      top = y0;
      bottom = y1 - 1;
    }
    const t = texture.clone();
    t.offset.set(left / image.width, 1 - (bottom + 1) / image.height);
    t.repeat.set(
      (right - left + 1) / image.width,
      (bottom - top + 1) / image.height,
    );
    t.needsUpdate = true;
    return { texture: t, aspect: (right - left + 1) / (bottom - top + 1) };
  });
}

class AcademyScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  disposed = false;
  raf = 0;
  observer: ResizeObserver;
  resources: { dispose: () => void }[] = [];
  actors = new Map<
    string,
    {
      sprite: THREE.Sprite;
      ring: THREE.Mesh;
      from: THREE.Vector3;
      target: THREE.Vector3;
      start: number;
      avatar: number;
    }
  >();
  characters: SpriteFrame[] = [];
  decor: SpriteFrame[] = [];
  exteriors: SpriteFrame[] = [];
  materials: THREE.MeshStandardMaterial[] = [];
  labels: HTMLElement[] = [];
  frame?: Envelope;
  selected = "";
  follow = false;
  started = performance.now();
  draws = 0;
  lastMove = "";
  lastSpeech = "";
  items = new Map<string, THREE.Mesh>();
  readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  constructor(
    public host: HTMLElement,
    public layer: HTMLElement,
    public place: string,
    public select: (id: string) => void,
    public move: (id: string) => void,
    public fail: (text: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0xe9f1e5);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.domElement.setAttribute("aria-label", "学院 2.5D 场景");
    this.renderer.domElement.dataset.place = place;
    this.renderer.domElement.dataset.renderer = "three";
    host.prepend(this.renderer.domElement);
    this.camera = new THREE.OrthographicCamera(-14, 14, 14, -14, 0.1, 150);
    this.camera.position.set(18, 24, 28);
    this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.8, 0);
    this.controls.enableRotate = false;
    this.controls.screenSpacePanning = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minZoom = 0.55;
    this.controls.maxZoom = 2.8;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.scene.add(new THREE.HemisphereLight(0xfff8e4, 0xa3baa5, 1.8));
    const sun = new THREE.DirectionalLight(0xffe4b7, 1.8);
    sun.position.set(-12, 25, 15);
    this.scene.add(sun);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    let down = { x: 0, y: 0 };
    const element = this.renderer.domElement;
    element.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    element.addEventListener("pointerup", (e) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const b = element.getBoundingClientRect(),
        ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - b.left) / b.width) * 2 - 1,
          (-(e.clientY - b.top) / b.height) * 2 + 1,
        ),
        this.camera,
      );
      const hit = ray.intersectObjects(
        [...this.actors.values()].map((a) => a.sprite),
      )[0];
      if (hit) this.select(hit.object.userData.actor);
    });
    element.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.fail(
        "显卡上下文已中断，请重新打开场景。文本记录与已保存世界仍可读取。",
      );
    });
    this.load().catch(() => {
      if (!this.disposed) this.fail("场景资源加载失败，请切换文本或重试场景。");
    });
    this.render();
  }
  resize() {
    const w = this.host.clientWidth,
      h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    const span = Math.max(12.5, (11 * w) / h);
    this.camera.left = -span;
    this.camera.right = span;
    this.camera.top = (span * h) / w;
    this.camera.bottom = (-span * h) / w;
    this.camera.updateProjectionMatrix();
  }
  restoreCamera(value: { x: number; y: number; zoom: number }) {
    const target = new THREE.Vector3(value.x, 1.8, value.y),
      delta = target.clone().sub(this.controls.target);
    this.camera.position.add(delta);
    this.controls.target.copy(target);
    this.camera.zoom = Math.max(0.55, Math.min(2.8, value.zoom));
    this.camera.updateProjectionMatrix();
  }
  keep<T extends { dispose: () => void }>(r: T): T {
    this.resources.push(r);
    return r;
  }
  async load() {
    const loader = new THREE.TextureLoader();
    const textures = await Promise.all(
      ["materials.png", "characters.png", "decor.png", "exteriors.png"].map(
        (f) => loader.loadAsync(ASSETS + f),
      ),
    );
    if (this.disposed) {
      textures.forEach((t) => t.dispose());
      return;
    }
    textures.forEach((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.LinearFilter;
      this.keep(t);
    });
    this.characters = frames(textures[1], 6, 4);
    this.decor = frames(textures[2], 4, 2);
    [...this.characters, ...this.decor].forEach((f) => this.keep(f.texture));
    // The generated facade atlas has unequal regions, not a regular two-cell grid.
    for (const [left, right, top, bottom] of [
      [59, 1012, 99, 819],
      [1075, 1703, 197, 854],
    ]) {
      const t = this.keep(textures[3].clone());
      t.offset.set(left / 1774, 1 - bottom / 887);
      t.repeat.set((right - left) / 1774, (bottom - top) / 887);
      t.needsUpdate = true;
      this.exteriors.push({
        texture: t,
        aspect: (right - left) / (bottom - top),
      });
    }
    for (let i = 0; i < 16; i++) {
      const source = textures[0].image as HTMLImageElement,
        canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      canvas
        .getContext("2d")!
        .drawImage(
          source,
          ((i % 4) * source.width) / 4 + 1,
          (Math.floor(i / 4) * source.height) / 4 + 1,
          source.width / 4 - 2,
          source.height / 4 - 2,
          0,
          0,
          256,
          256,
        );
      const t = this.keep(new THREE.CanvasTexture(canvas));
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.NearestFilter;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      this.materials.push(
        this.keep(new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })),
      );
    }
    this.build();
    if (this.frame) this.update(this.frame, this.selected, this.follow);
  }
  box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: number,
  ) {
    const g = this.keep(new THREE.BoxGeometry(w, h, d)),
      uv = g.attributes.uv;
    for (let face = 0; face < 6; face++)
      for (let v = 0; v < 4; v++) {
        const i = face * 4 + v;
        uv.setXY(
          i,
          (uv.getX(i) * (face < 2 ? d : w)) / 2,
          (uv.getY(i) * (face === 2 || face === 3 ? d : h)) / 2,
        );
      }
    const mesh = new THREE.Mesh(g, this.materials[material]);
    mesh.position.set(x, y + h / 2, z);
    this.scene.add(mesh);
    return mesh;
  }
  panel(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    material: number,
  ) {
    const mesh = new THREE.Mesh(
      this.keep(new THREE.PlaneGeometry(w, h)),
      this.materials[material],
    );
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
  }
  prop(index: number, x: number, z: number, height: number) {
    const f = this.decor[index],
      s = new THREE.Sprite(
        this.keep(
          new THREE.SpriteMaterial({
            map: f.texture,
            alphaTest: 0.15,
            depthWrite: true,
          }),
        ),
      );
    s.center.set(0.5, 0);
    s.scale.set(height * f.aspect, height, 1);
    s.position.set(x, 0.08, z);
    this.scene.add(s);
  }
  label(text: string, x: number, y: number, z: number, click?: () => void) {
    const el = document.createElement(click ? "button" : "span");
    el.className = "academy-world-label";
    el.textContent = text;
    if (click) {
      (el as HTMLButtonElement).type = "button";
      el.addEventListener("click", click);
    }
    this.layer.append(el);
    el.dataset.point = [x, y, z].join(",");
    this.labels.push(el);
    return el;
  }
  build() {
    const exterior = ["courtyard", "street"].includes(this.place);
    const tileMaterial =
      this.place === "classroom" ? 5 : this.place === "library" ? 12 : 0;
    const tile = new THREE.PlaneGeometry(1.5, 1.5);
    tile.rotateX(-Math.PI / 2);
    this.keep(tile);
    const columns = exterior ? 64 : 16,
      rows = exterior ? 48 : 12;
    const floor = new THREE.InstancedMesh(
      tile,
      this.materials[tileMaterial],
      columns * rows,
    );
    this.keep(floor);
    const matrix = new THREE.Matrix4();
    for (let x = 0; x < columns; x++)
      for (let z = 0; z < rows; z++) {
        matrix.makeTranslation(
          (x - (columns - 1) / 2) * 1.5,
          0,
          (z - (rows - 1) / 2) * 1.5,
        );
        floor.setMatrixAt(x * rows + z, matrix);
      }
    this.scene.add(floor);
    if (exterior) {
      const facade = this.exteriors[this.place === "courtyard" ? 0 : 1],
        height = this.place === "courtyard" ? 10.5 : 8;
      const building = new THREE.Sprite(
        this.keep(
          new THREE.SpriteMaterial({
            map: facade.texture,
            alphaTest: 0.15,
            depthWrite: true,
          }),
        ),
      );
      building.center.set(0.5, 0);
      building.scale.set(height * facade.aspect, height, 1);
      building.position.set(0, 0.05, -6);
      this.scene.add(building);
      if (this.place === "courtyard") {
        for (const x of [-8, 8]) {
          this.box(x, 0.01, 1, 3.1, 0.35, 6, 15);
          this.box(x, 0.36, 1, 2.7, 0.05, 5.6, 1);
          this.prop(0, x, 0, 6.4);
          this.prop(1, x, 3.1, 1.3);
        }
        this.prop(4, -3, -2.1, 1.5);
        this.prop(4, 5, 4.8, 1.5);
        this.prop(5, 8, 5.5, 2.1);
        this.prop(6, -8, 6.2, 1.7);
        this.prop(3, -5, 5.4, 3.3);
        this.exit("library", 5, 1.4, -4.5);
        this.exit("classroom", -6, 1.4, -4.5);
        this.exit("street", 8, 0.7, 6.8);
      } else {
        this.box(0, 0.02, 2, 24, 0.03, 5, 11);
        for (let x = -10; x < 12; x += 4)
          this.box(x, 0.06, 2, 2.2, 0.02, 0.12, 12);
        this.prop(0, -9, -1.5, 5.7);
        this.prop(4, 8, -2.9, 1.5);
        this.prop(6, -5, -3.3, 1.5);
        this.prop(3, 5, -3.5, 3.3);
        this.label("咖啡店／店铺 · 外部门面", 0, 1.4, -4.3);
        this.exit("courtyard", -9, 0.8, 5.8);
      }
    } else {
      this.box(0, 0, -8, 24, 5, 0.4, 3);
      this.box(-11.8, 0, -0.2, 0.35, 4.5, 16, 3);
      this.box(0, 0, -7.7, 24, 0.5, 0.12, 10);
      for (const z of [-5, 0, 5]) {
        const window = new THREE.Mesh(
          this.keep(new THREE.PlaneGeometry(2.1, 2.7)),
          this.materials[8],
        );
        window.rotation.y = Math.PI / 2;
        window.position.set(-11.6, 2.8, z);
        this.scene.add(window);
      }
      if (this.place === "classroom") {
        this.panel(0, 3.1, -7.73, 9, 2.1, 7);
        this.box(0, 0, -5.4, 6, 0.25, 2.8, 10);
        this.box(0, 0.25, -5.1, 2.8, 1.2, 1.4, 10);
        for (const x of [-6, -1.5, 3])
          for (const z of [-1, 2.5]) {
            this.box(x, 0.95, z, 2.9, 0.17, 1.5, 10);
            for (const dx of [-1.1, 1.1])
              for (const dz of [-0.5, 0.5])
                this.box(x + dx, 0, z + dz, 0.12, 0.95, 0.12, 14);
            this.box(x, 0.55, z + 1.3, 1.5, 0.15, 0.8, 10);
            this.box(x, 0.7, z + 1.7, 1.5, 0.7, 0.12, 10);
            for (const dx of [-0.55, 0.55])
              for (const dz of [1, 1.6])
                this.box(x + dx, 0, z + dz, 0.1, 0.55, 0.1, 14);
          }
        this.prop(7, 9, -6, 2.3);
        this.label("讲台", 0, 2.2, -5);
        this.exit("courtyard", 8, 1, 6.6);
      } else {
        for (const x of [-8, -3, 2, 7]) {
          this.box(x, 0, -7.2, 3.8, 3.9, 0.9, 10);
          this.panel(x, 2, -6.73, 3.5, 3.55, 6);
        }
        for (const x of [-6, 2])
          for (const z of [-1.5, 3]) {
            this.box(x, 1, z, 4.3, 0.2, 2.1, 10);
            for (const dx of [-1.7, 1.7])
              for (const dz of [-0.7, 0.7])
                this.box(x + dx, 0, z + dz, 0.15, 1, 0.15, 10);
            for (const dz of [-1.5, 1.5]) {
              this.box(x, 0.55, z + dz, 2.2, 0.15, 0.7, 10);
              this.box(
                x,
                0.7,
                z + dz + (dz < 0 ? -0.35 : 0.35),
                2.2,
                0.65,
                0.12,
                10,
              );
            }
          }
        this.box(8, 0, -2, 4, 1.1, 1.4, 10);
        this.prop(7, 9, -6, 2.5);
        this.label("服务台", 8, 1.7, -2);
        this.exit("courtyard", 8, 1, 6.6);
      }
    }
  }
  exit(id: string, x: number, y: number, z: number) {
    const el = this.label("", x, y, z, () => this.move(id));
    el.dataset.exit = id;
  }
  update(frame: Envelope, selected: string, follow: boolean) {
    this.frame = frame;
    this.selected = selected;
    this.follow = follow;
    if (!this.characters.length) return;
    const p = frame.projection,
      here = Object.entries(p.agents).filter(
        ([, a]) => a.location === this.place,
      ),
      ids = new Set(here.map(([id]) => id));
    for (const [id, a] of this.actors)
      if (!ids.has(id)) {
        this.scene.remove(a.sprite, a.ring);
        a.sprite.material.dispose();
        a.ring.geometry.dispose();
        (a.ring.material as THREE.Material).dispose();
        this.actors.delete(id);
        this.layer
          .querySelectorAll(`[data-actor="${CSS.escape(id)}"]`)
          .forEach((el) => el.remove());
      }
    const moveEvent = frame.events
      .filter((e) => e.accepted && e.action_type === "move")
      .at(-1)?.event_id;
    for (const [id] of here) {
      const slot = Number(id.replace(/\D/g, "")) || [...ids].indexOf(id) + 1;
      const position =
        this.place === "courtyard"
          ? new THREE.Vector3(
              -2.9 + ((slot - 1) % 3) * 2.6,
              0.08,
              1 + Math.floor((slot - 1) / 3) * 2.2,
            )
          : this.place === "street"
            ? new THREE.Vector3(-5 + (slot - 1) * 1.8, 0.08, -2.2)
            : new THREE.Vector3(
                7.3 + (slot % 2) * 1.7,
                0.08,
                3.5 - Math.floor((slot - 1) / 2) * 2.8,
              );
      let a = this.actors.get(id);
      if (!a) {
        const avatar = p.scene?.actors[id]?.avatar || 0,
          f = this.characters[avatar],
          sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: f.texture,
              alphaTest: 0.2,
              depthWrite: true,
            }),
          );
        sprite.center.set(0.5, 0);
        sprite.scale.set(2.25 * f.aspect, 2.25, 1);
        sprite.userData.actor = id;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.42, 0.5, 32),
          new THREE.MeshBasicMaterial({
            color: 0x2799f5,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(position.x, 0.04, position.z);
        const arriving =
          !p.historical &&
          p.control.status === "running" &&
          moveEvent &&
          moveEvent !== this.lastMove &&
          frame.events.some(
            (e) => e.event_id === moveEvent && e.actor_id === id,
          );
        a = {
          sprite,
          ring,
          from: arriving ? new THREE.Vector3(8, 0.08, 6) : position.clone(),
          target: position,
          start: performance.now(),
          avatar,
        };
        this.scene.add(sprite, ring);
        this.actors.set(id, a);
        const label = this.label(
          displayName(p, id),
          position.x,
          2.65,
          position.z,
          () => this.select(id),
        );
        label.dataset.actor = id;
      }
      a.ring.visible = id === selected;
    }
    if (moveEvent) this.lastMove = moveEvent;
    for (const [id, mesh] of this.items) {
      if (p.world.items[id] !== this.place) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.items.delete(id);
        this.layer.querySelector(`[data-item="${CSS.escape(id)}"]`)?.remove();
      }
    }
    Object.entries(p.world.items)
      .filter(([, holder]) => holder === this.place)
      .forEach(([id], i) => {
        if (this.items.has(id)) return;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.65, 0.08, 0.45),
          new THREE.MeshStandardMaterial({
            color:
              id === "book" ? 0x406a8a : id === "pass" ? 0x63a38a : 0xfff1cf,
          }),
        );
        mesh.position.set(2 + i * 1.6, 0.08, 5);
        this.scene.add(mesh);
        this.items.set(id, mesh);
        const label = this.label(displayName(p, id), mesh.position.x, 0.8, 5);
        label.dataset.item = id;
      });
    const speech = frame.events.at(-1);
    if (
      !p.historical &&
      speech?.accepted &&
      speech.action_type === "speak" &&
      speech.text &&
      speech.actor_id &&
      this.actors.has(speech.actor_id) &&
      (!speech.location_id || speech.location_id === this.place) &&
      speech.event_id !== this.lastSpeech
    ) {
      this.lastSpeech = speech.event_id;
      const label = this.label(speech.text!.slice(0, 100), 0, 0, 0);
      label.dataset.actor = speech.actor_id;
      label.dataset.speech = "true";
      label.dataset.expires = String(performance.now() + 8000);
      label.classList.add("academy-speech");
    }
    this.labels = this.labels.filter((el) => el.isConnected);
    for (const el of this.labels) {
      if (el.dataset.actor && !el.dataset.speech)
        el.textContent = displayName(p, el.dataset.actor);
      if (el.dataset.exit) {
        el.textContent = displayName(p, el.dataset.exit) + " →";
        el.dataset.allowed = String(
          (p.world.place_topology[this.place] || []).includes(el.dataset.exit),
        );
      }
    }
  }
  render = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.render);
    const now = performance.now();
    const reduced = this.reducedMotion.matches;
    this.controls.update();
    for (const [id, a] of this.actors) {
      const t = reduced ? 1 : Math.min(1, (now - a.start) / 750);
      a.sprite.position.lerpVectors(a.from, a.target, t);
      a.ring.position.set(a.sprite.position.x, 0.04, a.sprite.position.z);
      const walking = t < 1,
        aFrame =
          this.characters[
            a.avatar + (walking ? 1 + (Math.floor(now / 160) % 3) : 0) * 6
          ];
      if (aFrame) {
        a.sprite.material.map = aFrame.texture;
        a.sprite.scale.set(2.25 * aFrame.aspect, 2.25, 1);
      }
      if (this.follow && id === this.selected) {
        const before = this.controls.target.clone();
        this.controls.target.lerp(
          new THREE.Vector3(a.sprite.position.x, 1.8, a.sprite.position.z),
          reduced ? 1 : 0.06,
        );
        this.camera.position.add(this.controls.target.clone().sub(before));
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.draws++;
    this.renderer.domElement.dataset.frames = String(this.draws);
    this.renderer.domElement.dataset.zoom = String(this.camera.zoom);
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    for (const el of this.labels) {
      if (el.dataset.expires && now > Number(el.dataset.expires)) {
        el.remove();
        continue;
      }
      const a = el.dataset.actor
        ? this.actors.get(el.dataset.actor)
        : undefined;
      const point = a
        ? a.sprite.position
            .clone()
            .add(new THREE.Vector3(0, el.dataset.speech ? 3.7 : 2.6, 0))
        : new THREE.Vector3(
            ...(el.dataset.point!.split(",").map(Number) as [
              number,
              number,
              number,
            ]),
          );
      point.project(this.camera);
      el.style.transform = `translate(${((point.x + 1) * width) / 2}px,${((-point.y + 1) * height) / 2}px) translate(-50%,-100%)`;
      el.hidden =
        (Boolean(el.dataset.actor) && !a) ||
        el.dataset.allowed === "false" ||
        Math.abs(point.x) > 1.15 ||
        Math.abs(point.y) > 1.15;
    }
  };
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    for (const a of this.actors.values()) {
      a.sprite.material.dispose();
      a.ring.geometry.dispose();
      (a.ring.material as THREE.Material).dispose();
    }
    for (const mesh of this.items.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.resources.forEach((r) => r.dispose());
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.layer.replaceChildren();
  }
}

export function AcademyViewport({
  frame,
  place,
  actor,
  follow,
  onActor,
  onExit,
}: {
  frame: Envelope;
  place: string;
  actor: string;
  follow: boolean;
  onActor: (id: string) => void;
  onExit: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    layer = useRef<HTMLDivElement>(null),
    world = useRef<AcademyScene | undefined>(undefined),
    callbacks = useRef({ onActor, onExit });
  callbacks.current = { onActor, onExit };
  const [error, setError] = useState(""),
    [cycle, setCycle] = useState(0),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    setNotice("");
    setError("");
    try {
      world.current = new AcademyScene(
        host.current!,
        layer.current!,
        place,
        (id) => callbacks.current.onActor(id),
        (id) => callbacks.current.onExit(id),
        setError,
      );
      world.current.update(frame, actor, follow);
      const view = world.current;
      window.aetherloomRuntime
        ?.viewerLayout(frame.projection.worldline_id)
        .then((value) => {
          if (alive && world.current === view && value && !value.places.length)
            view.restoreCamera(value.camera);
        })
        .catch(() => {
          if (alive) setNotice("镜头偏好未能读取，使用默认视角。");
        });
    } catch {
      setError("此设备无法初始化 WebGL 场景；可继续使用文本模式。");
    }
    return () => {
      alive = false;
      world.current?.destroy();
      world.current = undefined;
    };
  }, [
    place,
    frame.projection.viewer_scope,
    frame.projection.worldline_id,
    cycle,
  ]);
  useEffect(
    () => world.current?.update(frame, actor, follow),
    [frame, actor, follow],
  );
  return (
    <div className="academy-viewport" ref={host}>
      <div className="academy-label-layer" ref={layer} />
      <div className="academy-camera">
        <button
          aria-label="保存场景镜头"
          onClick={() => {
            const v = world.current;
            if (!v) return;
            window.aetherloomRuntime
              ?.viewerLayout(frame.projection.worldline_id, {
                version: 1,
                camera: {
                  x: v.controls.target.x,
                  y: v.controls.target.z,
                  zoom: v.camera.zoom,
                },
                places: [],
              })
              .then(() => setNotice("镜头已保存，世界状态未改变。"))
              .catch(() => setNotice("镜头暂未保存，可重试。"));
          }}
        >
          <Save size={17} />
        </button>
        <button
          aria-label="缩小场景"
          onClick={() => {
            if (world.current) {
              world.current.camera.zoom = Math.max(
                0.55,
                world.current.camera.zoom * 0.85,
              );
              world.current.camera.updateProjectionMatrix();
            }
          }}
        >
          <Minus size={17} />
        </button>
        <button
          aria-label="适应场景"
          onClick={() => {
            if (world.current) {
              world.current.restoreCamera({ x: 0, y: 0, zoom: 1 });
            }
          }}
        >
          <Maximize2 size={17} />
        </button>
        <button
          aria-label="放大场景"
          onClick={() => {
            if (world.current) {
              world.current.camera.zoom = Math.min(
                2.8,
                world.current.camera.zoom * 1.15,
              );
              world.current.camera.updateProjectionMatrix();
            }
          }}
        >
          <Plus size={17} />
        </button>
      </div>
      {error && (
        <div className="academy-render-error" role="alert">
          {error}
          <button onClick={() => setCycle((c) => c + 1)}>重试场景</button>
        </div>
      )}
      <small className="academy-layout-note">
        {notice || "场景布局为视觉编排 · 拖动平移，滚轮缩放"}
      </small>
    </div>
  );
}
