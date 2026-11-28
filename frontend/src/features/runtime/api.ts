export type Role = "creator_observer" | "observer" | "participant";
export interface ViewerLayout {
  version: 1;
  camera: { x: number; y: number; zoom: number };
  places: { id: string; x: number; y: number }[];
}
export interface HostSession {
  token: string;
  viewer_scope: string;
  role: Role;
  expires_in: number;
  actor_id?: string;
}
declare global {
  interface Window {
    aetherloomRuntime?: {
      available(): Promise<boolean>;
      experiments?(): Promise<{ godotLibrary: boolean }>;
      session(
        world: string,
        role: Role,
        worldline?: string,
        actor?: string,
        spoilerFree?: boolean,
      ): Promise<HostSession | null>;
      viewerLayout(worldline: string, value?: ViewerLayout, view?: string): Promise<ViewerLayout | null>;
    };
  }
}
export interface PerceptionRecord {
  actor_id?: string | null;
  channel?: "sight" | "sound";
  facts?: Record<string, string>;
  text?: string;
}
export interface PerceptionLayout {
  zones: Record<string, string>;
  positions: Record<string, string>;
  links: { observer: string; source: string; sight: boolean; sound: boolean }[];
}
export interface Agent {
  location: string;
  goal?: string;
  known?: Record<string, unknown>;
  beliefs?: Record<string, unknown>;
  memories?: (PerceptionRecord & { text: string; basis: string; source: unknown })[];
  committed_plans?: unknown[];
  waiting?: { until_tick: number | null };
  social?: SocialView;
}
export interface SocialView {
  own: {
    plans: {id:string;next_step:string;target_id:string|null;completion:string;abandon:string;status:string;due_tick?:number|null}[];
    appraisals: Record<string,{target_id:string;judgment:string;refs:string[];updated_tick?:number}>;
    reflections: {text:string;refs:string[]}[];
    promises: Record<string,{text:string;recipient_id:string;status:string;due_tick?:number;source_ref:string}>;
    next_tick?:number; wake_reasons?:string[];
    cognition?: CognitiveView;
  };
  conversations: {id:string;participants:string[];awaiting:string|null;status:string}[];
  incoming_promises: Record<string,{sender_id:string;text:string;status:string}>;
}
export interface CognitiveExperience {ref:string;action:string;accepted:boolean;reason:string|null;summary:string}
export interface CognitiveView {
  contract_version:'cognition-v1';
  beliefs:Record<string,{stance:'held'|'uncertain';refs:string[];updated_tick?:number}>;
  pending:CognitiveExperience[];
  changes:{kind:'belief'|'plan';key:string;before:string|null;after:string|null;reason:string;refs:string[];memory_ref:string;followup:CognitiveExperience|null;
    evidence?:{ref:string;field:string;target:string|null;value:string|boolean|null;evidence_type:string}[]}[];
}
export interface Projection {
  state_hash?: string;
  lineage?: {contract_version: string; ancestors: {worldline_id: string; seq: number; state_hash: string}[]} | null;
  scene?: ExperienceScene;
  projection_version: string;
  engine_version: string;
  world_id: string;
  worldline_id: string;
  baseline_id: string | null;
  viewer_scope: string;
  policy_version: string;
  role: Role;
  historical: boolean;
  spoiler_free?: boolean;
  run?: { settings: RunSettings; used: number };
  conflict_pending?: boolean;
  pending_conflict?: PendingConflict;
  premises?: {
    ordinary: Record<string, OrdinaryPast>;
    unknowns: Record<string, KeyUnknown>;
    resolved: Record<string, { text: string; source: PremiseSource }>;
  };
  expression_options?: ExpressionOptions;
  candidate_targets?: {id: string; name: string; location_name: string}[];
  seq: number | null;
  sim_time_tick: number | null;
  actor_id?: string;
  scheduler?: {
    insertion_counter: number;
    pending_jobs: {
      id: string;
      due_tick: number;
      priority: number;
      kind: string;
      payload?: { text?: string; key?: string };
    }[];
  };
  autonomy?: {
    enabled: boolean;
    used?: number;
    limit?: number;
    actors?: string[];
    mode?: "rules" | "model";
  };
  execution?: {state:string; actor_id?:string|null;next_tick?:number|null;model_enabled:boolean;strategy:string};
  model_budget?: ModelBudget;
  capabilities: string[];
  control: { status: string; reason: string };
  agents: Record<string, Agent>;
  world: {
    place_topology: Record<string, string[]>;
    items: Record<string, string>;
    environment: Record<string, unknown>;
    readable_items?: string[];
    item_texts?: Record<string, string>;
    area?: string;
    speech_recipients?: string[];
  };
}

