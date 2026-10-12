import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
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
} from "lucide-react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { EntityMention, ContentLink } from "./DocumentMarks";
import { DocumentSearch, DocumentFind } from "./DocumentSearch";
import { ExtractionPanel } from "../review/ExtractionPanel";
import { EntityContext } from "./EntityContext";
import { DocumentContext } from "./DocumentContext";
import { ContentReferences } from "./ContentReferences";
import { DocumentMaterials } from './MaterialSources';
import { sourceSelection } from './sourceProjection';
import { ObjectBrowser } from "../objects/ObjectBrowser";
import { WritingFont, useWritingFont } from './WritingFont';
import { materialCategories, materialTags } from './MaterialClassification';
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
}: {
  initial: ContentNode;
  entities: Entity[];
  world: string;
  onSaved: (node: ContentNode) => void;
  onFocusChange: (focus: boolean) => void;
  directory?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const [params,setParams] = useSearchParams();
  const reading = params.get('mode') === 'read';
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const writingFont = useWritingFont();
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
  const [focus, setFocus] = useState(false),
    [context, setContext] = useState(
      () => window.matchMedia("(min-width: 1100px)").matches,
    ),
    [tab, setTab] = useState("inspector");
  const [selection, setSelection] = useState({ from: 0, to: 0, text: "" }),
    [picker, setPicker] = useState<"entity" | "content" | null>(null);
  const [inspected, setInspected] = useState<Entity>(),
    [history, setHistory] = useState<History[] | null>(null),
    [revision, setRevision] = useState<History>();
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
        "aria-label": "正文编辑器",
        role: "textbox",
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
          setInspected(entities.find((e) => e.id === entityId));
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
          setInspected(entities.find((e) => e.id === id));
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
  useEffect(()=>{
    editor?.setEditable(!reading, false);
    editor?.setOptions({editorProps:{...editor.options.editorProps,attributes:{class:'writing-document',role:reading?'document':'textbox',
      'aria-label':reading?'资料阅读内容':'正文编辑器','aria-readonly':String(reading),'aria-multiline':'true'}}});
    if(reading&&tab==='ai')setTab('inspector');
  },[editor,reading]);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1100px)");
    const update = () => {
      if (!mq.matches) setContext(false);
    };
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
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
  return (
    <div
      className={`editor-layout ${!context || focus ? "without-context" : ""}`}
      style={{ '--reader-font': writingFont.family } as React.CSSProperties}
    >
      <section className="editor-primary">
        <div className="writing-toolbar" role="toolbar" aria-label={reading?'资料阅读显示':'正文格式'}>
          <Button onClick={async()=>{if(!reading&&!(await persist()))return;navigate(`/worlds/${world}/simulate?setup=new&source=${initial.id}`)}}>从此处准备模拟</Button>
          <WritingFont {...writingFont} />
          <Button variant={reading?'secondary':'ghost'} onClick={async()=>{
            if(!reading&&!(await persist()))return;
            const next=new URLSearchParams(params);if(reading)next.delete('mode');else next.set('mode','read');
            setParams(next,{replace:true});
          }}>{reading?'编辑资料':'阅读资料'}</Button>
          {!reading && <>
          <Button
            variant="ghost"
            aria-label="加粗"
            aria-pressed={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label="斜体"
            aria-pressed={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={16} />
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            标题
          </Button>
          <Button
            variant="ghost"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            列表
          </Button>
          <Button
            variant="ghost"
            aria-label="撤销"
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label="重做"
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={16} />
          </Button>
          <span className="toolbar-divider" />
          <Button
            variant="ghost"
            disabled={!selection.text}
            onClick={() => {
              setPicker("entity");
            }}
          >
            <Link2 size={15} />
            链接对象
          </Button>
          <Button
            variant="ghost"
            disabled={!selection.text}
            onClick={() => {
              setPicker("content");
            }}
          >
            内部链接
          </Button>
          {editor?.isActive("entityMention") && (
            <Button
              variant="ghost"
              onClick={() =>
                editor.chain().focus().unsetMark("entityMention").run()
              }
            >
              解除对象链接
            </Button>
          )}
          </>}
        </div>
        <DocumentFind editor={editor} />
        <header className="editor-heading">
          <img
            className="editor-heading-art"
            src="/art/harbor-light.webp"
            alt=""
            aria-hidden="true"
          />
          <div>
            <span className="eyebrow">
              {(
                {
                  chapter: "章节",
                  scene: "场景",
                  section: "小节",
                  volume: "卷",
                  note: "笔记",
                } as Record<string, string>
              )[initial.kind] || initial.kind}{" "}
              · WORKING CONTENT
            </span>
            <h1>{initial.title}</h1>
            <p>
              {[boundName('pov'), boundName('location'), metadata.story_time]
                .filter(Boolean)
                .join(" · ") || "视角、地点与故事时间尚未指定"}
            </p>
            <p>{materialCategories[metadata.material_category||'unclassified']}{materialTags(metadata).length>0&&` · ${materialTags(metadata).join(' · ')}`}</p>
          </div>
          <div className="editor-heading-actions">
            <span
              role="status"
              className={`save-state ${dirty ? "pending" : ""}`}
            >
              {reading ? `阅读模式 · v${initial.version}` : state}
            </span>
            <Button
              variant="ghost"
              aria-label="保存正文"
              onClick={() => void persist()}
              disabled={reading || !dirty}
            >
              <Save size={16} />
            </Button>
            <Button
              variant="ghost"
              aria-label="查看内容历史"
              onClick={openHistory}
            >
              <HistoryIcon size={17} />
            </Button>
            <Button
              variant="ghost"
              aria-label={focus ? "退出专注模式" : "专注模式"}
              onClick={() => {
                setFocus(!focus);
                onFocusChange(!focus);
              }}
            >
              <Maximize2 size={17} />
            </Button>
            <Button
              variant="ghost"
              aria-label={context ? "收起上下文" : "打开上下文"}
              onClick={() => setContext(!context)}
            >
              <PanelRightClose size={17} />
            </Button>
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
        <aside className="editor-context" aria-label="正文上下文">
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
              ["ai", "AI 辅助"],
            ].filter(([id])=>!reading||id!=='ai').map(([id, label]) => (
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
                onBack={() => setInspected(undefined)}
              />
            ) : (
              <DocumentContext
                title={initial.title}
                metadata={metadata}
                references={references}
                entities={entities}
                world={world}
                busy={metadataBusy}
                onChange={changeMetadata}
                onSave={() => void saveMetadata()}
                onInspect={setInspected}
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
                setInspected(entity);
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
          {tab === "ai" && (
            <ExtractionPanel
              world={world}
              nodeId={initial.id}
              selection={selection.text}
              prepare={persist}
            />
          )}
        </aside>
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
