import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNotice } from "../../components/ui";
import { runtimeRequest, type HostSession } from "./api";
import "./academy.css";
import { SocialPreparation, type SocialSetup } from './SocialPreparation';
import { creationApi, type ContentNode, type LibraryItem } from "../creation/api";

interface Binding {
  entity_id: string | null;
  entity_version: number | null;
}
interface Place extends Binding {
  id: string;
  name: string;
  description: string;
  neighbors: string[];
}
interface Person extends Binding {
  id: string;
  enabled: boolean;
  name: string;
  avatar: number;
  persona: string;
  goal: string;
  location: string;
  knowledge: string[];
  beliefs: string[];
}
interface Item {
  id: string;
  name: string;
  description: string;
  holder: string;
  text?: string;
}
interface Catalog {
  ready: boolean;
  social_ready?: boolean;
  series: {
    id: string;
    name: string;
    description: string;
    version: number;
    asset_version: string;
    roles: Person[];
    places: Place[];
    items: Item[];
  }[];
  inputs: {
    revision: number;
    entities: { id: string; name: string; kind: string; version: number }[];
  };
}

type MaterialPurpose = "author_reference" | "agent_knowledge";

interface MaterialSelection {
  node: ContentNode;
  node_id: string;
  version: number;
  start: number;
  end: number;
  purpose: MaterialPurpose;
  known_by: string[];
  title: string;
  work_title: string;
}

interface MaterialDraft {
  node?: ContentNode;
  start: number;
  end: number;
  quote: string;
  occurrence: number;
  purpose: MaterialPurpose;
  knownBy: string[];
}

const codePointLength = (text: string) => Array.from(text).length;
const materialKey = (value: MaterialSelection) =>
  `${value.node_id}:${value.version}:${value.start}:${value.end}:${value.purpose}:${value.known_by.join(",")}`;
