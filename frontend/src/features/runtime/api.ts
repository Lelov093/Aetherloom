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
      ): Promise<HostSession | null>;
      viewerLayout(worldline: string, value?: ViewerLayout, view?: string): Promise<ViewerLayout | null>;
    };
  }
}
export interface Agent {
  location: string;
  goal?: string;
  known?: Record<string, unknown>;
  beliefs?: Record<string, unknown>;
  memories?: { text: string; basis: string; source: unknown }[];
  committed_plans?: unknown[];
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
  model_budget?: { limit_micro: number; charged_micro: number; calls: number; max_calls: number;
    allocation?: {limit_micro:number;charged_micro:number;calls:number;max_calls:number;used_input_tokens:number;input_tokens:number;used_output_tokens:number;output_tokens:number;elapsed_seconds:number;runtime_seconds:number;used_actions?:number;max_actions?:number;used_cognition?:number;max_cognition?:number} };
  capabilities: string[];
  control: { status: string; reason: string };
  agents: Record<string, Agent>;
  world: {
    place_topology: Record<string, string[]>;
    items: Record<string, string>;
    environment: Record<string, unknown>;
    readable_items?: string[];
  };
}
export interface RuntimeEvent {
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
  text?: string;
}
export interface ReplayEvent extends RuntimeEvent {
  sim_time_before?: number;
  source: {worldline_id:string;seq?:number;event_id?:string};
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
  common_anchor: { worldline_id: string; seq: number; state_hash: string } | null;
  left: { worldline_id: string; title: string; purpose: string; seq: number; sim_time_tick: number; state_hash: string; control_status: string };
  right: { worldline_id: string; title: string; purpose: string; seq: number; sim_time_tick: number; state_hash: string; control_status: string };
  changes: { path: string; label: string; left: unknown; right: unknown; category?: string; entity_id?: string }[];
  events: { left: RuntimeEvent[]; right: RuntimeEvent[] };
}

export interface ExperienceScene {
  series_id: string; series_version: number; asset_version: string; title: string; purpose: string;
  places: Record<string, {name: string; description: string}>;
  actors: Record<string, {name: string; avatar: number; persona?: string}>;
  items: Record<string, {name: string; description: string;text?:string}>;
  background?: string; adaptations?: string;
  initial_setup?: {
    role_locations: Record<string, string>;
    item_holders: Record<string, string>;
    exits: Record<string, string[]>;
    access_rules: {destination_id: string; item_id: string}[];
  };
  sources?: Record<string, {entity_id: string; entity_version: number}>;
  materials?: {node_id: string; version: number; start: number; end: number; purpose: string; title: string; work_id: string; work_title: string}[];
}
export const purposeNames: Record<string,string> = {original_projection:'原作推演',template_parallel:'模板平行世界',sandbox:'自由沙盒'};
export function displayName(p: Projection, id: string | null | undefined): string {
  return id ? p.scene?.actors[id]?.name || p.scene?.places[id]?.name || p.scene?.items[id]?.name || id : '世界';
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