interface ModelUsage {
  sent_calls: number;
  pending_calls: number;
  committed_steps: number;
  confirmed_micro: number;
  held_micro: number;
}

export type ModelBudget = {
  limit_micro?: number;
  charged_micro?: number;
  calls?: number;
  max_calls?: number;
  allocation?: {limit_micro:number;charged_micro:number;calls:number;max_calls:number;used_input_tokens:number;input_tokens:number;used_output_tokens:number;output_tokens:number;elapsed_seconds:number;runtime_seconds:number;used_actions?:number;max_actions?:number;used_cognition?:number;max_cognition?:number};
  exploration?: ModelUsage & {
    max_calls: number;
    limit_micro: number;
    line: ModelUsage;
    recovery?: { status: 'commit_unknown' | 'commit_recovered' | 'not_committed' | 'check_required'; step: number; retry_approved?: boolean };
  };
};
export interface RuntimeEvent extends PerceptionRecord {
  worldline_id?: string;
  location_id?: string;
  args?: Record<string, unknown>;
  event_id: string;
  seq?: number;
  actor_id: string | null;
  action_type: string;
  accepted: boolean;
  reason_code: string | null;
  sim_time_after?: number;
  sim_time_before?: number;
  kind?: string;
  reason?: string;
  message_kind?: 'speech' | 'private' | 'scene' | 'directed' | 'premise';
  recipient_ids?: string[];
  perceived_by?: string[];
  witnesses?: Record<string, PerceptionRecord>;
  concealed?: boolean;
  ruling?: ActionRuling;
  ruling_effects?: ({ op: 'agent_location_set'; entity_id: string; before: string; after: string }
    | { op: 'item_holder_set'; item_id: string; before: string; after: string })[];
  decision_source?: 'rules' | 'model';
  observations?: ObservationCondition[];
  expression?: { kind: 'original'; citation: OpeningCitation; text: string }
    | { kind: 'line_past'; source: PremiseSource; text: string }
    | { kind: 'key_unknown'; title: string; source: PremiseSource; text: string };
}
export interface ReplayEvent extends RuntimeEvent {
  sim_time_before?: number;
  source: {worldline_id:string;seq?:number;event_id?:string};
}

export interface ObservationCondition {
  id: string;
  title: string;
  mode: 'mark' | 'pause';
  event: 'scheduled' | 'move' | 'take' | 'transfer' | 'read';
  target_id: string;
}
export interface RunSettings {
  mode: 'continuous' | 'segment';
  segment_steps: number;
  observations: ObservationCondition[];
  story_stop_tick?: number | null;
  retry_once?: boolean;
}
export interface ReplayTimeline {
  worldline_id:string;
  world_id:string;
  current_seq:number;
  current_tick:number|null;
  total:number;
  total_all:number;
  offset:number;
  limit:number;
  facets:{actors:{value:string;count:number}[];locations:{value:string;count:number}[];actions:{value:string;count:number}[]};
  events:ReplayEvent[];
}
export interface Envelope {
  type: "snapshot" | "update";
  previous_cursor: string | null;
  cursor: string;
  projection: Projection;
  events: RuntimeEvent[];
}
export interface Worldline {
  parent_worldline_id?: string;
  parent_anchor_seq?: number;
  title?: string;
  purpose?: string;
  series_id?: string;
  worldline_id: string;
  world_id: string;
  engine_version: string;
  control_status?: string;
  seq?: number;
  sim_time_tick?: number|null;
  event_types?: string[];
  actor_ids?: string[];
  location_ids?: string[];
}

export interface BranchComparison {
  world_id: string;
  common_anchor: { worldline_id: string; seq: number; state_hash: string; sim_time_tick: number } | null;
  left: ComparisonEndpoint;
  right: ComparisonEndpoint;
  changes: { path: string; label: string; left: unknown; right: unknown; category?: string; entity_id?: string }[];
  events: { left: RuntimeEvent[]; right: RuntimeEvent[] };
  events_truncated: boolean;
}
export interface ComparisonEndpoint {
  worldline_id: string; title: string; purpose: string; seq: number; sim_time_tick: number;
  state_hash: string; control_status: string; initial_tick: number; latest_tick: number; selected_tick: number;
}

