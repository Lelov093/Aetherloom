import { useEffect, useState, lazy, Suspense } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Plus,
  BookOpen,
  Upload,
  PanelLeftClose,
  ChevronRight,
  FileText,
  FolderOpen,
  Settings2,
} from "lucide-react";
import { Button, Dialog, EmptyState, ErrorNotice } from "../../components/ui";
import { ResourceForm } from "./ResourceForm";
import { ImportDialog } from "./ImportDialog";
import { MaterialClassification, materialCategories } from './MaterialClassification';
import { ContentLibrary } from './ContentLibrary';
import { WorkContents } from './WorkContents';
import { useWorkspaceTrail } from "../../components/WorkspaceContext";
const ContentEditor = lazy(() =>
  import("./ContentEditor").then((module) => ({
    default: module.ContentEditor,
  })),
);
import {
  creationApi,
  workKinds,
  type Work,
  type ContentNode,
  type Entity,
  type Status,
} from "./api";

export function CreationWorkspace({ world }: { world: string }) {
  const [params, setParams] = useSearchParams();
  const [category,setCategory] = useState(''), [tag,setTag] = useState('');
  const selectedWork = params.get("work"),
    selectedNode = params.get("node");
  const library = params.get('view') === 'library';
  const [works, setWorks] = useState<Work[]>([]),
    [nodes, setNodes] = useState<ContentNode[]>([]),
    [entities, setEntities] = useState<Entity[]>([]),
    [node, setNode] = useState<ContentNode>();
  const [loading, setLoading] = useState(true),
    [nodesLoading,setNodesLoading] = useState(false),
    [error, setError] = useState(""),
    [creatingWork, setCreatingWork] = useState(false),
    [creatingNode, setCreatingNode] = useState(false),
    [importing, setImporting] = useState(false),
    [manageWork, setManageWork] = useState(false),
    [manageNode, setManageNode] = useState<ContentNode>();
  const [parent, setParent] = useState<string | null>(null),
    [tree, setTree] = useState(
      () => window.matchMedia("(min-width: 1100px)").matches,
    ),
    [focus, setFocus] = useState(false),
    [q, setQ] = useState(""),
    [status, setStatus] = useState<Status>("active");
  const filtering = Boolean(q.trim() || category || tag.trim());
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1100px)");
    const update = () => {
      if (!mq.matches) setTree(false);
    };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  const work = works.find((w) => w.id === selectedWork);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [matches, setMatches] = useState<{
      items: (ContentNode & { excerpt: string })[];
      total: number;
      limit: number;
    }>(),
    [searchOffset, setSearchOffset] = useState(0),
    [searchError, setSearchError] = useState("");
  useEffect(() => {
    setQ("");
    setCategory(''); setTag('');
    setSearchOffset(0);
  }, [selectedWork]);
  useEffect(() => {
    setSearchOffset(0);
  }, [q, status, category, tag]);
  useEffect(() => {
    let active = true;
    setMatches(undefined);
    setSearchError("");
    if (!selectedWork || !filtering) return;
    const timer = setTimeout(() => {
      creationApi
        .searchContent(selectedWork, q.trim(), status, searchOffset, category, tag.trim())
        .then((result) => {
          if (active) setMatches(result);
        })
        .catch((e) => {
          if (active) setSearchError(e.message);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedWork, q, status, searchOffset, nodes, category, tag]);
  async function loadWorks() {
    const [ws, es] = await Promise.all([
      creationApi.works(world),
      creationApi.entities(world),
    ]);
    setWorks(ws);
    setEntities(es);
    return ws;
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    loadWorks()
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [world]);
  useEffect(() => {
    let active = true;
    setNodes([]);
    setNodesLoading(Boolean(selectedWork));
    if (selectedWork)
      creationApi
        .nodes(selectedWork)
        .then((ns) => {
          if (active) setNodes(ns);
        })
        .catch((e) => {
          if (active) setError(e.message);
        }).finally(()=>{if(active)setNodesLoading(false);});
    return () => {
      active = false;
    };
  }, [selectedWork]);
  useEffect(() => {
    let active = true;
    setNode(undefined);
    setFocus(false);
    if (selectedNode)
      creationApi
        .node(selectedNode)
        .then((n) => {
          if (active) {
            if (n.work_id !== selectedWork) setError("文档不属于当前作品。");
            else setNode(n);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selectedNode, selectedWork]);
  function selectWork(id: string) {
    setParams({ work: id });
    setStatus("active");
  }
  function selectNode(n: ContentNode) {
    setParams({ work: n.work_id, node: n.id, ...(params.get('mode')==='read'?{mode:'read'}:{}) });
  }
  function saved(n: ContentNode) {
    setNode(n);
    setNodes((ns) =>
      ns.map((item) => (item.id === n.id ? { ...item, ...n } : item)),
    );
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ancestors: ContentNode[] = [];
  let ancestor = node?.parent_id ? byId.get(node.parent_id) : undefined;
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = ancestor.parent_id ? byId.get(ancestor.parent_id) : undefined;
  }
  useWorkspaceTrail(
    work
      ? [
          { label: work.title, to: `/worlds/${world}/create?work=${work.id}` },
          ...ancestors.map((n) => ({
            label: n.title,
            to: `/worlds/${world}/create?work=${work.id}&node=${n.id}${params.get('mode')==='read'?'&mode=read':''}`,
          })),
          ...(node ? [{ label: node.title }] : []),
        ]
      : [],
  );
  function effective(n: ContentNode) {
    let parent = n.parent_id;
    while (parent) {
      const p = byId.get(parent);
      if (!p || p.status !== "active") return false;
      parent = p.parent_id;
    }
    return true;
  }
  function treeRows(parentId: string | null, depth = 0): React.ReactNode {
    return nodes
      .filter(
        (n) =>
          n.parent_id === parentId && n.status === "active" && effective(n),
      )
      .map((n) => (
        <div key={n.id}>
          <div
            className={`tree-row ${selectedNode === n.id ? "selected" : ""}`}
            style={{ paddingLeft: 8 + depth * 12 }}
          >
            {nodes.some(
              (child) => child.parent_id === n.id && child.status === "active",
            ) ? (
              <button
                className={`tree-expander ${collapsed[n.id] ? "" : "expanded"}`}
                aria-label={`${collapsed[n.id] ? "展开" : "收起"} ${n.title}`}
                aria-expanded={!collapsed[n.id]}
                onClick={() =>
                  setCollapsed({ ...collapsed, [n.id]: !collapsed[n.id] })
                }
              >
                <ChevronRight size={12} />
              </button>
            ) : (
              <span className="tree-expander-space" />
            )}
            <button className="tree-title" onClick={() => selectNode(n)}>
              {["volume", "act"].includes(n.kind) ? (
                <FolderOpen size={16} />
              ) : (
                <FileText size={16} />
              )}
              <span>{n.title}</span>
            </button>
            <Button
              variant="ghost"
              aria-label={`管理 ${n.title}`}
              onClick={() => setManageNode(n)}
            >
              <Settings2 size={13} />
            </Button>
          </div>
          {!collapsed[n.id] && treeRows(n.id, depth + 1)}
        </div>
      ));
  }
  return (
    <main
      id="main-content"
      className={`creation-workspace ${!tree || focus || library ? "tree-hidden" : ""}`}
    >
      <div className="creation-subnav">
        <Link to={`/worlds/${world}/create`} className={library?'':'active'}>
          作品
        </Link>
        <Link to={`/worlds/${world}/create?view=library`} className={library?'active':''}>全部资料</Link>
        <Link to={`/worlds/${world}/create/objects`}>世界对象</Link>
        <span className="subnav-note">Working Canon · 正文与事实分别保存</span>
        <Button
          variant="ghost"
          aria-label={tree ? "收起作品目录" : "打开作品目录"}
          disabled={library}
          onClick={() => setTree(!tree)}
        >
          <PanelLeftClose size={17} />
        </Button>
      </div>
      {tree && !focus && !library && (
        <aside className="document-tree" aria-label="作品目录">
          <header className="tree-panel-heading">
            <BookOpen size={19} />
            <span>作品结构</span>
          </header>
          <div className="tree-work-picker">
            <label htmlFor="work-picker">当前作品</label>
            <select
              id="work-picker"
              value={selectedWork || ""}
              onChange={(e) => selectWork(e.target.value)}
            >
              <option value="">选择作品…</option>
              {works.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                  {w.status === "active"
                    ? ""
                    : w.status === "archived"
                      ? "（已归档）"
                      : "（已删除）"}
                </option>
              ))}
            </select>
            <div className="tree-actions">
              <Button
                variant="ghost"
                aria-label="创建作品"
                onClick={() => setCreatingWork(true)}
              >
                <Plus size={16} />
              </Button>
              <Button
                variant="ghost"
                aria-label="导入作品"
                onClick={() => setImporting(true)}
              >
                <Upload size={16} />
              </Button>
              {work && (
                <Button
                  variant="ghost"
                  aria-label="管理作品"
                  onClick={() => setManageWork(true)}
                >
                  <Settings2 size={16} />
                </Button>
              )}
            </div>
          </div>
          {work && (
            <>
              <figure className="work-atmosphere">
                <img src="/art/harbor-light.webp" alt="" aria-hidden="true" />
                <figcaption>
                  <strong>{work.title}</strong>
                  <span>{workKinds[work.kind] || work.kind}</span>
                </figcaption>
              </figure>
              <div className="tree-filter">
                <input
                  aria-label="在作品中搜索"
                  placeholder="搜索目录或正文…"
                  maxLength={200}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <select
                  aria-label="文档状态"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Status)}
                >
                  <option value="active">活跃内容</option>
                  <option value="archived">已归档</option>
                  <option value="deleted">已删除</option>
                </select>
                <select aria-label="筛选资料分类" value={category} onChange={e=>setCategory(e.target.value)}>
                  <option value="">全部分类</option>{Object.entries(materialCategories).map(([id,label])=><option key={id} value={id}>{label}</option>)}
                </select>
                <input aria-label="筛选资料标签" placeholder="按标签筛选…" maxLength={80} value={tag} onChange={e=>setTag(e.target.value)}/>
              </div>
              <nav aria-label="文档树">
                {filtering ? (
                  <>
                    {searchError ? (
                      <ErrorNotice>{searchError}</ErrorNotice>
                    ) : !matches ? (
                      <p role="status">正在搜索作品…</p>
                    ) : (
                      <>
                        <p className="context-hint">
                          {matches.total} 篇匹配内容
                        </p>
                        {matches.items.map((n) => (
                          <div
                            className={`tree-search-result ${selectedNode === n.id ? "selected" : ""}`}
                            key={n.id}
                          >
                            <button
                              className="tree-title"
                              onClick={() => selectNode(n)}
                            >
                              <span>
                                <strong>{n.title}</strong>
                                <small>{n.excerpt}</small>
                              </span>
                            </button>
                          </div>
                        ))}
                        {matches.total > matches.limit && (
                          <div className="preview-order">
                            <Button
                              variant="ghost"
                              disabled={!searchOffset}
                              onClick={() =>
                                setSearchOffset(
                                  Math.max(0, searchOffset - matches.limit),
                                )
                              }
                            >
                              上一页
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={
                                searchOffset + matches.limit >= matches.total
                              }
                              onClick={() =>
                                setSearchOffset(searchOffset + matches.limit)
                              }
                            >
                              下一页
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                ) : status !== "active" ? (
                  nodes
                    .filter((n) => n.status === status)
                    .map((n) => (
                      <div className="tree-row" key={n.id}>
                        <button
                          className="tree-title"
                          onClick={() => selectNode(n)}
                        >
                          {n.title}
                        </button>
                        <Button
                          variant="ghost"
                          aria-label={`管理 ${n.title}`}
                          onClick={() => setManageNode(n)}
                        >
                          <Settings2 size={13} />
                        </Button>
                      </div>
                    ))
                ) : (
                  treeRows(null)
                )}
              </nav>
              <Button
                className="new-document"
                variant="ghost"
                disabled={work.status !== "active"}
                onClick={() => {
                  setParent(null);
                  setCreatingNode(true);
                }}
              >
                <Plus size={16} />
                添加内容
              </Button>
            </>
          )}
        </aside>
      )}
      <div className="creation-primary">
        {error && (
          <div className="workspace-error">
            <ErrorNotice>{error}</ErrorNotice>
            <Button
              onClick={() => {
                setError("");
                void loadWorks().catch((e) => setError(e.message));
              }}
            >
              重新读取作品
            </Button>
          </div>
        )}
        {loading ? (
          <p className="creation-loading">正在打开作品…</p>
        ) : library ? <ContentLibrary world={world} works={works}/> : work &&
          node &&
          work.status === "active" &&
          node.status === "active" &&
          effective(node) ? (
          <Suspense
            fallback={<p className="creation-loading">正在准备编辑器…</p>}
          >
            <ContentEditor
              key={node.id}
              initial={node}
              entities={entities}
              world={world}
              onSaved={saved}
              onFocusChange={setFocus}
              directory={['volume','act'].includes(node.kind)||nodes.some(n=>n.parent_id===node.id&&n.status==='active') ? <WorkContents world={world} nodes={nodes} parent={node.id}/> : undefined}
            />
          </Suspense>
        ) : work && node ? (
          <div className="creation-empty content-entry-page">
            <h1>{node.title}</h1>
            <p>
              这篇内容或其所属作品 /
              目录已被收起。资料与历史仍保留，恢复后可继续编辑。
            </p>
            <Button
              onClick={() =>
                work.status !== "active"
                  ? setManageWork(true)
                  : setManageNode(node)
              }
            >
              管理与恢复
            </Button>
          </div>
        ) : (
          <div className="creation-empty content-entry-page">
            <span className="eyebrow">A STORY, TAKING SHAPE</span>
            <h1>{work ? work.title : works.some(w=>w.status==='active') ? '你的作品与创作资料' : "给故事一个开始"}</h1>
            <p>
              {work
                ? "从左侧打开一篇内容，或添加新的章节、场景和笔记。"
                : "从已有设定、大纲或正文开始，作品共享这个世界的对象与正式设定。"}
            </p>
            <div className="creation-entry-actions">
              {work ? (
                <Button
                  variant="primary"
                  disabled={work.status !== "active"}
                  onClick={() => {
                    setParent(null);
                    setCreatingNode(true);
                  }}
                >
                  <Plus size={17} />
                  添加内容
                </Button>
              ) : (
                <>
                  <Button
                    variant="primary"
                    onClick={() => setCreatingWork(true)}
                  >
                    <Plus size={17} />
                    创建作品
                  </Button>
                  <Button onClick={() => setImporting(true)}>
                    <Upload size={17} />
                    导入已有资料
                  </Button>
                </>
              )}
              <Link
                className="text-link"
                to={`/worlds/${world}/create/objects`}
              >
                整理世界对象 <ChevronRight size={14} />
              </Link>
            </div>
            <EmptyState
              icon={<BookOpen size={24} />}
              title="正文保存与正式设定各有位置"
            >
              你可以自由修改作品；世界事实始终由你明确确认。
            </EmptyState>
            {work&&work.status==='active'?<WorkContents world={world} nodes={nodes} loading={nodesLoading}/>:!work&&works.filter(w=>w.status==='active').length>0&&<section className="work-contents" aria-label="世界作品列表"><h2>已有作品</h2>{works.filter(w=>w.status==='active').map(w=><Link className="material-library-row" key={w.id} to={`/worlds/${world}/create?work=${w.id}`}><div><strong>{w.title}</strong><small>{workKinds[w.kind]}</small></div><span>打开作品 →</span></Link>)}</section>}
          </div>
        )}
      </div>
      {creatingWork && (
        <ResourceForm
          title="创建作品"
          kinds={workKinds}
          onClose={() => setCreatingWork(false)}
          onSubmit={async (title, kind) => {
            const w = await creationApi.createWork(world, title, kind);
            await loadWorks();
            selectWork(w.id);
          }}
        />
      )}
      {creatingNode && work && (
        <Dialog title="添加内容" onClose={() => setCreatingNode(false)}>
          <NodeCreateForm
            nodes={nodes}
            initialParent={parent}
            onCreated={async (title, kind, parentId, metadata) => {
              const n = await creationApi.createNode(
                work.id,
                title,
                kind,
                parentId,
                metadata,
              );
              setNodes(await creationApi.nodes(work.id));
              setCreatingNode(false);
              selectNode(n);
            }}
          />
        </Dialog>
      )}
      {importing && (
        <ImportDialog
          world={world}
          onClose={() => setImporting(false)}
          onImported={(w) => {
            void loadWorks();
            selectWork(w.id);
          }}
        />
      )}
      {manageWork && work && (
        <ManageWork
          work={work}
          onClose={() => setManageWork(false)}
          onSave={async (data) => {
            await creationApi.updateWork(work, data);
            await loadWorks();
            setManageWork(false);
          }}
        />
      )}
      {manageNode && (
        <ManageNode
          node={manageNode}
          nodes={nodes}
          onClose={() => setManageNode(undefined)}
          onSave={async (data) => {
            const n = await creationApi.updateNode(manageNode, data);
            setNodes(await creationApi.nodes(n.work_id));
            if (n.id === selectedNode) setNode(n);
            setManageNode(undefined);
          }}
        />
      )}
    </main>
  );
}
function NodeCreateForm({
  nodes,
  initialParent,
  onCreated,
}: {
  nodes: ContentNode[];
  initialParent: string | null;
  onCreated: (
    title: string,
    kind: string,
    parent: string | null,
    metadata: Record<string,string>,
  ) => Promise<void>;
}) {
  const [category,setCategory] = useState('unclassified'), [tags,setTags] = useState<string[]>([]);
  const [title, setTitle] = useState(""),
    [kind, setKind] = useState("chapter"),
    [parent, setParent] = useState(initialParent || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onCreated(title, kind, parent || null, {material_category:category,material_tags:JSON.stringify(tags)});
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>标题</span>
        <input
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="field">
        <span>目录结构类型（可自定义）</span>
        <input
          value={kind}
          required
          list="node-kinds"
          maxLength={40}
          onChange={(e) => setKind(e.target.value)}
        />
        <datalist id="node-kinds">
          <option value="volume" />
          <option value="chapter" />
          <option value="section" />
          <option value="act" />
          <option value="scene" />
          <option value="quest" />
          <option value="note" />
        </datalist>
      </label>
      <label className="field">
        <span>放入目录</span>
        <select value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">作品根目录</option>
          {nodes
            .filter((n) => n.status === "active")
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
        </select>
      </label>
      <MaterialClassification category={category} tags={tags} onChange={(category,tags)=>{setCategory(category);setTags(tags);}}/>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        <Button variant="primary" disabled={busy}>
          添加
        </Button>
      </div>
    </form>
  );
}
function ManageWork({
  work,
  onClose,
  onSave,
}: {
  work: Work;
  onClose: () => void;
  onSave: (data: Partial<Work>) => Promise<void>;
}) {
  const [title, setTitle] = useState(work.title),
    [kind, setKind] = useState(work.kind),
    [status, setStatus] = useState(work.status),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="管理作品" onClose={onClose} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave({ title, kind, status });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>作品名称</span>
          <input
            value={title}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>作品类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(workKinds).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <StatusField status={status} onChange={setStatus} />
        <p className="dialog-intro">
          归档 / 删除会收起作品与其中的内容，资料和历史可恢复。
        </p>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="dialog-actions">
          <Button variant="primary" disabled={busy}>
            确认保存
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function ManageNode({
  node,
  nodes,
  onClose,
  onSave,
}: {
  node: ContentNode;
  nodes: ContentNode[];
  onClose: () => void;
  onSave: (data: Partial<ContentNode>) => Promise<void>;
}) {
  const [title, setTitle] = useState(node.title),
    [parent, setParent] = useState(node.parent_id || ""),
    [position, setPosition] = useState(node.position),
    [status, setStatus] = useState(node.status),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title="管理内容" onClose={onClose} busy={busy}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(
              node.status !== "active"
                ? { status }
                : { title, parent_id: parent || null, position, status },
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>标题</span>
          <input
            value={title}
            disabled={node.status !== "active"}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="field">
          <span>所在目录</span>
          <select
            value={parent}
            disabled={node.status !== "active"}
            onChange={(e) => setParent(e.target.value)}
          >
            <option value="">作品根目录</option>
            {nodes
              .filter((n) => n.id !== node.id && n.status === "active")
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span>排列顺序（从 0 开始）</span>
          <input
            type="number"
            min={0}
            disabled={node.status !== "active"}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
        </label>
        <StatusField status={status} onChange={setStatus} />
        <p className="dialog-intro">
          收起目录后，子内容也会从活跃入口隐藏；恢复父目录后可重新访问。链接和历史保留。
        </p>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="dialog-actions">
          <Button variant="primary" disabled={busy}>
            确认保存
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
function StatusField({
  status,
  onChange,
}: {
  status: Status;
  onChange: (s: Status) => void;
}) {
  return (
    <label className="field">
      <span>管理状态</span>
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as Status)}
      >
        <option value="active">活跃</option>
        <option value="archived">归档</option>
        <option value="deleted">删除（可恢复）</option>
      </select>
    </label>
  );
}
