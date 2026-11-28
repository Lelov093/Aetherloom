export type Status = 'active' | 'archived' | 'deleted';
export interface Work { id: string; world_id: string; title: string; kind: string; status: Status; version: number }
export interface DocumentJSON { type: string; content?: DocumentJSON[]; text?: string; attrs?: Record<string, unknown>; marks?: {type: string; attrs?: Record<string, unknown>}[] }
export interface ContentNode { id: string; work_id: string; parent_id: string | null; title: string; kind: string; position: number; status: Status; version: number; metadata: Record<string, string>; document?: DocumentJSON; plain_text?:string; updated_at: string }
export interface Entity { id: string; world_id: string; name: string; kind: string; status: Status; version: number; aliases: string[]; sections: {title: string; body: string; id?: string}[]; core:Record<string,string>;custom_type:string;merged_into:string|null; facts?: Fact[]; appearances?: {id:string; title:string; work_id:string; quote:string; status:Status;version:number;start:number;end:number}[] }
export interface Fact { id: string; predicate: string; value: string; object_id: string | null; valid_from: string | null; valid_until: string | null; source_note: string; status?:string; sources?:string[];version:number;field_id?:string|null;value_type?:string;typed_value?:string|number|boolean|string[]|null;from_event_id?:string;to_event_id?:string }
export type EntityDraft = Pick<Entity,'name'|'kind'>;
export type FactWrite = Pick<Fact,'predicate'|'value'|'object_id'|'valid_from'|'valid_until'|'source_note'|'field_id'|'typed_value'>
  & { version?: number; new_object?: EntityDraft & Pick<Entity,'sections'> };
export interface FieldDefinition {key:string;label:string;value_type:'text'|'number'|'boolean'|'entity'|'tags';kinds:string[];aliases:string[]}
export interface ObjectSchema {core:Record<string,Record<string,string>>;fields:FieldDefinition[]}
export interface CanonHistory {version:number;saved_at:string;payload:Record<string,unknown>}
export interface MergeRequest {target_id:string;source_version:number;target_version:number;expected_revision:number;keep_differences:boolean}
export interface MergePreview {source:Entity;target:Entity;revision:number;counts:Record<string,number>;differences:{kind:string;field:string;current:string;incoming:string}[];notes:string[]}
export interface History {node_id: string; version: number; title: string; saved_at: string; document?: DocumentJSON; metadata?: Record<string,string>}
export type LibraryItem = ContentNode & {work_title:string;excerpt:string};
export interface LibraryPage {items:LibraryItem[];total:number;offset:number;limit:number}
export interface ContentSummary {counts:Record<string,number>;works:{id:string;title:string;kind:string;content_count:number}[];recent:LibraryItem[]}
export interface InspirationEvent {world_id:string;worldline_id?:string;seq?:number;event_id?:string;baseline_id?:string|null;canon_revision?:number;logical_tick?:number;accepted?:boolean;action_type?:string;summary?:string;route?:string;actor_id?:string;actor_name?:string;location_id?:string;location_name?:string}
export interface InspirationMaterial {title:string;work_title:string;version:number;purpose:string;route:string}
export interface InspirationSource extends InspirationEvent {event_count?:number;events?:InspirationEvent[];materials?:InspirationMaterial[]}
export interface WritingLocation { id:string; kind:string; title:string; path:string; work_id:string; work_title:string; status:Status }
export const isWritingNode = (kind: string) => ['chapter', 'act', 'scene'].includes(kind);
export interface Inspiration {id:string;world_id:string;title:string;note:string;tags:string[];origin:'manual'|'simulation';source:InspirationSource;linked_node_ids:string[];linked_entity_ids:string[];linked_nodes:{id:string;title:string;work_id:string;work_title:string;version:number;status:string}[];linked_entities:{id:string;name:string;kind:string;version:number;status:string}[];origin_node_id:string|null;origin_node:WritingLocation|null;assigned_node_ids:string[];assigned_nodes:WritingLocation[];status:'active'|'archived';version:number;created_at:string;updated_at:string}
type InspirationFacet = { value: string; label: string; count: number };
export interface InspirationPage { items: Inspiration[]; total: number; offset: number; limit: number; facets: Record<'worldlines'|'characters'|'locations'|'tags', InspirationFacet[]> }
export interface WritingInspirationPage { items: Inspiration[]; total: number; offset: number; limit: number; location: WritingLocation; scope_node_ids: string[] }
export type InspirationVersion = Pick<Inspiration, 'version'|'title'|'status'|'updated_at'>;
export const workKinds: Record<string,string> = {novel:'小说',script:'剧本',game:'游戏叙事',side_story:'外传',lore:'设定文档',other:'其他'};
export const entityKinds: Record<string,string> = {character:'人物',location:'地点',faction:'组织 / 阵营',item:'物品',species:'种族',concept:'概念',world_rule:'世界规则',custom:'自定义'};
export const emptyDocument: DocumentJSON = {type:'doc',content:[{type:'paragraph'}]};

const defaultSections: Record<string, string[]> = {
  character: ['概述', '性格', '背景', '目标'],
  location: ['概述', '环境', '历史'],
  world_rule: ['规则说明', '适用范围'],
};

export function entityDraftData(draft: EntityDraft) {
  const titles = defaultSections[draft.kind] ?? ['概述', '背景'];
  return { ...draft, sections: titles.map(title => ({ title, body: '' })) };
}