const fullMaterial = (node: ContentNode, workTitle: string): MaterialSelection => ({
  node,
  node_id: node.id,
  version: node.version,
  start: 0,
  end: codePointLength(node.plain_text || ""),
  purpose: "author_reference",
  known_by: [],
  title: node.title,
  work_title: workTitle,
});
export function ScenarioSetup({
  world,
  sourceNodeId,
  onCreated,
  onBack,
}: {
  world: string;
  sourceNodeId?: string;
  onCreated: (line: string) => void;
  onBack: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>(),
    [session, setSession] = useState<HostSession>(),
    [selectedSource, setSelectedSource] = useState<ContentNode>(),
    [materialLibrary, setMaterialLibrary] = useState<LibraryItem[]>([]),
    [materials, setMaterials] = useState<MaterialSelection[]>([]),
    [materialDraft, setMaterialDraft] = useState<MaterialDraft>({
      start: 0,
      end: 0,
      quote: "",
      occurrence: 0,
      purpose: "author_reference",
      knownBy: [],
    }),
    [editingMaterialKey, setEditingMaterialKey] = useState<string>(),
    [materialEditorOpen, setMaterialEditorOpen] = useState(false),
    [materialError, setMaterialError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [roles, setRoles] = useState<Person[]>([]),
    [places, setPlaces] = useState<Place[]>([]),
    [items, setItems] = useState<Item[]>([]);
  const [social, setSocial] = useState<SocialSetup>();
  const [title, setTitle] = useState("学院日常"),
    [purpose, setPurpose] = useState("template_parallel"),
    [background, setBackground] = useState(""),
    [publicInfo, setPublicInfo] = useState("");
  const [adaptations, setAdaptations] = useState(
    "角色由我选择或绑定；地点、布景与基础通行采用学院系列，本次演化不代表原作正式历史。",
  );
  const [confirmed, setConfirmed] = useState(false),
    [gate, setGate] = useState(false),
    [hardRules, setHardRules] = useState("");
  const request = useRef<{ id: string; payload: unknown } | undefined>(
    undefined,
  );
  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    (async () => {
      try {
        const s = await window.aetherloomRuntime?.session(
          world,
          "creator_observer",
        );
        if (!s) throw Error("需要已启用系列功能的桌面宿主");
        const [data, source, library] = await Promise.all([
          runtimeRequest<Catalog>(s, "/series", abort.signal),
          sourceNodeId ? creationApi.node(sourceNodeId) : Promise.resolve(undefined),
          creationApi.contentLibrary(world, new URLSearchParams({ limit: "100" })),
        ]);
        if (!active) return;
        setSession(s);
        setCatalog(data);
        setMaterialLibrary(library.items);
        setSelectedSource(source);
        if (source) {
          const initial = fullMaterial(
            source,
            library.items.find((item) => item.id === source.id)?.work_title || "当前资料",
          );
          setMaterials([initial]);
          setMaterialDraft({
            node: source,
            start: initial.start,
            end: initial.end,
            quote: "",
            occurrence: 0,
            purpose: initial.purpose,
            knownBy: [],
          });
          setEditingMaterialKey(undefined);
          setMaterialEditorOpen(false);
        }
        setRoles(
          data.series[0].roles.map((p) => ({
            ...p,
            entity_id: null,
            entity_version: null,
            knowledge: [],
            beliefs: [],
          })),
        );
        setPlaces(
          data.series[0].places.map((p) => ({
            ...p,
            entity_id: null,
            entity_version: null,
          })),
        );
        setItems(data.series[0].items);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    })();
    return () => {
      active = false;
      abort.abort();
    };
  }, [world, sourceNodeId]);
  const people = roles.filter((p) => p.enabled);
  const startName = (id: string) => [...places, ...people].find((entry) => entry.id === id)?.name ?? id;
  function sourceLabel(binding: Binding) {
    const entity = catalog?.inputs.entities.find((entry) => entry.id === binding.entity_id);
    return entity ? `${entity.name} · v${binding.entity_version}` : "模板或手工填写";
  }
  const invalidHolder = items.some(
    (item) => ![...places, ...people].some((value) => value.id === item.holder),
  );
  const needsReadingSetup = items.some(item=>item.text?.trim()) && social?.contract_version !== 'social-domain-v2';
  const draftText = materialDraft.node?.plain_text || "";
  const draftMatches = materialMatches(draftText, materialDraft.quote);
  const draftRange = materialRange();
  function bind(person: Person | Place, id: string) {
    const e = catalog?.inputs.entities.find((e) => e.id === id);
    return {
      ...person,
      entity_id: e?.id || null,
      entity_version: e?.version || null,
      ...(e ? { name: e.name } : {}),
    };
  }
  function materialMatches(text: string, quote: string) {
    if (!quote) return [];
    const matches: number[] = [];
    let position = text.indexOf(quote);
    while (position >= 0) {
      matches.push(position);
      position = text.indexOf(quote, position + 1);
    }
    return matches;
  }
  function materialRange() {
    const text = materialDraft.node?.plain_text || "";
    if (!materialDraft.node || !text) return undefined;
    if (!materialDraft.quote) {
      return { start: materialDraft.start, end: materialDraft.end };
    }
    const matches = materialMatches(text, materialDraft.quote);
    const position = matches[materialDraft.occurrence];
    if (position === undefined) return undefined;
    return {
      start: codePointLength(text.slice(0, position)),
      end: codePointLength(text.slice(0, position + materialDraft.quote.length)),
    };
  }
  async function chooseMaterial(nodeId: string) {
    setMaterialError("");
    if (!nodeId) {
      setMaterialDraft({
        start: 0,
        end: 0,
        quote: "",
        occurrence: 0,
        purpose: "author_reference",
        knownBy: [],
      });
      setEditingMaterialKey(undefined);
      setMaterialEditorOpen(false);
      return;
    }
    try {
      const node = await creationApi.node(nodeId);
      const existing = materials.find((value) => value.node_id === node.id);
      if (existing) {
        editMaterial(existing);
        return;
      }
      setMaterialDraft({
        node,
        start: 0,
        end: codePointLength(node.plain_text || ""),
        quote: "",
        occurrence: 0,
        purpose: "author_reference",
        knownBy: [],
      });
      setEditingMaterialKey(undefined);
      setMaterialEditorOpen(true);
    } catch (e) {
      setMaterialError((e as Error).message);
    }
  }
  function editMaterial(value: MaterialSelection) {
    setMaterialDraft({
      node: value.node,
      start: value.start,
      end: value.end,
      quote: "",
      occurrence: 0,
      purpose: value.purpose,
      knownBy: value.known_by,
    });
    setEditingMaterialKey(materialKey(value));
    setMaterialEditorOpen(true);
    setMaterialError("");
  }
  function addMaterial() {
    setMaterialError("");
    const node = materialDraft.node;
    const text = node?.plain_text || "";
    if (!node || !text) {
      setMaterialError("请选择有可读正文的资料。目录节点不能直接作为正文来源。");
      return;
    }
    const range = materialRange();
    if (!range || range.start < 0 || range.start >= range.end || range.end > codePointLength(text)) {
      setMaterialError("请填写有效的正文范围，末端位置不包含在范围内。");
      return;
    }
    if (materialDraft.purpose === "agent_knowledge" && !materialDraft.knownBy.length) {
      setMaterialError("角色已知资料必须至少选择一位接收角色。");
      return;
    }
    const selection: MaterialSelection = {
      node,
      node_id: node.id,
      version: node.version,
      start: range.start,
      end: range.end,
      purpose: materialDraft.purpose,
      known_by: materialDraft.purpose === "agent_knowledge" ? materialDraft.knownBy : [],
      title: node.title,
      work_title:
        materialLibrary.find((item) => item.id === node.id)?.work_title || "当前资料",
    };
    const previousKey = editingMaterialKey;
    setMaterials((values) =>
      previousKey
        ? values.map((value) =>
            materialKey(value) === previousKey ? selection : value,
          )
        : [...values, selection],
    );
    setEditingMaterialKey(materialKey(selection));
    setMaterialEditorOpen(false);
  }
  function removeMaterial(value: MaterialSelection) {
    const key = materialKey(value);
    setMaterials((values) => values.filter((item) => materialKey(item) !== key));
    if (editingMaterialKey === key) {
      setEditingMaterialKey(undefined);
      setMaterialEditorOpen(false);
      setMaterialDraft({
        start: 0,
        end: 0,
        quote: "",
        occurrence: 0,
        purpose: "author_reference",
        knownBy: [],
      });
    }
  }
  async function save() {
    if (!session || !catalog) return;
    setBusy(true);
    setError("");
    try {
      request.current ||= { id: crypto.randomUUID(), payload: {} };
      const payload = (request.current.payload = Object.keys(
        request.current.payload as object,
      ).length
        ? request.current.payload
        : {
            request_id: request.current.id,
            expected_revision: catalog.inputs.revision,
            series_version: catalog.series[0].version,
            title,
            purpose,
            background,
            ...(social ? {social} : {}),
            public_knowledge: publicInfo,
            adaptations,
            materials: materials.map(({ node: _node, title: _title, work_title: _workTitle, ...value }) => value),
            roles: roles.map((r) => ({
              ...r,
              knowledge: r.knowledge.filter((v) => v.trim()),
              beliefs: r.beliefs.filter((v) => v.trim()),
            })),
            places,
            items: items.map(({text,...item})=>({...item,...(text?.trim()?{text}: {})})),
            access_rules: gate
              ? [{ destination_id: "library", item_id: "pass" }]
              : [],
            unsupported_hard_rules: hardRules
              .split("\n")
              .filter((v) => v.trim()),
            confirmed,
          });
      const result = await runtimeRequest<{ worldline_id: string }>(
        session,
        "/scenarios",
        undefined,
        "POST",
        payload,
      );
      onCreated(result.worldline_id);
    } catch (e) {
      setError(
        (e as Error).message === "scenario_sources_changed"
          ? "原作资料已变化，请返回后重新载入并核对绑定。"
          : `保存未确认：${(e as Error).message}。重试会使用同一请求。`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="page academy-setup">
      <Button variant="ghost" onClick={onBack}>
        ← 返回世界线列表
      </Button>
      <header className="page-heading">
        <div>
          <span className="eyebrow">WORLD EXPERIENCE · 学院系列</span>
          <h1>把角色带入一个新的日常</h1>
          <p>新 Runtime 入口适用于学院模板和已选资料。4 张固定地图、6 个可选角色槽位，创建并保存冻结起点无需调用模型。</p>
          <p className="context-hint">起点语义：先确认资料版本、资料用途、角色知识和 Readiness，再进入文本与 2.5D 共用的世界线。</p>
        </div>
      </header>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {selectedSource && (
        <section className="academy-selected-source" aria-label="已选资料">
          <div>
            <span className="eyebrow">CREATOR MATERIAL · 已加载入口资料</span>
            <h2>{selectedSource.title} · v{selectedSource.version}</h2>
            <p>
              入口资料已加载到下方编辑器。你可以调整正文范围、用途和接收角色；保存后只冻结本次明确加入的资料，不改写 Canon。
            </p>
            <Link
              className="text-link"
              to={`/worlds/${world}/create?work=${selectedSource.work_id}&node=${selectedSource.id}&mode=read`}
            >
              返回资料阅读 →
            </Link>
          </div>
          {selectedSource.plain_text && (
            <p className="academy-selected-source-excerpt">
              {selectedSource.plain_text.slice(0, 280)}
              {selectedSource.plain_text.length > 280 ? "…" : ""}
            </p>
          )}
        </section>
      )}
      {!catalog ? (
        <p role="status">正在读取系列与本世界可绑定对象…</p>
      ) : (
        <>
          {!catalog.ready && (
            <ErrorNotice>
              当前开发库尚未显式升级到系列 Schema v3。不会自动迁移用户数据库。
            </ErrorNotice>
          )}
          <fieldset
            disabled={busy || Boolean(request.current)}
            className="academy-setup-fields"
          >
            <section>
              <h2>世界线与模拟用途</h2>
              <label>
                标题
                <input
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                模拟用途
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                >
                  <option value="template_parallel">模板平行世界</option>
                  <option value="sandbox">自由沙盒</option>
                  <option value="original_projection">原作推演（需启用社会演化并绑定全部角色／地点）</option>
                </select>
              </label>
              <label>
                世界背景（作者参考，不自动发给角色）
                <textarea
                  value={background}
                  maxLength={3000}
                  onChange={(e) => setBackground(e.target.value)}
                />
              </label>
              <label>
                所有角色在起点明确知道的信息（可留空）
                <textarea
                  value={publicInfo}
                  maxLength={1200}
                  onChange={(e) => setPublicInfo(e.target.value)}
                />
              </label>
              <label>
                本次沿用、补充或覆盖了什么
                <textarea
                  value={adaptations}
                  maxLength={3000}
                  onChange={(e) => setAdaptations(e.target.value)}
                />
              </label>
            </section>
            <section aria-label="资料与范围">
              <h2>
                资料与范围 <small>{materials.length} 项已选</small>
              </h2>
              <p>
                只冻结本次明确加入的正文版本和范围。作者参考不会进入角色知识；选择接收角色后，资料片段才会进入其起点已知。
              </p>
              <p className="academy-material-disclosure-note">
                已选资料显示为摘要。点击“编辑”只展开一项，完成后可以收起编辑器。
              </p>
              <label>
                添加或编辑本次资料
                <select
                  aria-label="选择本次资料"
                  value={materialEditorOpen ? materialDraft.node?.id || "" : ""}
                  onChange={(e) => void chooseMaterial(e.target.value)}
                >
                  <option value="">选择正文或资料节点</option>
                  {materialLibrary.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.work_title} / {item.title} · v{item.version}
                    </option>
                  ))}
                  {selectedSource && !materialLibrary.some((item) => item.id === selectedSource.id) && (
                    <option value={selectedSource.id}>
                      当前入口资料 / {selectedSource.title} · v{selectedSource.version}
                    </option>
                  )}
                </select>
              </label>
              {materials.length > 0 && (
                <div className="academy-material-list" aria-label="已选资料清单">
                  {materials.map((material) => {
                    const key = materialKey(material);
                    const editing = materialEditorOpen && editingMaterialKey === key;
                    return (
                      <article
                        key={key}
                        className={`academy-material-row${editing ? " is-editing" : ""}`}
                        aria-expanded={editing}
                      >
                        <div>
                          <strong>{material.work_title} / {material.title} · v{material.version}</strong>
                          <small>
                            {material.start}–{material.end} · {material.end - material.start} 个字符 ·
                            {material.purpose === "author_reference" ? " 作者参考" : " 角色已知 · " + material.known_by.length + " 位接收者"}
                          </small>
                        </div>
                        <div className="academy-material-row-actions">
                          <Button type="button" variant="ghost" onClick={() => editMaterial(material)}>
                            {editing ? "编辑中" : "编辑"}
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => removeMaterial(material)}>移除</Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {materialEditorOpen && materialDraft.node && (
                <div className="academy-material-editor">
                  <div className="academy-material-editor-heading">
                    <div>
                      <span className="eyebrow">正在编辑资料</span>
                      <strong>
                        {materialLibrary.find((item) => item.id === materialDraft.node?.id)?.work_title || "当前资料"}
                        {" / "}{materialDraft.node.title} · v{materialDraft.node.version}
                      </strong>
                      <small>共 {codePointLength(draftText)} 个 Unicode 字符</small>
                    </div>
                    <Button type="button" variant="ghost" onClick={() => { setMaterialEditorOpen(false); setMaterialError(""); }}>
                      收起编辑器
                    </Button>
                  </div>
                  <label>
                    引用原文片段（留空引用全文）
                    <textarea
                      aria-label="引用原文片段"
                      rows={4}
                      value={materialDraft.quote}
                      onChange={(e) =>
                        setMaterialDraft((value) => ({
                          ...value,
                          quote: e.target.value,
                          occurrence: 0,
                        }))
                      }
                    />
                  </label>
                  {draftMatches.length > 1 && (
                    <label>
                      同文片段出现位置
                      <select
                        aria-label="同文片段出现位置"
                        value={materialDraft.occurrence}
                        onChange={(e) =>
                          setMaterialDraft((value) => ({
                            ...value,
                            occurrence: Number(e.target.value),
                          }))
                        }
                      >
                        {draftMatches.map((position, index) => (
                          <option key={String(position) + "-" + index} value={index}>
                            第{index + 1}处
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="academy-material-range">
                    <label>
                      起始位置（Unicode 字符）
                      <input
                        aria-label="资料起始位置"
                        type="number"
                        min={0}
                        max={codePointLength(draftText)}
                        value={draftRange?.start ?? materialDraft.start}
                        disabled={Boolean(materialDraft.quote)}
                        onChange={(e) =>
                          setMaterialDraft((value) => ({
                            ...value,
                            start: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                    <label>
                      末端位置（不包含）
                      <input
                        aria-label="资料末端位置"
                        type="number"
                        min={1}
                        max={codePointLength(draftText)}
                        value={draftRange?.end ?? materialDraft.end}
                        disabled={Boolean(materialDraft.quote)}
                        onChange={(e) =>
                          setMaterialDraft((value) => ({
                            ...value,
                            end: Number(e.target.value),
                          }))
                        }
                      />
                    </label>
                  </div>
                  <p className="academy-material-range-note">
                    {draftRange
                      ? "本次将冻结第 " + draftRange.start + "–" + draftRange.end + " 个字符，共 " + (draftRange.end - draftRange.start) + " 个字符。"
                      : "当前片段未在资料中找到，请重新选择原文。"}
                  </p>
                  <label>
                    资料用途
                    <select
                      aria-label="资料用途"
                      value={materialDraft.purpose}
                      onChange={(e) =>
                        setMaterialDraft((value) => ({
                          ...value,
                          purpose: e.target.value as MaterialPurpose,
                          knownBy: e.target.value === "author_reference" ? [] : value.knownBy,
                        }))
                      }
                    >
                      <option value="author_reference">作者参考（不进入角色知识）</option>
                      <option value="agent_knowledge">角色已知资料</option>
                    </select>
                  </label>
                  {materialDraft.purpose === "agent_knowledge" && (
                    <fieldset className="academy-material-recipients">
                      <legend>资料接收角色</legend>
                      <div className="academy-check-grid">
                        {people.map((person) => (
                          <label className="academy-check" key={person.id}>
                            <input
                              type="checkbox"
                              aria-label={"资料接收者：" + person.name}
                              checked={materialDraft.knownBy.includes(person.id)}
                              onChange={(e) =>
                                setMaterialDraft((value) => ({
                                  ...value,
                                  knownBy: e.target.checked
                                    ? [...value.knownBy, person.id]
                                    : value.knownBy.filter((id) => id !== person.id),
                                }))
                              }
                            />
                            {person.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {materialError && <ErrorNotice>{materialError}</ErrorNotice>}
                  <Button onClick={addMaterial}>
                    {editingMaterialKey ? "更新这项资料" : "加入本次场景"}
                  </Button>
                </div>
              )}
            </section>
            <section>
              <h2>
                参与角色 <small>{people.length} / 6 已启用</small>
              </h2>
              <p>
                绑定只关联身份与来源，不会把原作全文、秘密或模板全设定自动交给角色。
              </p>
              <div className="academy-role-grid">
                {roles.map((p, i) => (
                  <article key={p.id} className="academy-role-card">
                    <label className="academy-check">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) =>
                          setRoles((rs) =>
                            rs.map((r, j) =>
                              j === i ? { ...r, enabled: e.target.checked } : r,
                            ),
                          )
                        }
                      />
                      启用槽位 {i + 1}
                    </label>
                    <fieldset disabled={!p.enabled}>
                      <label>
                        角色来源
                        <select
                          aria-label={`槽位${i + 1}角色来源`}
                          value={p.entity_id || ""}
                          onChange={(e) =>
                            setRoles((rs) =>
                              rs.map((r, j) =>
                                j === i
                                  ? (bind(r, e.target.value) as Person)
                                  : r,
                              ),
                            )
                          }
                        >
                          <option value="">模板／手工角色</option>
                          {catalog.inputs.entities
                            .filter((e) => e.kind === "character")
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name} · v{e.version}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        名称
                        <input
                          value={p.name}
                          maxLength={80}
                          onChange={(e) =>
                            setRoles((rs) =>
                              rs.map((r, j) =>
                                j === i ? { ...r, name: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        外观
                        <select
                          value={p.avatar}
                          onChange={(e) =>
                            setRoles((rs) =>
                              rs.map((r, j) =>
                                j === i
                                  ? { ...r, avatar: Number(e.target.value) }
                                  : r,
                              ),
                            )
                          }
                        >
                          {[
                            "蓝衣学员",
                            "浅绿学员",
                            "暖色教师",
                            "青色馆员",
                            "棕色工作人员",
                            "紫色访客",
                          ].map((v, a) => (
                            <option key={v} value={a}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        人设（仅供本人决策）
                        <textarea
                          value={p.persona}
                          maxLength={2000}
                          onChange={(e) =>
                            setRoles((rs) =>
                              rs.map((r, j) =>
                                j === i ? { ...r, persona: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        初始目标
                        <input
                          value={p.goal}
                          maxLength={1000}
                          onChange={(e) =>
                            setRoles((rs) =>
                              rs.map((r, j) =>
                                j === i ? { ...r, goal: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        初始地点
                        <select
                          value={p.location}
                          onChange={(e) =>
                            setRoles((rs) =>
                              rs.map((r, j) =>
                                j === i
                                  ? { ...r, location: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        >
                          {places.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(["knowledge", "beliefs"] as const).map((field) => (
                        <label key={field}>
                          {field === "knowledge"
                            ? "本人起点已知（每行一条）"
                            : "本人初始信念（每行一条，可有误）"}
                          <textarea
                            value={p[field].join("\n")}
                            onChange={(e) =>
                              setRoles((rs) =>
                                rs.map((r, j) =>
                                  j === i
                                    ? {
                                        ...r,
                                        [field]: e.target.value.split("\n"),
                                      }
                                    : r,
                                ),
                              )
                            }
                          />
                        </label>
                      ))}
                    </fieldset>
                  </article>
                ))}
              </div>
            </section>
            <section>
              <h2>固定场景与地点绑定</h2>
              <div className="academy-place-grid">
                {places.map((p, i) => (
                  <article key={p.id}>
                    <label>
                      地点来源
                      <select
                        value={p.entity_id || ""}
                        onChange={(e) =>
                          setPlaces((ps) =>
                            ps.map((r, j) =>
                              j === i ? (bind(r, e.target.value) as Place) : r,
                            ),
                          )
                        }
                      >
                        <option value="">系列新增地点</option>
                        {catalog.inputs.entities
                          .filter((e) => e.kind === "location")
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name} · v{e.version}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      显示名称
                      <input
                        value={p.name}
                        maxLength={80}
                        onChange={(e) =>
                          setPlaces((ps) =>
                            ps.map((r, j) =>
                              j === i ? { ...r, name: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      公开描述
                      <textarea
                        value={p.description}
                        maxLength={1200}
                        onChange={(e) =>
                          setPlaces((ps) =>
                            ps.map((r, j) =>
                              j === i
                                ? { ...r, description: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                    </label>
                    <span>允许前往</span>
                    {catalog.series[0].places
                      .find((s) => s.id === p.id)!
                      .neighbors.map((id) => (
                        <label className="academy-check" key={id}>
                          <input
                            type="checkbox"
                            checked={p.neighbors.includes(id)}
                            onChange={(e) =>
                              setPlaces((ps) =>
                                ps.map((r, j) =>
                                  j === i
                                    ? {
                                        ...r,
                                        neighbors: e.target.checked
                                          ? [...r.neighbors, id]
                                          : r.neighbors.filter((v) => v !== id),
                                      }
                                    : r,
                                ),
                              )
                            }
                          />
                          {places.find((s) => s.id === id)?.name}
                        </label>
                      ))}
                  </article>
                ))}
              </div>
            </section>
            <section>
              <h2>道具与可执行规则</h2>
              {items.map((item, i) => (
                <div className="academy-item-row" key={item.id}>
                  <label>
                    道具名称
                    <input
                      value={item.name}
                      maxLength={80}
                      onChange={(e) =>
                        setItems((xs) =>
                          xs.map((v, j) =>
                            j === i ? { ...v, name: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    说明
                    <input
                      value={item.description}
                      maxLength={600}
                      onChange={(e) =>
                        setItems((xs) =>
                          xs.map((v, j) =>
                            j === i ? { ...v, description: e.target.value } : v,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    初始归属
                    <select
                      value={item.holder}
                      onChange={(e) =>
                        setItems((xs) =>
                          xs.map((v, j) =>
                            j === i ? { ...v, holder: e.target.value } : v,
                          ),
                        )
                      }
                    >
                      {[...places, ...people].map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{gridColumn:'1 / -1'}}>
                    {item.name} · 可读片段（可选，最多1200字）
                    <textarea value={item.text||''} maxLength={1200} rows={3}
                      onChange={e=>setItems(xs=>xs.map((v,j)=>j===i?{...v,text:e.target.value}:v))}/>
                    <small>填写本次物品实际记载的文本；保存后冻结。仅持有人阅读后获知，文字不自动成为世界事实。留空时不提供阅读能力。</small>
                  </label>
                </div>
              ))}
              <label className="academy-check">
                <input
                  type="checkbox"
                  checked={gate}
                  onChange={(e) => setGate(e.target.checked)}
                />
                进入图书馆需持有通行卡
              </label>
              <label>
                仍需要但当前机制不支持的硬规则（填写后不能启动）
                <textarea
                  value={hardRules}
                  onChange={(e) => setHardRules(e.target.value)}
                />
              </label>
            </section>
            <SocialPreparation value={social} onChange={setSocial} people={roles} places={places} session={session} available={Boolean(catalog.social_ready)}/>
            <details className="academy-start-summary">
              <summary>核对本次起点</summary>
              <p>{catalog.series[0].name} · v{catalog.series[0].version} · {catalog.series[0].asset_version}</p>
              <h3>角色采用值</h3>
              <ul>{people.map((person) => {
                const template = catalog.series[0].roles.find((entry) => entry.id === person.id);
                return <li key={person.id}>
                  <strong>{person.name} · {startName(person.location)} · 外观 {person.avatar + 1}</strong>
                  <small>模板默认 {template?.name} · 外观 {(template?.avatar ?? 0) + 1} · 作品来源 {sourceLabel(person)}</small>
                </li>;
              })}</ul>
              <h3>地点采用值</h3>
              <ul>{places.map((place) => {
                const template = catalog.series[0].places.find((entry) => entry.id === place.id);
                return <li key={place.id}>
                  <strong>{place.name}</strong>
                  <small>模板默认 {template?.name} · 作品来源 {sourceLabel(place)}</small>
                  <small>可前往 {place.neighbors.map(startName).join("、") || "无相邻出口"}</small>
                </li>;
              })}</ul>
              <p>道具起点 · {items.map((item) => `${item.name} → ${startName(item.holder)}`).join("、")}</p>
              <p>{gate ? "图书馆门禁 · 需要通行卡" : "图书馆门禁 · 无通行卡要求"}</p>
            </details>
            <label className="academy-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我已核对角色输入、模板新增与覆盖内容；本次独立模拟不改原作 Canon。
            </label>
          </fieldset>
          <footer className="academy-save">
            <span>只保存暂停起点，不会自动开始模型调用。</span>
            {invalidHolder && (
              <span role="status">
                有道具归属于未启用角色，请先重新选择初始归属。
              </span>
            )}
            {needsReadingSetup && <ErrorNotice>填写可读片段后，请启用自主社会演化与认知修订；不会升级旧世界线。</ErrorNotice>}
            <Button
              variant="primary"
              disabled={
                busy ||
                !catalog.ready ||
                Boolean(sourceNodeId && !selectedSource) ||
                !confirmed ||
                !people.length ||
                !title.trim() ||
                Boolean(social && !social.start_time.trim()) ||
                (purpose==='original_projection' && (!social || people.some(p=>!p.entity_id) || places.some(p=>!p.entity_id))) ||
                Boolean(hardRules.trim()) ||
                invalidHolder || needsReadingSetup
              }
              onClick={() => void save()}
            >
              {busy
                ? "正在保存…"
                : request.current
                  ? "重试同一次保存"
                  : "保存并进入世界"}
            </Button>
            {request.current && !busy && (
              <Button
                onClick={() => {
                  request.current = undefined;
                  setError("");
                  setConfirmed(false);
                }}
              >
                返回核对输入
              </Button>
            )}
          </footer>
        </>
      )}
    </main>
  );
}
