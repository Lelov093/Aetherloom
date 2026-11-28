import { useEffect, useState } from 'react';
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { ContentNode } from './api';
import { inspirationAdoptionApi, type InspirationAdoption } from './inspirationAdoptionApi';
import { sourcePositions } from './sourceProjection';

const anchorKey = new PluginKey<DecorationSet>('inspirationAnchor');
export const InspirationAnchor = Extension.create({
  name: 'inspirationAnchor',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: anchorKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, previous) {
          const range = tr.getMeta(anchorKey) as { from: number; to: number } | null | undefined;
          if (tr.docChanged || range === null) return DecorationSet.empty;
          return range ? DecorationSet.create(tr.doc, [Decoration.inline(range.from, range.to, {
            nodeName: 'mark', 'data-inspiration-anchor': '', tabIndex: '-1',
          })]) : previous;
        },
      },
      props: { decorations: state => anchorKey.getState(state) },
    })];
  },
});

export function useInspirationAnchor(editor: Editor | null, world: string, node: ContentNode,
  activeId: string | null, switching: boolean, dirty: boolean, reading: boolean) {
  const [row, setRow] = useState<InspirationAdoption>();
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const { id, version, plain_text } = node;
  useEffect(() => {
    let active = true;
    setRow(undefined);
    setError('');
    if (!activeId || switching) return;
    inspirationAdoptionApi.source(world, activeId).then(value => {
      if (!active) return;
      if (value.node_id === id) setRow(value);
      else setError('此采用记录属于另一篇正文。');
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [world, id, version, activeId, switching]);

  useEffect(() => {
    setUnavailable(false);
    if (!editor || editor.isDestroyed || !row || switching || dirty || row.id !== activeId || row.node_id !== id ||
        row.anchor_state !== 'current' || row.current_version !== version) return;
    const quote = Array.from(plain_text || '').slice(row.start, row.end).join('');
    const range = quote === row.quote && sourcePositions(editor.state.doc, row.start, row.end);
    if (!range) { setUnavailable(true); return; }
    editor.view.dispatch(editor.state.tr.setMeta(anchorKey, range));
    const frame = requestAnimationFrame(() => {
      const mark = editor.view.dom.querySelector<HTMLElement>('[data-inspiration-anchor]');
      mark?.scrollIntoView({ block: 'center' });
      if (reading) mark?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(anchorKey, null));
    };
  }, [editor, id, version, plain_text, activeId, row, switching, dirty, reading]);
  return { row: row?.id === activeId && row.node_id === id ? row : undefined, error: activeId ? error : '', unavailable };
}
