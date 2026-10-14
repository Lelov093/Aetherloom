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
import { NumberInput, TypeCombobox } from '../../components/FormControls';
import { ResourceForm } from "./ResourceForm";
import { ImportDialog } from "./ImportDialog";
import { MaterialClassification, materialCategories } from './MaterialClassification';
import { ContentLibrary } from './ContentLibrary';
import { WorkContents } from './WorkContents';
import { PanelResize, useCreatePanel } from './CreatePanel';
import { useWorkspaceTrail } from "../../components/WorkspaceContext";
const ContentEditor = lazy(() => import('./ContentEditor').then(module => ({ default: module.ContentEditor })));
import { DisplayImage, DisplayImageEditor, useDisplayImages } from '../objects/DisplayImages';
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
  const { images: covers } = useDisplayImages(world, 'work');
  const [coverEditing, setCoverEditing] = useState(false);
  const [nodeLoading, setNodeLoading] = useState(false), [nodeRetry, setNodeRetry] = useState(0);
  const [openedWork, setOpenedWork] = useState<string>();
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
  const leftPanel = useCreatePanel('left', 280, 1100);
  const tree = leftPanel.open, setTree = leftPanel.setOpen;
  const [parent, setParent] = useState<string | null>(null),
    [focus, setFocus] = useState(false),
    [q, setQ] = useState(""),
    [status, setStatus] = useState<Status>("active");
  const filtering = Boolean(q.trim() || category || tag.trim());
  const work = works.find((w) => w.id === selectedWork);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [matches, setMatches] = useState<{
      items: (ContentNode & { excerpt: string })[];
      total: number;
      limit: number;
    }>(),
    [searchOffset, setSearchOffset] = useState(0),
    [searchError, setSearchError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
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
    setSearchError("");
    if (!selectedWork || !filtering) { setSearchLoading(false); return; }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      creationApi
        .searchContent(selectedWork, q.trim(), status, searchOffset, category, tag.trim())
        .then((result) => {
          if (active) setMatches(result);
        })
        .catch((e) => {
          if (active) setSearchError(e.message);
        }).finally(() => { if (active) setSearchLoading(false); });
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
    setError('');
    setNodeLoading(Boolean(selectedNode));
    setNodesLoading(Boolean(selectedWork && selectedWork !== openedWork));
    if (!selectedWork) { setNode(undefined); setNodes([]); setOpenedWork(undefined); setNodeLoading(false); return; }
    const directory = selectedWork === openedWork ? Promise.resolve(nodes) : creationApi.nodes(selectedWork);
    Promise.all([directory, selectedNode ? creationApi.node(selectedNode) : Promise.resolve(undefined)])
      .then(([nextNodes, nextNode]) => {
        if (!active) return;
        if (nextNode && nextNode.work_id !== selectedWork) throw new Error('文档不属于当前作品。');
        setNodes(nextNodes); setOpenedWork(selectedWork); setNode(nextNode);
      })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) { setNodeLoading(false); setNodesLoading(false); } });
    return () => { active = false; };
    // Directory mutations already update nodes locally; only navigation reloads content.
  }, [selectedNode, selectedWork, nodeRetry]);
  useEffect(() => { if (!selectedNode) setFocus(false); }, [selectedNode]);
  function selectWork(id: string) {
    setParams({ work: id });
    setStatus("active");
  }
  function selectNode(n: ContentNode) {
    setParams({ work: n.work_id, node: n.id, ...(params.get('mode')==='read'?{mode:'read'}:{}) });
    if (leftPanel.floating) setTree(false);
  }
  function saved(n: ContentNode) {
    setNode(current => current?.id === n.id ? n : current);
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
            <button className="tree-title" title={n.title} aria-current={selectedNode === n.id ? 'page' : undefined} onClick={() => selectNode(n)}>
              {["volume", "act"].includes(n.kind) || nodes.some(child => child.parent_id === n.id && child.status === 'active') ? (
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
      style={{ '--create-tree-width': `${leftPanel.width}px` } as React.CSSProperties}
    >
      {(!selectedWork || !selectedNode || library) && <div className="creation-subnav">
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
      </div>}
      {tree && !focus && !library && (
        <div className={`create-tree-frame ${leftPanel.floating ? 'is-floating' : ''}`}>
        {leftPanel.floating && <button className="create-panel-scrim" aria-label="关闭作品目录浮层" onClick={() => setTree(false)}/>}
        <aside id="create-directory" className="document-tree" role={leftPanel.floating?'dialog':undefined} aria-modal={leftPanel.floating||undefined} aria-label="作品目录">
          <header className="tree-panel-heading">
            <BookOpen size={19} />
            <span>作品结构</span>
            <Button variant="ghost" aria-label="收起作品目录" title="收起作品目录" onClick={() => setTree(false)}><PanelLeftClose size={17}/></Button>
          </header>
          <div className="tree-work-picker">
            <select
              id="work-picker"
              aria-label="当前作品"
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
              <DisplayImage owner="work" id={work.id} name={work.title} version={covers[work.id]} className="tree-cover"/>
              <div className="tree-filter">
                <input
                  aria-label="在作品中搜索"
                  placeholder="搜索目录或正文…"
                  maxLength={200}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <details className="tree-refinements" open={status !== 'active' || !!category || !!tag}>
                  <summary>筛选与状态{(status !== 'active' || category || tag) && ' · 已筛选'}</summary>
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
                </details>
              </div>
              <nav aria-label="文档树" aria-busy={nodesLoading} inert={nodesLoading}>
                {filtering ? (
                  <>
                    {searchError ? (
                      <ErrorNotice>{searchError}</ErrorNotice>
                    ) : !matches ? (
                      <p role="status">正在搜索作品…</p>
                    ) : (
                      <>
                        <p className="context-hint">
                          {searchLoading ? '正在更新搜索…' : `${matches.total} 篇匹配内容`}
                        </p>
                        {matches.items.map((n) => (
                          <div
                            className={`tree-search-result ${selectedNode === n.id ? "selected" : ""}`}
                            key={n.id}
                          >
                            <button
                              className="tree-title"
                              disabled={searchLoading}
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
                              disabled={searchLoading || !searchOffset}
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
                                searchLoading || searchOffset + matches.limit >= matches.total
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
        {!leftPanel.floating && <PanelResize panel={leftPanel} controls="create-directory"/>}
        </div>
      )}
      <div className="creation-primary">
        {nodeLoading && <p className="route-refresh" role="status">正在打开所选内容…</p>}
        {error && (
          <div className="workspace-error">
            <ErrorNotice>{error}</ErrorNotice>
            <Button
              onClick={() => {
                setError("");
                setNodeRetry(value => value + 1);
                void loadWorks().catch((e) => setError(e.message));
              }}
            >
              重试打开内容
            </Button>
            {node && node.id !== selectedNode && <Button onClick={() => selectNode(node)}>返回仍在显示的资料</Button>}
          </div>
        )}
        {loading ? (
          <p className="creation-loading">正在打开作品…</p>
        ) : library ? <ContentLibrary world={world} works={works}/> : selectedNode && !node ? <div className="creation-empty content-entry-page" aria-busy={!error}><p role="status">{error ? '所选资料未能打开，请重试。' : '正在准备阅读内容…'}</p></div> : works.find(w => w.id === node?.work_id)?.status === 'active' &&
          node &&
          node.status === "active" &&
          effective(node) ? (
          <Suspense fallback={<p className="creation-loading">正在准备编辑器…</p>}>
            <ContentEditor
              initial={node}
              entities={entities}
              world={world}
              onSaved={saved}
              onFocusChange={setFocus}
              treeOpen={tree && !focus}
              onToggleTree={() => setTree(!tree)}
              onResetTreeWidth={() => leftPanel.setWidth(280)}
              switching={node.id !== selectedNode || node.work_id !== selectedWork}
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
            {work && <div className="work-display-heading"><DisplayImage owner="work" id={work.id} name={work.title} version={covers[work.id]} className="work-cover"/>
              <Button variant="ghost" disabled={work.status !== 'active'} onClick={() => setCoverEditing(true)}>{covers[work.id] ? '更换作品封面' : '设置作品封面'}</Button></div>}
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
            {!work && !works.some(w=>w.status==='active') && <EmptyState
              icon={<BookOpen size={24} />}
              title="正文保存与正式设定各有位置"
            >
              你可以自由修改作品；世界事实始终由你明确确认。
            </EmptyState>}
            {work&&work.status==='active'?<WorkContents world={world} nodes={nodes} loading={nodesLoading}/>:!work&&works.filter(w=>w.status==='active').length>0&&<section className="work-contents" aria-label="世界作品列表"><h2>已有作品</h2>{works.filter(w=>w.status==='active').map(w=><Link className="material-library-row" key={w.id} to={`/worlds/${world}/create?work=${w.id}`}><DisplayImage owner="work" id={w.id} name={w.title} version={covers[w.id]} className="work-entry-cover"/><div><strong>{w.title}</strong><small>{workKinds[w.kind]}</small></div><span>打开作品 →</span></Link>)}</section>}
          </div>
        )}
      </div>
      {coverEditing && work && <DisplayImageEditor owner="work" id={work.id} name={work.title} world={world} onClose={() => setCoverEditing(false)}/>}
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
          onCover={() => setCoverEditing(true)}
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
        <TypeCombobox
          value={kind}
          required
          maxLength={40}
          label="目录结构类型（可自定义）"
          suggestions={['volume', 'chapter', 'section', 'act', 'scene', 'quest', 'note']}
          onValueChange={setKind}
        />
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
  onCover,
  onClose,
  onSave,
}: {
  work: Work;
  onCover: () => void;
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
      <Button disabled={work.status !== 'active' || busy} onClick={onCover}>设置作品封面</Button>
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
          <NumberInput
            aria-label="排列顺序（从 0 开始）"
            min={0}
            disabled={node.status !== "active"}
            value={position}
            onValueChange={(value) => setPosition(Number(value))}
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
