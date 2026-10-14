import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bold,
  Italic,
  Undo2,
  Redo2,
  Maximize2,
  History as HistoryIcon,
  Link2,
  PanelRightClose,
  Save,
  BookOpen,
  PenLine,
  Orbit,
  Underline,
  Heading2,
  List,
  MoreHorizontal,
  PanelLeftClose,
  UserRound,
  MapPin,
  Clock3,
} from "lucide-react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { EntityMention, ContentLink } from "./DocumentMarks";
import { DocumentSearch, DocumentFind } from "./DocumentSearch";
import { EntityContext } from "./EntityContext";
import { DocumentContext } from "./DocumentContext";
import { ContentReferences } from "./ContentReferences";
import { DocumentMaterials } from './MaterialSources';
import { sourceSelection } from './sourceProjection';
import { ObjectBrowser } from "../objects/ObjectBrowser";
import { ReadingSettings, useWritingFont, useReadingLayout } from './WritingFont';
import { materialCategories } from './MaterialClassification';
import { useReadingPosition } from './useReadingPosition';
import { PanelResize, useCreatePanel } from './CreatePanel';
import { type ObjectRef } from "../objects/api";
import {
  creationApi,
  emptyDocument,
  type ContentNode,
  type Entity,
  type History,
  type DocumentJSON,
} from "./api";

