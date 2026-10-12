import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "../../components/ui";
import { type DocumentJSON } from "./api";

export function ImportContentEditor({
  document,
  onChange,
  onSplit,
}: {
  document: DocumentJSON;
  onChange: (value: DocumentJSON) => void;
  onSplit: (before: DocumentJSON, after: DocumentJSON) => void;
}) {
  const [block, setBlock] = useState(0);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: document,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "导入正文编辑器",
        "aria-multiline": "true",
        class: "import-writing-document",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON() as DocumentJSON),
    onSelectionUpdate: ({ editor }) =>
      setBlock(editor.state.selection.$from.index(0)),
  });
  useEffect(() => {
    if (
      editor &&
      !editor.isDestroyed &&
      JSON.stringify(document) !== JSON.stringify(editor.getJSON())
    ) {
      editor.commands.setContent(document, { emitUpdate: false });
      setBlock(editor.state.selection.$from.index(0));
    }
  }, [document, editor]);
  return (
    <section className="import-rich-editor">
      <div
        className="import-editor-toolbar"
        role="toolbar"
        aria-label="导入正文格式"
      >
        {["bold", "italic", "underline"].map((mark, i) => (
          <Button
            key={mark}
            type="button"
            variant="ghost"
            aria-label={["加粗", "斜体", "下划线"][i]}
            aria-pressed={editor?.isActive(mark)}
            onClick={() => editor?.chain().focus().toggleMark(mark).run()}
          >
            {["B", "I", "U"][i]}
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          列表
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          编号
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!editor?.can().undo()}
        >
          撤销
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!editor?.can().redo()}
        >
          重做
        </Button>
        <Button
          type="button"
          disabled={!editor || block === 0}
          onClick={() => {
            if (!editor || !block || block >= editor.state.doc.childCount)
              return;
            let position = 0;
            for (let i = 0; i < block; i++)
              position += editor.state.doc.child(i).nodeSize;
            const before = {
                type: "doc",
                content: editor.state.doc.content.cut(0, position).toJSON(),
              },
              after = {
                type: "doc",
                content: editor.state.doc.content.cut(position).toJSON(),
              };
            onSplit(before, after);
          }}
        >
          从此段落另起一篇
        </Button>
      </div>
      <EditorContent editor={editor} />
      <p className="context-hint">
        可以直接修正文与格式；拆分以当前顶层段落、列表或引用块为边界，原始附件保持不变。
      </p>
    </section>
  );
}