export interface ScenarioScopeEntry {
  key: string; id: string; kind: string; title: string; version: number; included: boolean; reasons: string[];
}
export interface ScenarioPeriod {
  year: number | null;
  side: 'before' | 'after' | null;
  event: { id: string; title: string; version?: number } | null;
}
export interface OpeningCitation { node_id: string; version: number; start: number; end: number }
export interface OrdinaryPast { text: string; witnesses: string[] }
export interface KeyUnknown { title: string; may_resolve: boolean; knowers: string[] }
export interface PremiseSource { worldline_id: string; seq: number }
export type AttemptAction = { kind: 'move'; destination_id: string } | { kind: 'take'; item_id: string }
  | { kind: 'transfer'; item_id: string; recipient_id: string };
export interface PendingConflict {
  source: PremiseSource;
  detail: { kind: 'item'; item_id: string; holder_id: string; claims: { actor_id: string; blocker: string | null }[] }
    | { kind: 'consequence'; description: string };
}
export type ActionRuling = { kind: 'attempt'; attempt: { actor_id: string; action: AttemptAction }; location_id: string; required_items: string[] }
  | { kind: 'conflict'; conflict: PendingConflict; result: 'pending' | 'blocked' | 'rules' | 'draw' | 'chosen' | 'cancelled';
      winner_id: string | null; draw_index: number | null };
export interface ExpressionOptions {
  past: Record<string, string>;
  basis: Record<string, 'original' | 'premise'>;
}
export interface OpeningRuleCheck {
  id: string; title: string; version: number; status: 'reference' | 'supported' | 'blocked';
  consequence?: string; holder_name?: string;
}
export interface OpeningRoleCheck {
  id: string; name: string; candidate: boolean; location_id: string; location_name: string; chosen: boolean;
  options: {id: string; name: string; records: {id: string; version: number}[]}[];
  input?: {
    goal: string; voice_sample: string;
    knowledge: Record<string, {text: string; basis: 'initial' | 'experienced' | 'reported'}>;
    beliefs: Record<string, string>; citations: Record<string, OpeningCitation>;
    expression?: ExpressionOptions;
    perception: { location: string; exits: string[]; people: Record<string, {location: string}>; items: Record<string, string> };
    profile: { place_names: Record<string, string>; people_names: Record<string, string>; item_names: Record<string, string> };
  };
}
export interface OpeningCheck {
  blockers: {kind: 'role' | 'rule'; id: string; message: string}[];
  roles: OpeningRoleCheck[];
  rules: OpeningRuleCheck[];
  reference_people: {id: string; name: string; version: number}[];
  observation_question: string;
  reopen?: ReopenDifference;
}

interface FrozenSelection {
  index: number;
  version: number;
  start: number;
  end: number;
  quote: string;
}

