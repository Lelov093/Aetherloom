import { useEffect, useRef, useState } from "react";
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Button } from "../../components/ui";
import { Search } from 'lucide-react';

interface SearchState {
  query: string;
  matches: { from: number; to: number }[];
  decorations: DecorationSet;
}
export const documentSearchKey = new PluginKey<SearchState>("documentSearch");
function find(doc: ProseMirrorNode, query: string): SearchState {
  const matches: SearchState["matches"] = [];
  if (query) {
    const expression = new RegExp(
      query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "gi",
    );
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      const text = node.textBetween(0, node.content.size, "\n", "\uFFFC");
      for (const match of text.matchAll(expression))
        matches.push({
          from: pos + 1 + match.index,
          to: pos + 1 + match.index + match[0].length,
        });
      return false;
    });
  }
  return {
    query,
    matches,
    decorations: DecorationSet.create(
      doc,
      matches.map((m) =>
        Decoration.inline(m.from, m.to, { class: "document-search-match" }),
      ),
    ),
  };
}
export const DocumentSearch = Extension.create({
  name: "documentSearch",
  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: documentSearchKey,
        state: {
          init: (_, state) => find(state.doc, ""),
          apply: (tr, previous) => {
            const query = tr.getMeta(documentSearchKey) as string | undefined;
            return tr.docChanged || query !== undefined
              ? find(tr.doc, query ?? previous.query)
              : previous;
          },
        },
        props: {
          decorations: (state) =>
            documentSearchKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});

export function DocumentFind({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [count, setCount] = useState(0),
    [index, setIndex] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editor) return;
    const update = () =>
      setCount(documentSearchKey.getState(editor.state)?.matches.length || 0);
    const keys = (event: KeyboardEvent) => {
      if (
        !editor.isDestroyed &&
        editor.view.dom.contains(event.target as Node) &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        setOpen(true);
        input.current?.focus();
      }
    };
    editor.on("transaction", update);
    window.addEventListener("keydown", keys);
    return () => {
      editor.off("transaction", update);
      window.removeEventListener("keydown", keys);
    };
  }, [editor]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(
        editor.state.tr.setMeta(documentSearchKey, open ? query : ""),
      );
      setIndex(-1);
    }
    if (open) input.current?.focus();
  }, [editor, query, open]);
  function jump(delta: number) {
    if (!editor) return;
    const matches = documentSearchKey.getState(editor.state)?.matches || [];
    if (!matches.length) return;
    const next = (index + delta + matches.length) % matches.length,
      m = matches[next];
    setIndex(next);
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, m.from, m.to))
        .scrollIntoView(),
    );
  }
  return (
    <div className={`document-find ${open ? 'is-open' : ''}`}>
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-label="查找正文"
        title="查找正文 · Ctrl+F"
        onClick={() => setOpen(!open)}
      >
        <Search size={16}/>
      </Button>
      {open && (
        <>
          <input
            ref={input}
            aria-label="查找当前正文"
            value={query}
            maxLength={200}
            placeholder="查找文字…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                jump(e.shiftKey ? -1 : 1);
              }
              if (e.key === "Escape") {
                setOpen(false);
                editor?.commands.focus();
              }
            }}
          />
          <span role="status">
            {index >= 0 ? `${index + 1} / ` : ""}
            {count} 处
          </span>
          <Button
            variant="ghost"
            disabled={!count}
            onClick={() => jump(index < 0 ? 0 : -1)}
          >
            上一处
          </Button>
          <Button variant="ghost" disabled={!count} onClick={() => jump(1)}>
            下一处
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            关闭查找
          </Button>
        </>
      )}
    </div>
  );
}
