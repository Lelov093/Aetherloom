import { type DocumentJSON } from "./api";

export interface ImportChapter {
  key: string;
  parent_key: string | null;
  title: string;
  kind: string;
  text: string;
  format: "document";
  document: DocumentJSON;
  source_file: string;
  source_files?: string[];
  source_pages?: { file_index: number; page: number }[];
  category?: string;
  tags?: string[];
}
export interface ImportPreview {
  id: string;
  blocked: boolean;
  warnings: string[];
  files: { name: string }[];
  chapters: ImportChapter[];
  ocr_pages?: ImportOcrPage[];
}
export interface ImportOcrPage {
  file_index: number;
  page: number;
  chapter_key: string;
  status: string;
  mode?: "mixed";
  text_layer?: string;
  error?: string;
  quality_warnings?: string[];
  result?: { language: string; engine: string; text: string };
}
export interface ImportPageReview {
  file_index: number;
  page: number;
  resolution: "text_layer" | "corrected";
}
export function documentText(node: DocumentJSON): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  return (node.content || [])
    .map(documentText)
    .join(
      ["paragraph", "heading", "codeBlock"].includes(node.type) ? "" : "\n",
    );
}
export function descendants(
  chapters: ImportChapter[],
  key: string,
): Set<string> {
  const result = new Set([key]),
    children = new Map<string, ImportChapter[]>();
  chapters.forEach((c) => {
    if (c.parent_key)
      children.set(c.parent_key, [...(children.get(c.parent_key) || []), c]);
  });
  const queue = [key];
  while (queue.length) {
    for (const child of children.get(queue.pop()!) || []) {
      if (!result.has(child.key)) {
        result.add(child.key);
        queue.push(child.key);
      }
    }
  }
  return result;
}
export function flatten(chapters: ImportChapter[]): ImportChapter[] {
  const children = new Map<string | null, ImportChapter[]>();
  chapters.forEach((c) =>
    children.set(c.parent_key, [...(children.get(c.parent_key) || []), c]),
  );
  const pending = [...(children.get(null) || [])].reverse(),
    ordered: ImportChapter[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    ordered.push(current);
    pending.push(...[...(children.get(current.key) || [])].reverse());
  }
  return ordered;
}
export function moveChapter(
  chapters: ImportChapter[],
  key: string,
  direction: number,
): ImportChapter[] {
  const current = chapters.find((c) => c.key === key)!;
  const siblings = chapters.filter((c) => c.parent_key === current.parent_key),
    index = siblings.findIndex((c) => c.key === key),
    other = siblings[index + direction];
  if (!other) return chapters;
  const a = chapters.findIndex((c) => c.key === key),
    b = chapters.findIndex((c) => c.key === other.key),
    copy = [...chapters];
  [copy[a], copy[b]] = [copy[b], copy[a]];
  return flatten(copy);
}
export function reparent(
  chapters: ImportChapter[],
  key: string,
  parent: string | null,
): ImportChapter[] {
  if (parent && descendants(chapters, key).has(parent)) return chapters;
  const moved = chapters.find((c) => c.key === key)!;
  return flatten([
    ...chapters.filter((c) => c.key !== key),
    { ...moved, parent_key: parent },
  ]);
}