export function ContentEditor({
  initial,
  entities,
  world,
  onSaved,
  onFocusChange,
  directory,
  treeOpen,
  onToggleTree,
  onResetTreeWidth,
  switching = false,
}: {
  initial: ContentNode;
  entities: Entity[];
  world: string;
  onSaved: (node: ContentNode) => void;
  onFocusChange: (focus: boolean) => void;
  directory?: React.ReactNode;
  treeOpen: boolean;
  onToggleTree: () => void;
  onResetTreeWidth: () => void;
  switching?: boolean;
}) {
  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const reading = params.get('mode') === 'read';
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const writingFont = useWritingFont();
  const readingLayout = useReadingLayout();
  const current = useRef(initial),
    pending = useRef(initial.document || emptyDocument),
    saved = useRef(JSON.stringify(pending.current));
  const pendingMetadata = useRef(initial.metadata),
    savedMetadata = useRef(JSON.stringify(initial.metadata));
  function hasChanges() {
    return (
      JSON.stringify(pending.current) !== saved.current ||
      JSON.stringify(pendingMetadata.current) !== savedMetadata.current
    );
  }
  const running = useRef<Promise<boolean> | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dirty, setDirty] = useState(false),
    [state, setState] = useState("已保存"),
    [error, setError] = useState("");
  const rightPanel = useCreatePanel('right', 360, 1280);
  const context = rightPanel.open, setContext = rightPanel.setOpen;
  const [focus, setFocus] = useState(false),
    [tab, setTab] = useState("inspector");
  const [selection, setSelection] = useState({ from: 0, to: 0, text: "" }),
    [picker, setPicker] = useState<"entity" | "content" | null>(null);
  const [inspected, setInspected] = useState<Entity>(),
    [history, setHistory] = useState<History[] | null>(null),
    [revision, setRevision] = useState<History>();
  const [inspectionTrail, setInspectionTrail] = useState<Entity[]>([]);
  function inspectEntity(entity: Entity | undefined) {
    setInspectionTrail([]);
    setInspected(entity);
  }
  const [metadata, setMetadata] = useState(initial.metadata),
    [metadataBusy, setMetadataBusy] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      EntityMention,
      ContentLink,
      DocumentSearch,
    ],
    content: initial.document || emptyDocument,
    editable: !reading,
    editorProps: {
      attributes: {
        class: "writing-document",
        "aria-label": reading ? "资料阅读内容" : "正文编辑器",
        role: reading ? "document" : "textbox",
        "aria-readonly": String(reading),
        "aria-multiline": "true",
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement;
        const entityId = target
          .closest("[data-entity-id]")
          ?.getAttribute("data-entity-id");
        const nodeId = target
          .closest("[data-node-id]")
          ?.getAttribute("data-node-id");
        if (entityId) {
          inspectEntity(entities.find((e) => e.id === entityId));
          setContext(true);
          setTab("inspector");
          return true;
        }
        if (nodeId) {
          void creationApi
            .node(nodeId)
            .then((target) =>
              navigate(
                `/worlds/${world}/create?work=${target.work_id}&node=${nodeId}${reading?'&mode=read':''}`,
              ),
            )
            .catch((e) => setError(e.message));
          return true;
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        if (view.composing || event.isComposing || event.keyCode === 229) return false;
        if (event.key !== "Enter") return false;
        const target = event.target as HTMLElement;
        const id = target.getAttribute("data-entity-id");
        if (id) {
          inspectEntity(entities.find((e) => e.id === id));
          setContext(true);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: instance }) => {
      // View plugins may normalize the document (e.g. a trailing paragraph).
      // Displaying that projection must never save a new content version.
      if (readingRef.current || !instance.isEditable) return;
      pending.current = instance.getJSON() as DocumentJSON;
      setDirty(hasChanges());
      setState("等待保存");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(), 800);
    },
    onSelectionUpdate: ({ editor: instance }) => {
      const { from, to } = instance.state.selection;
      setSelection({
        from,
        to,
        text: instance.state.doc.textBetween(from, to, "\n"),
      });
    },
  });
  useLayoutEffect(()=>{
    editor?.setEditable(!reading && !switching, false);
  },[editor,reading,switching]);
  // Swap saved documents before paint, keeping the editor and side panels mounted.
  useLayoutEffect(() => {
    if (!editor || current.current.id === initial.id) return;
    clearTimeout(timer.current);
    current.current = initial;
    pending.current = initial.document || emptyDocument;
    saved.current = JSON.stringify(pending.current);
    pendingMetadata.current = initial.metadata;
    savedMetadata.current = JSON.stringify(initial.metadata);
    editor.commands.setContent(pending.current, { emitUpdate: false });
    // A reused view must not carry undo history or search state into another document.
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc: editor.state.doc, plugins: editor.state.plugins }));
    setMetadata(initial.metadata);
    setSelection({ from: 0, to: 0, text: '' });
    inspectEntity(undefined);
    setHistory(null); setRevision(undefined); setPicker(null);
    setDirty(false); setError(''); setState('已保存');
    setTab('inspector');
  }, [editor, initial.id]);
  const readingPosition = useReadingPosition(world, initial.id, reading, !!editor);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    if (initial.version > current.current.version) {
      current.current = initial;
      if (JSON.stringify(pendingMetadata.current) === savedMetadata.current) {
        pendingMetadata.current = initial.metadata;
        savedMetadata.current = JSON.stringify(initial.metadata);
        setMetadata(initial.metadata);
      }
    }
  }, [initial.version]);
  async function persist(): Promise<boolean> {
    clearTimeout(timer.current);
    if (running.current) {
      const ok = await running.current;
      return ok ? persist() : false;
    }
    // Composition may start before the editor has emitted its final document update.
    if (editorRef.current?.view.composing) {
      setState("输入完成后保存");
      timer.current = setTimeout(() => void persist(), 400);
      return false;
    }
    if (!hasChanges()) {
      setDirty(false);
      setState("已保存");
      return true;
    }
    const document = pending.current,
      meta = pendingMetadata.current;
    setState("正在保存…");
    setError("");
    const task = (async () => {
      try {
        const result = await creationApi.updateNode(current.current, {
          document,
          metadata: meta,
        });
        current.current = result;
        saved.current = JSON.stringify(document);
        savedMetadata.current = JSON.stringify(meta);
        onSaved(result);
        const remains = hasChanges();
        setDirty(remains);
        setState(remains ? "等待保存" : "已保存");
        return true;
      } catch (e) {
        setError((e as Error).message);
        setState("保存失败");
        return false;
      }
    })();
    running.current = task;
    const ok = await task;
    running.current = null;
    if (ok && hasChanges()) return persist();
    return ok;
  }
  const blocker = useBlocker(() => hasChanges());
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (hasChanges()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("beforeunload", before);
    };
  }, []);
  async function saveMetadata() {
    setMetadataBusy(true);
    await persist();
    setMetadataBusy(false);
  }
  function changeMetadata(value: Record<string, string>) {
    pendingMetadata.current = value;
    setMetadata(value);
    setDirty(hasChanges());
    setState("等待保存");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), 800);
  }
  async function openHistory() {
    if (!(await persist())) return;
    try {
      setHistory(await creationApi.history(initial.id));
      setRevision(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function restore() {
    if (!revision?.document) return;
    try {
      if (!(await persist())) return;
      const result = await creationApi.updateNode(current.current, {
        document: revision.document,
        metadata: revision.metadata,
      });
      current.current = result;
      pending.current = result.document!;
      saved.current = JSON.stringify(pending.current);
      editor?.commands.setContent(pending.current, { emitUpdate: false });
      pendingMetadata.current = result.metadata;
      savedMetadata.current = JSON.stringify(result.metadata);
      setMetadata(result.metadata);
      onSaved(result);
      setDirty(false);
      setState("历史内容已恢复为新版本");
      setHistory(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function attach(picked: ObjectRef) {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: selection.from, to: selection.to })
      .setMark(
        picker === "entity" ? "entityMention" : "contentLink",
        picker === "entity" ? { entityId: picked.id } : { nodeId: picked.id },
      )
      .run();
    setPicker(null);
  }
  const mentionedIds = new Set<string>();
  function collectMentions(value: DocumentJSON) {
    value.marks?.forEach((mark) => {
      if (
        mark.type === "entityMention" &&
        typeof mark.attrs?.entityId === "string"
      )
        mentionedIds.add(mark.attrs.entityId);
    });
    value.content?.forEach(collectMentions);
  }
  collectMentions(pending.current);
  const references = entities.filter((e) => mentionedIds.has(e.id));
  const boundName = (key:string) => metadata[`${key}_id`]
    ? entities.find(e=>e.id===metadata[`${key}_id`])?.name || '关联对象已收起或不可用'
    : metadata[key];
  const formatActions = [
    { label: '撤销', Icon: Undo2, disabled: !editor?.can().undo(), active: false, run: () => editor?.chain().focus().undo().run() },
    { label: '重做', Icon: Redo2, disabled: !editor?.can().redo(), active: false, run: () => editor?.chain().focus().redo().run() },
    { label: '加粗', Icon: Bold, disabled: !editor, active: editor?.isActive('bold'), run: () => editor?.chain().focus().toggleBold().run() },
    { label: '斜体', Icon: Italic, disabled: !editor, active: editor?.isActive('italic'), run: () => editor?.chain().focus().toggleItalic().run() },
    { label: '下划线', Icon: Underline, disabled: !editor, active: editor?.isActive('underline'), run: () => editor?.chain().focus().toggleUnderline().run() },
    { label: '正文标题', Icon: Heading2, disabled: !editor, active: editor?.isActive('heading', {level: 2}), run: () => editor?.chain().focus().toggleHeading({level: 2}).run() },
    { label: '项目列表', Icon: List, disabled: !editor, active: editor?.isActive('bulletList'), run: () => editor?.chain().focus().toggleBulletList().run() },
  ];
  const formatButtons = (labelled = false) => formatActions.map(({label, Icon, disabled, active, run}) =>
    <Button key={label} variant="ghost" aria-label={label} title={label} disabled={disabled} aria-pressed={active || undefined} onClick={run}>
      <Icon size={16}/>{labelled && label}
    </Button>);
  return (
    <div
      className={`editor-layout ${!context || focus ? "without-context" : ""}`}
      data-reading={reading}
      data-focus={focus}
      aria-busy={switching}
      inert={switching}
      style={{ '--reader-font': writingFont.family, '--reader-size': `${readingLayout.layout.size}px`, '--reader-spacing': readingLayout.layout.spacing, '--create-context-width': `${rightPanel.width}px` } as React.CSSProperties}
    >
      <section className="editor-primary" ref={readingPosition}>
        <div className="writing-toolbar" role="toolbar" aria-label={reading?'资料阅读显示':'正文格式'}>
          <div className="toolbar-group">
            <Button variant="ghost" aria-label={treeOpen?'收起作品目录':'打开作品目录'} aria-expanded={treeOpen} aria-controls="create-directory" title="作品目录" disabled={focus} onClick={onToggleTree}><PanelLeftClose size={17}/></Button>
            <Button variant="ghost" className="reader-switch" aria-label={reading?'编辑资料':'阅读资料'} title={reading?'切换到编辑':'切换到阅读'} onClick={async()=>{
              if(!reading&&!(await persist()))return;
              const next=new URLSearchParams(params);if(reading)next.delete('mode');else next.set('mode','read');
              setParams(next,{replace:true});
            }}>{reading?<BookOpen size={17}/>:<PenLine size={17}/>}<span>{reading?'阅读':'编辑'}</span></Button>
          </div>
          {!reading && <div className="toolbar-group format-tools">
            {formatButtons()}
          </div>}
          <span role="status" className={`save-state ${dirty?'pending':''}`}>{switching ? '正在打开…' : reading?`v${initial.version}`:state}</span>
          <div className="reader-tools">
            <ReadingSettings {...writingFont} {...readingLayout}/>
            <DocumentFind key={initial.id} editor={editor}/>
            <details className="editor-more">
              <summary aria-label="更多正文操作" title="更多操作"><MoreHorizontal size={18}/></summary>
              <div className="editor-more-menu" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.parentElement?.removeAttribute('open');}}>
                {!reading && <>
                  <div className="compact-format-tools">{formatButtons(true)}</div>
                  <Button variant="ghost" disabled={!selection.text} onClick={()=>setPicker('entity')}><Link2 size={15}/>链接对象</Button>
                  <Button variant="ghost" disabled={!selection.text} onClick={()=>setPicker('content')}>内部链接</Button>
                  {editor?.isActive('entityMention')&&<Button variant="ghost" onClick={()=>editor.chain().focus().unsetMark('entityMention').run()}>解除对象链接</Button>}
                  <Button variant="ghost" aria-label="保存正文" disabled={!dirty} onClick={()=>void persist()}><Save size={16}/>保存正文</Button>
                </>}
                <Button variant="ghost" aria-label="查看内容历史" onClick={openHistory}><HistoryIcon size={16}/>内容历史</Button>
                <Button variant="ghost" aria-label={focus?'退出专注模式':'专注模式'} onClick={()=>{setFocus(!focus);onFocusChange(!focus);}}><Maximize2 size={16}/>{focus?'退出专注':'专注模式'}</Button>
                <Button variant="ghost" onClick={()=>{onResetTreeWidth();rightPanel.setWidth(360);}}>恢复默认栏宽</Button>
                <Button variant="ghost" aria-label="从此处准备模拟" onClick={async()=>{if(!reading&&!(await persist()))return;navigate(`/worlds/${world}/simulate?setup=new&source=${initial.id}`)}}><Orbit size={16}/>从此处准备模拟</Button>
              </div>
            </details>
            <Button variant="ghost" aria-label={context?'收起上下文':'打开上下文'} aria-expanded={context&&!focus} aria-controls="create-context" disabled={focus} title="上下文" onClick={()=>setContext(!context)}><PanelRightClose size={17}/></Button>
          </div>
        </div>
        <header className="editor-heading">
          <span className="eyebrow">{materialCategories[metadata.material_category||'unclassified']}</span>
          <h1>{initial.title}</h1>
          <div className="reader-metadata">
            {boundName('pov')&&<span><UserRound size={15}/>POV · {boundName('pov')}</span>}
            {boundName('location')&&<span><MapPin size={15}/>{boundName('location')}</span>}
            {metadata.story_time&&<span><Clock3 size={15}/>{metadata.story_time}</span>}
          </div>
        </header>
        {error && (
          <div className="editor-error">
            <ErrorNotice>{error}</ErrorNotice>
            <Button onClick={() => void persist()}>
              <Save size={15} />
              重试保存
            </Button>
            <p>冲突时可复制正文保留修改，再重新载入比较。</p>
          </div>
        )}
        {directory}
        <EditorContent editor={editor} />
        <footer className="writing-footer">
          <span>{editor?.getText().replace(/\s/g, "").length || 0} 字</span>
          <span>正文保存不会自动确认世界事实</span>
        </footer>
      </section>
      {context && !focus && (
        <div className={`create-context-frame ${rightPanel.floating?'is-floating':''}`}>
        {rightPanel.floating&&<button className="create-panel-scrim" aria-label="关闭上下文浮层" onClick={()=>setContext(false)}/>}
        <aside id="create-context" className="editor-context" role={rightPanel.floating?'dialog':undefined} aria-modal={rightPanel.floating||undefined} aria-label="正文上下文">
          <header className="context-panel-heading">
            <span>上下文面板</span>
            <Button
              variant="ghost"
              aria-label="收起上下文"
              onClick={() => setContext(false)}
            >
              <PanelRightClose size={16} />
            </Button>
          </header>
          <div className="quiet-tabs" role="tablist" aria-label="上下文">
            {[
              ["inspector", "资料"],
              ["references", "关联"],
              ["inspirations", "灵感"],
            ].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "inspector" &&
            (inspected ? (
              <EntityContext
                world={world}
                entityId={inspected.id}
                entities={entities}
                backLabel={inspectionTrail.length ? `返回 ${inspectionTrail[inspectionTrail.length - 1].name}` : '文档上下文'}
                onBack={() => {
                  const previous = inspectionTrail[inspectionTrail.length - 1];
                  setInspectionTrail(trail => trail.slice(0, -1));
                  setInspected(previous);
                }}
                onInspect={entity => {
                  setInspectionTrail(trail => [...trail, inspected]);
                  setInspected(entity);
                }}
              />
            ) : (
              <DocumentContext
                title={initial.title}
                version={initial.version}
                metadata={metadata}
                references={references}
                entities={entities}
                world={world}
                busy={metadataBusy}
                onChange={changeMetadata}
                onSave={() => void saveMetadata()}
                onInspect={inspectEntity}
                readOnly={reading}
              />
            ))}
          {tab === "references" && (
            <>
            <DocumentMaterials world={world} node={initial} prepare={persist} editable={!reading}
              range={editor ? sourceSelection(editor.state.doc,selection.from,selection.to) : undefined}/>
            <ContentReferences
              nodeId={initial.id}
              version={initial.version}
              entities={references}
              onInspect={(entity) => {
                inspectEntity(entity);
                setTab("inspector");
              }}
            />
            </>
          )}
          {tab === "inspirations" && (
            <>
              <h2>相关灵感</h2>
              <p className="context-hint">模拟灵感的捕捉与关联尚未开放。</p>
            </>
          )}
        </aside>
        {!rightPanel.floating&&<PanelResize panel={rightPanel} controls="create-context"/>}
        </div>
      )}
      {picker && (
        <ObjectBrowser
          world={world}
          title={picker === "entity" ? "链接世界对象" : "链接另一篇正文"}
          types={[picker]}
          excludeIds={picker === "content" ? [initial.id] : []}
          onClose={() => setPicker(null)}
          onPick={attach}
        />
      )}
      {history && (
        <Dialog title="内容历史" onClose={() => setHistory(null)}>
          <p className="dialog-intro">恢复会形成新版本。它不会改变 Canon。</p>
          <div className="history-list">
            {history.map((h) => (
              <Button
                key={h.version}
                onClick={async () => {
                  try {
                    setRevision(
                      await creationApi.revision(initial.id, h.version),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                版本 {h.version} ·{" "}
                {new Date(h.saved_at).toLocaleString("zh-CN")}
              </Button>
            ))}
          </div>
          {revision && (
            <>
              <h3>{revision.title}</h3>
              <pre className="revision-preview">
                {revision.document ? documentText(revision.document) : ""}
              </pre>
              {!reading && <Button variant="primary" onClick={restore}>
                将此内容恢复为新版本
              </Button>}
            </>
          )}
        </Dialog>
      )}
      {blocker.state === "blocked" && (
        <Dialog title="正文还有未保存的修改" onClose={() => blocker.reset()}>
          <p className="dialog-intro">
            保存完成后再离开，确保本机资料包含刚才的修改。
          </p>
          <div className="dialog-actions">
            <Button onClick={() => blocker.reset()}>留在这里</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (await persist()) blocker.proceed();
              }}
            >
              保存并离开
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function documentText(doc: DocumentJSON): string {
  return (
    doc.text ||
    doc.content?.map(documentText).join(doc.type === "paragraph" ? "" : "\n") ||
    ""
  );
}
