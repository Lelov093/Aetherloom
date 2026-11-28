import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { Link, useBlocker, useNavigate, useSearchParams } from "react-router-dom";
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
import { ObjectFromSourceDialog, type CreatedSourceObject, type SelectedSource } from './ObjectFromSourceDialog';
import { sourceSelection } from './sourceProjection';
import { manuscriptSelection, useManuscriptMenu, type ManuscriptSelection } from './useManuscriptMenu';
import { WritingInspirations } from './WritingInspirations';
import { InspirationAdoptionDialog, InspirationAdoptionList } from './InspirationAdoptions';
import { adoptionLibraryPath, adoptionSourcePath, adoptionStateLabel } from './inspirationAdoptionApi';
import { InspirationAnchor, useInspirationAnchor } from './useInspirationAnchor';
import { ChapterNarrative } from './Narrative';
import { PassageEditor } from './NarrativeEditors';
import { ObjectBrowser } from "../objects/ObjectBrowser";
import { ReadingSettings, useWritingFont, useReadingLayout } from './WritingFont';
import { materialCategories } from './MaterialClassification';
import { useReadingPosition } from './useReadingPosition';
import { PanelResize, useCreatePanel } from './CreatePanel';
import { type ObjectRef } from "../objects/api";
import {
  creationApi,
  emptyDocument,
  isWritingNode,
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
  archivedReading = false,
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
  archivedReading?: boolean;
}) {
  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const reading = archivedReading || params.get('mode') === 'read';
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
  const requestedContext = params.get('context');
  useEffect(() => {
    if (requestedContext === 'inspirations') {
      setTab('inspirations');
      setContext(true);
    }
  }, [requestedContext, setContext]);
  const [selection, setSelection] = useState({ from: 0, to: 0, text: "" }),
    [picker, setPicker] = useState<{ kind: 'entity' | 'content'; from: number; to: number; doc: ManuscriptSelection['doc'] } | null>(null);
  const [readingSelection, setReadingSelection] = useState<typeof selection>();
  const [sourceSelectionDraft, setSourceSelectionDraft] = useState<SelectedSource>();
  const [narrativeSelection, setNarrativeSelection] = useState<SelectedSource>();
  const [adoptionSelection, setAdoptionSelection] = useState<SelectedSource>();
  const [narrativeRefresh, setNarrativeRefresh] = useState(0);
  const [createdSourceObject, setCreatedSourceObject] = useState<CreatedSourceObject>();
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
      InspirationAnchor,
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
  const menu = useManuscriptMenu(editor, `${initial.id}:${reading}`, !archivedReading && !switching);
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
    setReadingSelection(undefined);
    setSourceSelectionDraft(undefined);
    setNarrativeSelection(undefined);
    setAdoptionSelection(undefined);
    setCreatedSourceObject(undefined);
    inspectEntity(undefined);
    setHistory(null); setRevision(undefined); setPicker(null);
    setDirty(false); setError(''); setState('已保存');
    setTab('inspector');
  }, [editor, initial.id]);
  useEffect(() => {
    if (!editor || !reading || archivedReading) return;
    function syncReadingSelection() {
      const selected = manuscriptSelection(editor);
      setReadingSelection(selected && { from: selected.from, to: selected.to, text: selected.text });
    }
    document.addEventListener('selectionchange', syncReadingSelection);
    return () => {
      document.removeEventListener('selectionchange', syncReadingSelection);
      setReadingSelection(undefined);
    };
  }, [editor, reading, archivedReading]);
  const readingPosition = useReadingPosition(world, initial.id, reading, !!editor);
  const adoption = useInspirationAnchor(editor, world, initial, params.get('adoption'), switching, dirty, reading);
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
    if (archivedReading) return true;
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
    if (!editor || !picker) return;
    if (editor.state.doc !== picker.doc) {
      setPicker(null);
      setError('正文已变动，请重新选择要链接的原文。');
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection({ from: picker.from, to: picker.to })
      .setMark(
        picker.kind === "entity" ? "entityMention" : "contentLink",
        picker.kind === "entity" ? { entityId: picked.id } : { nodeId: picked.id },
      )
      .run();
    setPicker(null);
  }
  const selectedSource = menu.open ? menu.selection : reading ? readingSelection : selection;
  const hasSelectedSource = Boolean(selectedSource?.text.trim());
  function openReferencePicker(kind: 'entity' | 'content') {
    if (editor && selectedSource?.text.trim()) setPicker({ kind, from: selectedSource.from, to: selectedSource.to,
      doc: menu.selection?.doc ?? editor.state.doc });
  }
  function restoreEditorRange() {
    const snapshot = menu.selection;
    if (snapshot && editor?.state.doc === snapshot.doc) {
      editor.commands.setTextSelection({ from: snapshot.from, to: snapshot.to });
    }
  }
  function preserveSelectionOnMouseDown(event: React.MouseEvent) {
    if (event.button === 0 && hasSelectedSource) event.preventDefault();
  }
  async function freezeSelection(): Promise<SelectedSource | undefined> {
    if (!editor || !selectedSource?.text.trim() || archivedReading) return;
    const before = editor.state.doc;
    if (menu.selection && menu.selection.doc !== before) {
      setError('正文已变动，请重新选择要绑定的原文。');
      return;
    }
    const range = sourceSelection(before, selectedSource.from, selectedSource.to);
    if (!range || !(await persist())) return;
    const node = current.current;
    if (node.id !== initial.id || !editor.state.doc.eq(before)) {
      setError('正文已变动，请重新选择要绑定的原文。');
      return;
    }
    const text = Array.from(node.plain_text || '').slice(range.start, range.end).join('');
    if (text.trim()) return {
      node_id: node.id, source_version: node.version, title: node.title, ...range, text,
    };
  }
  async function prepareSimulation(selectionOnly = false) {
    if (selectionOnly && !hasSelectedSource) return;
    const target = new URLSearchParams({ prepare: '1', source: initial.id });
    if (isWritingNode(initial.kind)) target.set('origin', initial.id);
    if (reading) target.set('mode', 'read');
    if (hasSelectedSource) {
      const frozen = await freezeSelection();
      if (!frozen) return;
      target.set('version', String(frozen.source_version));
      target.set('start', String(frozen.start));
      target.set('end', String(frozen.end));
    } else if (!reading && !(await persist())) return;
    navigate(`/worlds/${world}/simulate?${target}`);
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
    <Button key={label} variant="ghost" aria-label={label} title={label} disabled={disabled} aria-pressed={active || undefined}
      onClick={() => { if (labelled) restoreEditorRange(); run(); }}>
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
            {!archivedReading && (
              <Button variant="ghost" className="reader-switch" aria-label={reading?'编辑资料':'阅读资料'} title={reading?'切换到编辑':'切换到阅读'} onClick={async()=>{
                if(!reading&&!(await persist()))return;
                const next=new URLSearchParams(params);if(reading)next.delete('mode');else next.set('mode','read');
                setParams(next,{replace:true});
              }}>{reading?<BookOpen size={17}/>:<PenLine size={17}/>}<span>{reading?'阅读':'编辑'}</span></Button>
            )}
          </div>
          {!reading && <div className="toolbar-group format-tools">
            {formatButtons()}
          </div>}
          <span role="status" className={`save-state ${dirty?'pending':''}`}>{switching ? '正在打开…' : reading?`${archivedReading ? '已归档 · ' : ''}v${initial.version}`:state}</span>
          {!archivedReading && isWritingNode(initial.kind) && <Button variant="ghost"
            className="prepare-from-selection" disabled={!hasSelectedSource || switching}
            title={hasSelectedSource ? '从选段准备模拟' : '在正文中选择一段文字'}
            onMouseDown={preserveSelectionOnMouseDown} onClick={() => void prepareSimulation(true)}>
            <Orbit size={16}/>从选段准备模拟
          </Button>}
          <div className="reader-tools">
            <ReadingSettings {...writingFont} {...readingLayout}/>
            <DocumentFind key={initial.id} editor={editor}/>
            <button ref={menu.trigger} type="button" className="button button--ghost editor-more-trigger"
              aria-label="更多正文操作" title="更多操作" aria-expanded={menu.toolbarOpen}
              aria-controls={menu.id} onMouseDown={menu.rememberToolbarSelection} onClick={menu.toggleToolbar}>
              <MoreHorizontal size={18}/>
            </button>
            <div ref={menu.popup} id={menu.id} popover="auto" tabIndex={-1} role="group" aria-label="正文操作"
              className="editor-more-menu" onKeyDown={menu.onKeyDown}
              onToggle={event => { if (event.newState === 'closed' && !event.currentTarget.matches(':popover-open')) menu.close(); }}
              onClick={event => { if ((event.target as HTMLElement).closest('button')) menu.close(); }}>
                {!archivedReading && <Button variant="ghost" disabled={!selectedSource?.text.trim()}
                  onClick={async () => setSourceSelectionDraft(await freezeSelection())}><Link2 size={15}/>从选段建卡</Button>}
                {!archivedReading && <Button variant="ghost" disabled={!selectedSource?.text.trim() || switching}
                  onClick={async () => setNarrativeSelection(await freezeSelection())}>从选段记录叙事</Button>}
                {!archivedReading && <Button variant="ghost" disabled={!selectedSource?.text.trim() || switching}
                  onClick={async () => setAdoptionSelection(await freezeSelection())}>将选段关联到灵感</Button>}
                {!reading && <>
                  <div className="compact-format-tools">{formatButtons(true)}</div>
                  <Button variant="ghost" disabled={!hasSelectedSource} onClick={() => openReferencePicker('entity')}><Link2 size={15}/>链接对象</Button>
                  <Button variant="ghost" disabled={!hasSelectedSource} onClick={() => openReferencePicker('content')}>内部链接</Button>
                  {editor?.isActive('entityMention')&&<Button variant="ghost" onClick={() => {
                    restoreEditorRange(); editor.chain().focus().unsetMark('entityMention').run();
                  }}>解除对象链接</Button>}
                  <Button variant="ghost" aria-label="保存正文" disabled={!dirty} onClick={()=>void persist()}><Save size={16}/>保存正文</Button>
                </>}
                <Button variant="ghost" aria-label="查看内容历史" onClick={openHistory}><HistoryIcon size={16}/>内容历史</Button>
                <Button variant="ghost" aria-label={focus?'退出专注模式':'专注模式'} onClick={()=>{setFocus(!focus);onFocusChange(!focus);}}><Maximize2 size={16}/>{focus?'退出专注':'专注模式'}</Button>
                <Button variant="ghost" onClick={()=>{onResetTreeWidth();rightPanel.setWidth(360);}}>恢复默认栏宽</Button>
                {archivedReading ? (
                  <Button variant="ghost" onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete('mode');
                    setParams(next);
                  }}>管理与恢复</Button>
                ) : (
                  <Button variant="ghost" aria-label="从此处准备模拟" onClick={() => void prepareSimulation()}><Orbit size={16}/>从此处准备模拟</Button>
                )}
            </div>
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
        {createdSourceObject && <div className="source-object-result">
          <p role="status">已创建「{createdSourceObject.object.name}」并保存出处。</p>
          <Link className="text-link" to={`/worlds/${world}/create/objects/${createdSourceObject.object.id}`}>打开卡片 →</Link>
          <Link className="text-link" to={createdSourceObject.source.to}>查看冻结出处 →</Link>
        </div>}
        {adoption.error && <ErrorNotice>{adoption.error}</ErrorNotice>}
        {adoption.row && <div className="source-object-result">
          <p role="status">{dirty ? '正文有未保存的修改。' : adoption.unavailable ? '请查看保存的原选段。'
            : adoption.row.anchor_state === 'current' ? `已定位「${adoption.row.inspiration_title}」的采用选段。`
            : adoptionStateLabel[adoption.row.anchor_state]}</p>
          <Link className="text-link" to={adoptionLibraryPath(world, adoption.row)}>在灵感库查看 →</Link>
          <Link className="text-link" to={adoptionSourcePath(world, adoption.row.id)}>查看原选段 →</Link>
        </div>}
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
        <EditorContent editor={editor} onMouseDownCapture={menu.rememberContextSelection} onContextMenu={menu.openContextMenu} />
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
              ["narrative", "叙事"],
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
              createdSourceId={createdSourceObject?.source.id}
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
          {tab === "narrative" && <ChapterNarrative key={initial.id} world={world} node={initial}
            editable={!archivedReading && !switching} refresh={narrativeRefresh} />}
          {tab === "inspirations" && <>
            <InspirationAdoptionList key={`adoptions-${initial.id}`} world={world} kind="node" id={initial.id} version={initial.version}/>
            {isWritingNode(initial.kind) ?
            <WritingInspirations key={initial.id} world={world} node={initial} editable={!archivedReading && !switching}/>
            :
            <>
              <h2>相关灵感</h2>
              <p className="context-hint">模拟观察和手工想法可以保存为灵感，并在灵感页回到原事件。</p>
              <Link className="text-link" to={`/worlds/${world}/inspirations?node=${initial.id}`}>打开相关灵感 →</Link>
            </>
            }
          </>}
        </aside>
        {!rightPanel.floating&&<PanelResize panel={rightPanel} controls="create-context"/>}
        </div>
      )}
      {picker && (
        <ObjectBrowser
          world={world}
          title={picker.kind === 'entity' ? '链接世界对象' : '链接另一篇正文'}
          types={[picker.kind]}
          excludeIds={picker.kind === 'content' ? [initial.id] : []}
          onClose={() => setPicker(null)}
          onPick={attach}
        />
      )}
      {sourceSelectionDraft && <ObjectFromSourceDialog world={world} selection={sourceSelectionDraft}
        onClose={() => setSourceSelectionDraft(undefined)} onSaved={result => {
          setCreatedSourceObject(result);
          setSourceSelectionDraft(undefined);
        }}/>}
      {adoptionSelection && <InspirationAdoptionDialog world={world} selection={adoptionSelection}
        onClose={() => setAdoptionSelection(undefined)} onSaved={id => {
          setAdoptionSelection(undefined);
          setTab('inspirations');
          setContext(false);
          const next = new URLSearchParams(params);
          next.set('adoption', id);
          setParams(next, { replace: true });
        }}/>}
      {narrativeSelection && <PassageEditor world={world} work={initial.work_id} selection={narrativeSelection}
        onClose={() => setNarrativeSelection(undefined)} onSaved={() => {
          setNarrativeSelection(undefined);
          setNarrativeRefresh(value => value + 1);
          setFocus(false);
          onFocusChange(false);
          setTab('narrative');
          setContext(true);
        }} />}
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