export interface ReopenDifference {
  worldline_id: string;
  title: string;
  materials: { id: string; title: string; before: FrozenSelection[]; after: FrozenSelection[] }[];
  scope: { id: string; title: string; before: {title: string; version: number} | null; after: {title: string; version: number} | null }[];
  run_settings: RunSettings | null;
  omitted_observations: string[];
}
export interface AuthoredStart {
  origin: { id: string; path: string; work_id: string; work_title: string } | null;
  opening: { mode: 'continue' | 'custom'; time: string; location_id: string; location_name: string;
    location_version: number; situation: string; material_index: number | null;
    anchor?: { title: string; path: string; version: number; start: number; end: number } };
  period: ScenarioPeriod;
  scope: ScenarioScopeEntry[];
  readiness?: OpeningCheck;
}
export function scenarioPeriodLabel(period: ScenarioPeriod) {
  if (period.year !== null) return `${period.year} 年`;
  return period.event ? `${period.event.title}${period.side === 'before' ? '之前' : '之后'}` : '未限定时期';
}
export const openingLabels = { continue: '接着所选内容', custom: '自定开场' };
export interface ExperienceScene {
  series_id: string; series_version: number; asset_version: string; title: string; purpose: string;
  places: Record<string, {name: string; description: string}>;
  actors: Record<string, {name: string; avatar: number; persona?: string}>;
  items: Record<string, {name: string; description: string;text?:string}>;
  observation_names?: Record<string, string>;
  background?: string; adaptations?: string;
  preparation?: AuthoredStart;
  reopen?: ReopenDifference;
  initial_setup?: {
    role_locations: Record<string, string>;
    item_holders: Record<string, string>;
    exits: Record<string, string[]>;
    access_rules: {destination_id: string; item_id: string}[];
    perception?: PerceptionLayout;
  };
  sources?: Record<string, {entity_id: string; entity_version: number}>;
  materials?: {node_id: string; version: number; start: number; end: number; purpose: string; title: string; work_id: string; work_title: string}[];
}
export const purposeNames: Record<string,string> = {original_projection:'原作推演',template_parallel:'模板平行世界',sandbox:'自由沙盒'};
export function displayName(p: Projection, id: string | null | undefined): string {
  return id ? p.scene?.actors[id]?.name || p.scene?.places[id]?.name || p.scene?.items[id]?.name || p.scene?.observation_names?.[id] || id : '世界';
}
export function perceptionText(p: Projection, record: PerceptionRecord): string {
  const facts = record.facts;
  if (record.channel === "sight" && facts?.item_id && facts.recipient_id) {
    return `看到${displayName(p, record.actor_id)}将${displayName(p, facts.item_id)}交给${displayName(p, facts.recipient_id)}。`;
  }
  return record.text || "已有一条感知记录。";
}
export function evidenceText(value: unknown): string {
  if(typeof value==='string')return value;
  const record=value as {text?:string;basis?:string};
  if(record?.basis==='checked'){
    try {const result=JSON.parse(record.text||'');
      return `“${result.left_quote}”与“${result.right_quote}”字面${result.result==='literal_equal'?'相同':'不同'}；仅限所选片段，不判断内容为真。`;
    } catch { /* Saved legacy prose stays readable. */ }
  }
  return record?.text||'';
}
export class RuntimeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function runtimeRequest<T>(
  session: HostSession,
  path: string,
  signal?: AbortSignal,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/v2" + path, {
    method,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    headers: {
      Authorization: "Bearer " + session.token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok)
    throw new RuntimeError(
      response.status,
      (await response.json()).detail || "runtime_unavailable",
    );
  return response.json();
}

/** Header-authenticated SSE: no tokens in URLs, cookies or persistent browser storage. */
export async function runtimeStream(
  session: HostSession,
  line: string,
  cursor: string,
  signal: AbortSignal,
  receive: (value: Envelope) => void,
): Promise<void> {
  const response = await fetch(
    `/api/v2/worldlines/${encodeURIComponent(line)}/stream?cursor=${encodeURIComponent(cursor)}`,
    {
      headers: { Authorization: "Bearer " + session.token },
      signal,
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new RuntimeError(response.status, (await response.json()).detail);
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) throw new Error("stream_disconnected");
      pending += decoder.decode(next.value, { stream: true });
      let boundary;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const block = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (!data) continue;
        const value = JSON.parse(data);
        if (block.startsWith("event: reset"))
          throw new RuntimeError(
            value.reason === "session_expired" ||
            value.reason === "unauthorized"
              ? 401
              : 409,
            value.reason,
          );
        receive(value);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** All modes consume the same DTO; preferences never submit a Runtime action. */
export function acceptEnvelope(
  current: Envelope | undefined,
  next: Envelope,
  scope: string,
  line: string,
): Envelope {
  if (
    next.projection.projection_version !== "world-projection-v1" ||
    next.projection.engine_version !== "world-runtime-v2" ||
    next.projection.viewer_scope !== scope ||
    next.projection.worldline_id !== line ||
    (next.type === "update" &&
      (!current ||
        next.previous_cursor !== current.cursor ||
        next.projection.policy_version !== current.projection.policy_version))
  ) {
    throw new RuntimeError(409, "resnapshot_required");
  }
  if (next.type === "update" && current)
    return {
      ...next,
      events: [...current.events, ...next.events]
        .filter(
          (event, i, events) =>
            events.findIndex((other) => other.event_id === event.event_id) ===
            i,
        )
        .slice(-50),
    };
  return next;
}
