import { request, type Entity } from "../creation/api";

export const fieldTypeNames: Record<string, string> = { text: "文本", number: "数字", boolean: "是或否", entity: "对象", tags: "标签" };

export type Proposal = {
  evidence?: { basis: string; quote: string } | null;
  subject_evidence?: { mention: string; basis: "literal_identity" | "coreference";
    link_quote?: string | null; link_source_block_id?: string | null } | null;
  type: "entity" | "assertion" | "event" | "relationship";
  name?: string;
  entity_kind?: string;
  aliases?: string[];
  description?: string;
  subject_ref?: string;
  object_ref?: string | null;
  predicate?: string;
  value?: string;
  field_id?: string | null;
  typed_value?: string | number | boolean | string[] | null;
  title?: string;
  participants?: string[];
  location_ref?: string | null;
  label?: string;
  valid_from?: string | null;
  valid_until?: string | null;
};
export interface Candidate {
  id: string;
  task_id: string;
  world_id: string;
  node_id: string;
  source_version: number;
  source_quote: string;
  source_spans: { start: number; end: number }[];
  kind: Proposal["type"];
  payload: Proposal;
  local_key: string;
  confidence: number;
  status: string;
  version: number;
  baseline_revision: number;
  target_type?: string;
  target_id?: string;
  edited: boolean;
  created_at: string;
  source_title?: string;
  work_title?: string;
  work_id?: string;
  source_stale?: boolean;
  priority?: "blocking" | "important" | "normal" | "low";
}
export interface Task {
  id: string;
  node_id: string;
  source_version: number;
  status: string;
  error: string;
  provider_model: string;
  usage: Record<string, number>;
  completed_chunks: number;
  total_chunks?: number;
  failure_count?: number;
  chunks?: unknown[];
}
export interface Inbox {
  revision: number;
  candidates: Candidate[];
  tasks: Task[];
}
export interface ReviewActivity {
  pending: number;
  simulation_pending: number;
  active: number;
  tasks: { id: string; node_id: string; work_id: string; title: string; work_title: string;
    status: string; updated_at: string; completed_chunks: number; total_chunks: number }[];
}
export interface ExtractionFailures {
  task_id: string;
  source_version: number;
  model: string;
  failures: {
    id: string;
    chunk_index: number;
    created_at: string;
    detail: {
      message: string;
      stage?: string;
      range?: { start: number; end: number };
      issues?: { code: string; item_key?: string; field?: string; reference?: string; message: string }[];
      source_blocks?: { id: string; text: string }[];
      known_entities?: { id: string; name: string; scope: string }[];
      allowed_references?: string[];
      raw_output?: string | null;
      parsed_output?: unknown;
      output_truncated?: boolean;
      failed_step?: string;
      stages?: { stage?: string; step?: string; raw_output?: string | null;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }[];
    };
  }[];
}
export interface CurrentRecord {
  id: string;
  object_id?: string | null;
  field_id?: string | null;
  name?: string;
  title?: string;
  description?: string;
  aliases?: string[];
  predicate?: string;
  value?: string;
  label?: string;
  valid_from?: string;
  valid_until?: string;
  source_note?: string;
  sources?: { id: string; source_quote: string; source_version: number }[];
}