export class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${url}`, {...init, headers: {...(init?.body instanceof FormData ? {} : {'Content-Type':'application/json'}), ...init?.headers}}); }
  catch { throw new Error('无法连接本地服务。未保存的修改仍保留在当前页面，请重试。'); }
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new RequestError(typeof data.detail === 'string' ? data.detail : '资料格式不正确，请检查后重试。', response.status); }
  return response.json();
}
const write = (method:string, body:unknown) => ({method,body:JSON.stringify(body)});
export const creationApi = {
  contentSummary: (world:string) => request<ContentSummary>(`/worlds/${world}/content-summary`),
  contentLibrary: (world:string,params:URLSearchParams) => request<LibraryPage>(`/worlds/${world}/content-library?${params}`),
  works: (world:string) => request<Work[]>(`/worlds/${world}/works`),
  createWork: (world:string, title:string, kind:string) => request<Work>(`/worlds/${world}/works`,write('POST',{title,kind})),
  updateWork: (work:Work, data:Partial<Work>) => request<Work>(`/works/${work.id}`,write('PATCH',{...data,version:work.version})),
  nodes: (work:string) => request<ContentNode[]>(`/works/${work}/nodes`),
  searchContent: (work:string,q:string,status:Status,offset=0,category='',tag='') => request<{items:(ContentNode & {excerpt:string})[];total:number;offset:number;limit:number}>(`/works/${work}/content-search?${new URLSearchParams({q,status,offset:String(offset),...(category?{category}:{}),tag})}`),
  node: (id:string) => request<ContentNode>(`/nodes/${id}`),
  createNode: (work:string, title:string, kind:string, parent_id:string|null,metadata:Record<string,string>={}) => request<ContentNode>(`/works/${work}/nodes`,write('POST',{title,kind,parent_id,metadata})),
  updateNode: (node:ContentNode, data:Partial<ContentNode>) => request<ContentNode>(`/nodes/${node.id}`,write('PATCH',{...data,version:node.version})),
  history: (id:string) => request<History[]>(`/nodes/${id}/history`),
  revision: (id:string, version:number) => request<History>(`/nodes/${id}/history/${version}`),
  entities: (world:string) => request<Entity[]>(`/worlds/${world}/entities`),
  entity: (id:string) => request<Entity>(`/entities/${id}`),
  createEntity: (world:string, data:Partial<Entity>) => request<Entity>(`/worlds/${world}/entities`,write('POST',data)),
  updateEntity: (entity:Entity, data:Partial<Entity>) => { const {name,kind,aliases,sections,status,version,core,custom_type}={...entity,...data}; return request<Entity>(`/entities/${entity.id}`,write('PATCH',{name,kind,aliases,sections,status,version,core,custom_type})); },
  fact: (entity:string, data:FactWrite) => request<Fact>(`/entities/${entity}/facts`,write('POST',data)),
  editFact:(id:string,data:FactWrite)=>request<Fact>(`/facts/${id}`,write('PATCH',data)),
  schema:(world:string)=>request<ObjectSchema>(`/worlds/${world}/object-schema`),
  defineField:(world:string,data:FieldDefinition)=>request<FieldDefinition>(`/worlds/${world}/object-schema/fields`,write('POST',data)),
  canonHistory:(kind:string,id:string)=>request<CanonHistory[]>(`/canon/${kind}/${id}/history`),
  canonStatus:<T=unknown>(kind:string,id:string,version:number,status:string)=>request<T>(`/canon/${kind}/${id}/status`,write('PATCH',{version,status})),
  mergePreview:(id:string,data:MergeRequest)=>request<MergePreview>(`/entities/${id}/merge-preview`,write('POST',data)),
  merge:(id:string,data:MergeRequest)=>request<MergePreview>(`/entities/${id}/merge`,write('POST',data)),
  search: (world:string, q:string) => request<{nodes:(ContentNode & {excerpt:string})[];entities:Entity[]}>(`/worlds/${world}/search?q=${encodeURIComponent(q)}`),
  inspirations: (world:string, params:URLSearchParams = new URLSearchParams()) => request<InspirationPage>(`/worlds/${world}/inspirations?${params}`),
  inspiration: (id:string) => request<Inspiration>(`/inspirations/${id}`),
  inspirationHistory: (world:string, id:string) => request<InspirationVersion[]>(`/worlds/${world}/inspirations/${id}/history`),
  inspirationVersion: (world:string, id:string, version:number) => request<Inspiration>(`/worlds/${world}/inspirations/${id}/history?version=${version}`),
  writingInspirations: (world:string, node:string, offset=0) => request<WritingInspirationPage>(`/worlds/${world}/writing-inspirations/${node}?offset=${offset}`),
  createInspiration: (world:string, data:{title:string;note:string;tags?:string[];linked_nodes?:string[];linked_entities?:string[];origin_node_id?:string}) => request<Inspiration>(`/worlds/${world}/inspirations`,write('POST',data)),
  updateInspiration: (item:Inspiration, data:Partial<Pick<Inspiration,'title'|'note'|'tags'|'status'|'linked_node_ids'|'linked_entity_ids'|'assigned_node_ids'>>) => request<Inspiration>(`/inspirations/${item.id}`,write('PATCH',{version:item.version,title:data.title,note:data.note,tags:data.tags,status:data.status,linked_nodes:data.linked_node_ids,linked_entities:data.linked_entity_ids,assigned_nodes:data.assigned_node_ids})),
};
