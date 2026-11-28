import { request } from './api';

export const passageUses = {
  mention: '提及',
  hint: '暗示',
  reveal: '揭示',
  recall: '回忆',
  payoff: '线索回收',
} as const;
export const clueStatuses = {
  unresolved: '未回收',
  resolved: '已回收',
  intentional_blank: '有意留白',
} as const;
export type PassageUse = keyof typeof passageUses;
export type ClueStatus = keyof typeof clueStatuses;

export interface NarrativePassage {
  id: string;
  node_id: string;
  work_id: string;
  work_title: string;
  title_path: string;
  source_version: number;
  current_version: number;
  source_archived: boolean;
  use_kind: PassageUse;
  note: string;
  version: number;
  linked_event_id: string | null;
  event_title: string | null;
  event_status: string | null;
  clue_id: string | null;
  clue_title: string | null;
  clue_status: ClueStatus | null;
}

export interface NarrativeClue {
  id: string;
  title: string;
  version: number;
  status: ClueStatus;
  event_id: string | null;
  event_title: string | null;
  event_status: string | null;
}

export interface WorkNarrativeData {
  passages: NarrativePassage[];
  clues: NarrativeClue[];
}

type NewPassage = {
  request_id: string; node_id: string; source_version: number; start: number; end: number;
  use_kind: PassageUse; note: string;
} & ({ event_id: string } | { clue_id: string } | { clue_title: string });

const write = (method: 'POST' | 'PATCH', body: object) => ({ method, body: JSON.stringify(body) });
export const narrativeApi = {
  add: (world: string, body: NewPassage) =>
    request<{ id: string }>(`/worlds/${world}/narrative-passages`, write('POST', body)),
  edit: (row: NarrativePassage, use_kind: PassageUse, note: string, status: 'active' | 'removed' = 'active') =>
    request<{ id: string }>(`/narrative-passages/${row.id}`, write('PATCH', { version: row.version, use_kind, note, status })),
  editClue: (clue: NarrativeClue, changes: Pick<NarrativeClue, 'title' | 'status' | 'event_id'>) =>
    request<{ id: string }>(`/narrative-clues/${clue.id}`, write('PATCH', { version: clue.version, ...changes })),
};

export function workNarrativePath(world: string, work: string) {
  return `/worlds/${world}/create?${new URLSearchParams({ work, view: 'narrative' })}`;
}

export function narrativeEventPath(world: string, id: string, status: string | null) {
  if (status !== 'active') return `/worlds/${world}/create/records?event=${encodeURIComponent(id)}`;
  const focus = `event:${id}`;
  return `/worlds/${world}/explore?${new URLSearchParams({ view: 'timeline', focus, record: focus })}`;
}