export interface SimulationSource { id: string; simulation_id: string; seq: number; world_id: string; title: string }
export interface Preview {
  candidate: Candidate;
  revision: number;
  source: {
    title: string;
    work_id: string;
    work_title: string;
    version: number;
    current_version: number;
    stale: boolean;
    archived: boolean;
    quote: string;
    context: string;
    current_text: string;
    occurrence_count: number;
    contexts: string[];
  };
  current: CurrentRecord[];
  identity_matches: { scope: "canon" | "candidate"; id: string; name: string; kind: string; aliases: string[]; matched_names: string[]; same_kind: boolean }[];
  conflicts: CurrentRecord[];
  dependencies: { ref: string; candidate_id: string | null; name: string }[];
  affected_entities: Entity[];
  temporal_change: boolean;
  warnings: string[];
  requires_evidence_confirmation: boolean;
  field_mapping: { field_id: string; label: string; value_type: string | null; typed_value: Proposal["typed_value"]; value: string; error: string | null } | null;
}
export interface MergeEffect {
  candidate_id: string;
  target_id: string;
  target_name: string;
  target_kind: string;
  added_aliases: string[];
  dependent_candidate_ids: string[];
}
export interface Decision {
  candidate_id: string;
  version: number;
  action: "accept" | "reject" | "ignore" | "later" | "merge";
  target_id?: string;
  resolution?: "replace" | "temporal" | "keep_both";
  acknowledge_inference?: boolean;
}
const write = (body: unknown, method = "POST") => ({
  method,
  body: JSON.stringify(body),
});
export const reviewApi = {
  simulationSources: (kind: string, id: string) => request<SimulationSource[]>(`/simulation-targets/${kind}/${id}/sources`),
  provider: () =>
    request<{ configured: boolean; model: string; host: string; disabled:boolean }>(`/provider`),
  inbox: (world: string) => request<Inbox>(`/worlds/${world}/review`),
  activity: (world: string) => request<ReviewActivity>(`/worlds/${world}/review-activity`),
  preview: (id: string) => request<Preview>(`/review/${id}`),
  extract: (id: string, version: number, start?: number, end?: number) =>
    request<Task>(
      `/nodes/${id}/extractions`,
      write({ version, selection_start: start, selection_end: end }),
    ),
  cancel: (id: string) => request<Task>(`/extractions/${id}/cancel`, write({})),
  retry: (id: string) => request<Task>(`/extractions/${id}/retry`, write({})),
  failures: (id: string) => request<ExtractionFailures>(`/extractions/${id}/failures`),
  edit: (c: Candidate, payload: Proposal) =>
    request<Candidate>(
      `/review/${c.id}`,
      write({ version: c.version, payload }, "PATCH"),
    ),
  recheck: (c: Candidate, source_version: number, quote: string) =>
    request<Candidate>(
      `/review/${c.id}/recheck-source`,
      write({ version: c.version, source_version, quote }),
    ),
  apply: (world: string, revision: number, decisions: Decision[]) =>
    request<{ revision: number; candidates: Candidate[] }>(
      `/worlds/${world}/review/apply`,
      write({ expected_revision: revision, decisions }),
    ),
  previewApply: (world: string, revision: number, decisions: Decision[]) =>
    request<{ revision: number; candidates: Candidate[]; merge_effects: MergeEffect[] }>(
      `/worlds/${world}/review/preview-apply`,
      write({ expected_revision: revision, decisions }),
    ),
  records: (world: string, entity?: string) =>
    request<CanonRecords>(
      `/worlds/${world}/canon-records${entity ? `?entity_id=${entity}` : ""}`,
    ),
};
export interface CanonEvent {
  id: string;
  title: string;
  description: string;
  location_id: string | null;
  valid_from: string | null;
  valid_until: string | null;
  participants: string[];
  sources: string[];
  version:number;
  status:string;
  source_note:string;
  metadata:{causes?:string[];participant_roles?:Record<string,string>;before_state?:string;after_state?:string};
}
export interface RelationshipState {
  id: string;
  label: string;
  description: string;
  valid_from: string | null;
  valid_until: string | null;
  status: string;
  sources: string[];
  version:number;
  strength:number|null;
  source_note:string;
}
export interface CanonRelationship {
  id: string;
  subject_id: string;
  object_id: string;
  states: RelationshipState[];
}
export interface CanonRecords {
  events: CanonEvent[];
  relationships: CanonRelationship[];
}
export const kindNames: Record<Proposal["type"], string> = {
  entity: "世界对象",
  assertion: "世界事实",
  event: "事件",
  relationship: "时态关系",
};
export const statusNames: Record<string, string> = {
  pending: "待处理",
  later: "稍后",
  accepted: "已接受",
  merged: "已合并",
  rejected: "已拒绝",
  ignored: "已忽略",
};
export const taskNames: Record<string, string> = {
  queued: "排队中",
  running: "提取中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
export function proposalTitle(p: Proposal) {
  return p.name || p.title || p.predicate || p.label || kindNames[p.type];
}
export function proposalValue(p: Proposal) {
  return p.value || p.description || p.aliases?.join("、") || "新的世界身份";
}
