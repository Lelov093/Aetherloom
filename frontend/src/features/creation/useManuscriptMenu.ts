import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Editor } from '@tiptap/core';

export interface ManuscriptSelection {
  from: number;
  to: number;
  text: string;
  range: Range;
  doc: Editor['state']['doc'];
}

interface MenuPlace {
  x: number;
  top: number;
  bottom: number;
  alignRight?: boolean;
}

interface OpenMenu {
  place: MenuPlace;
  node: string;
  selection?: ManuscriptSelection;
}

const highlight = 'manuscript-action-selection';
const margin = 8;

export function manuscriptSelection(editor: Editor | null): ManuscriptSelection | undefined {
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  const view = editor.view;
  if (!view.dom.contains(range.startContainer) || !view.dom.contains(range.endContainer)) return;
  const text = selection.toString();
  const from = view.posAtDOM(range.startContainer, range.startOffset, 1);
  const to = view.posAtDOM(range.endContainer, range.endOffset, -1);
  if (text.trim() && from < to) return { from, to, text, doc: view.state.doc, range: range.cloneRange() };
}

function selectedLine(selection: ManuscriptSelection | undefined, x: number, y: number) {
  return selection && Array.from(selection.range.getClientRects()).find(rect =>
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
}

export function useManuscriptMenu(editor: Editor | null, node: string, allowContextMenu: boolean) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const captured = useRef<ManuscriptSelection>(undefined);
  const [open, setOpen] = useState<OpenMenu>();
  const menu = open?.node === node ? open : undefined;

  useLayoutEffect(() => {
    const panel = popup.current;
    if (!menu || !panel) return;
    const { place, selection } = menu;
    if (selection && window.CSS.highlights && typeof Highlight !== 'undefined') {
      CSS.highlights.set(highlight, new Highlight(selection.range));
    }
    panel.showPopover({ source: place.alignRight ? trigger.current ?? undefined : undefined });
    const above = place.top - margin * 2;
    const below = window.innerHeight - place.bottom - margin * 2;
    panel.style.maxHeight = `${Math.max(80, Math.min(480, Math.max(above, below)))}px`;
    const { width, height } = panel.getBoundingClientRect();
    const x = place.alignRight ? place.x - width : place.x;
    const y = height > below && above > below ? place.top - height - margin : place.bottom + margin;
    panel.style.left = `${Math.max(margin, Math.min(x, window.innerWidth - width - margin))}px`;
    panel.style.top = `${Math.max(margin, Math.min(y, window.innerHeight - height - margin))}px`;
    panel.focus({ preventScroll: true });
    const onResize = () => setOpen(undefined);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      CSS.highlights?.delete(highlight);
      if (panel.matches(':popover-open')) panel.hidePopover();
    };
  }, [menu]);

  function close(restore = false) {
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover();
    setOpen(undefined);
    if (!restore || !menu) return;
    if (menu.place.alignRight) trigger.current?.focus({ preventScroll: true });
    else editor?.view.dom.focus({ preventScroll: true });
    const snapshot = menu.selection;
    if (snapshot && snapshot.doc === editor?.state.doc && snapshot.range.startContainer.isConnected &&
        snapshot.range.endContainer.isConnected) {
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(snapshot.range);
    }
  }

  function rememberToolbarSelection(event: MouseEvent) {
    if (event.button !== 0) return;
    captured.current = manuscriptSelection(editor);
    if (captured.current) event.preventDefault();
  }

  function toggleToolbar(event: MouseEvent<HTMLButtonElement>) {
    const selection = manuscriptSelection(editor) ?? (event.detail ? captured.current : undefined);
    captured.current = undefined;
    if (menu?.place.alignRight && popup.current?.matches(':popover-open')) {
      close(true);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setOpen({ node, selection, place: { x: rect.right, top: rect.top, bottom: rect.bottom, alignRight: true } });
  }

  function rememberContextSelection(event: MouseEvent) {
    if (event.button !== 2 || !allowContextMenu) return;
    const selection = manuscriptSelection(editor) ?? menu?.selection;
    captured.current = selectedLine(selection, event.clientX, event.clientY) ? selection : undefined;
    if (captured.current) event.preventDefault();
  }

  function openContextMenu(event: MouseEvent) {
    if (!allowContextMenu) return;
    const selection = captured.current ?? manuscriptSelection(editor);
    captured.current = undefined;
    const line = selectedLine(selection, event.clientX, event.clientY);
    if (!selection || !line || selection.doc !== editor?.state.doc) return;
    event.preventDefault();
    setOpen({ node, selection, place: { x: event.clientX, top: line.top, bottom: line.bottom } });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  }

  return { id, trigger, popup, open: Boolean(menu), toolbarOpen: Boolean(menu?.place.alignRight),
    selection: menu?.selection, close, onKeyDown, rememberToolbarSelection, toggleToolbar,
    rememberContextSelection, openContextMenu };
}
