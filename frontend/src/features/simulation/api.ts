import {request,type Entity} from '../creation/api';
import type {Proposal,Candidate} from '../review/api';
export interface RecordInput {id:string;version:number;subject_id?:string;object_id?:string;title?:string;predicate?:string;value?:string;label?:string;description?:string;valid_from:string|null;valid_until:string|null;status:string}
export interface Inputs {revision:number;entities:Entity[];assertions:RecordInput[];events:RecordInput[];relationship_states:RecordInput[]}
export interface Setup {
 expected_revision:number;title:string;intent:string;start_label:string;time_basis:string;
 participants:{entity_id:string;version:number;location_id:string;persona:string;goal:string;beliefs:string[]}[];
 places:{entity_id:string;version:number;public_description:string;neighbors:string[]}[];
 items:{entity_id:string;version:number;holder_id:string}[];
 records:{kind:string;id:string;version:number;at_start:string;reason:string;known_by:string[]}[];
 materials:{node_id:string;version:number;start:number;end:number;purpose:string;known_by:string[]}[];
 rules:{type:string;destination_id:string;item_id:string}[];narrative_guidance:string;unsupported_hard_rules:string[];
 max_steps:number;max_calls:number;budget_yuan:number;confirmed:boolean;
}
export interface Agent {location:string;persona:string;goal:string;beliefs:string[];known:Record<string,unknown>;memories:{event_seq:number;text:string;basis:string}[]}
export interface WorldState {agents:Record<string,Agent>;items:Record<string,string>;places:Record<string,{public_description:string;neighbors:string[]}>;tick:number;[key:string]:unknown}
export interface SimEvent {seq:number;actor_id:string;payload:{type:string;speech:string;target_id:string|null;item_id:string|null;share_ids:string[];new_goal:string|null};diff:Record<string,{before:unknown;after:unknown}>;narration:string;accepted:number}
export interface Session {id:string;world_id:string;title:string;status:string;cursor:number;error:string;calls:number;cost:number;revision_id:string;
 manifest:{entities:Record<string,Entity>;setup:Setup;materials:{node_id:string;version:number;title:string;text:string}[]};
 initial_state:WorldState;state:WorldState;events:SimEvent[];
 stream:{id:string;actor_id:string;draft:string;status:string}[];proposals:{id:string;seq:number;kind:string;status:string}[]}
export interface SimPreview {candidate:Candidate & {simulation_id:string;seq:number};revision:number;baseline_stale:boolean;source:{simulation_id:string;title:string;seq:number;baseline_revision:number;start:string;event:SimEvent};
 current:Record<string,unknown>[];conflicts:Record<string,unknown>[];dependencies:{ref:string}[];warnings:string[];requires_evidence_confirmation:boolean}
const post=(body:unknown)=>({method:'POST',body:JSON.stringify(body)});
export const simApi={
 inputs:(world:string)=>request<Inputs>(`/worlds/${world}/simulation-inputs`),
 list:(world:string)=>request<Session[]>(`/worlds/${world}/simulations`),
 prepare:(world:string,body:Setup)=>request<{errors:string[];warnings:string[];manifest:Session['manifest'];initial_state:Session['state']}>(`/worlds/${world}/simulations/prepare`,post(body)),
 create:(world:string,body:Setup)=>request<Session>(`/worlds/${world}/simulations`,post(body)),
 get:(id:string)=>request<Session>(`/simulations/${id}`),
 control:(id:string,action:string)=>request<Session>(`/simulations/${id}/${action}`,post({})),
 propose:(id:string,seq:number,kind:string)=>request<{id:string}>(`/simulations/${id}/proposals`,post({seq,kind})),
 review:(world:string)=>request<SimPreview[]>(`/worlds/${world}/simulation-review`),
 preview:(id:string)=>request<SimPreview>(`/simulation-review/${id}`),
 edit:(c:Candidate,payload:Proposal)=>request<SimPreview>(`/simulation-review/${c.id}`,{method:'PATCH',body:JSON.stringify({version:c.version,payload})}),
 decide:(p:SimPreview,action:string,resolution:string|null,ack:boolean)=>request(`/simulation-review/${p.candidate.id}/decide`,post({version:p.candidate.version,expected_revision:p.revision,action,resolution,acknowledge_inference:ack,acknowledge_baseline:ack})),
};
export const simStatus:Record<string,string>={paused:'已暂停',queued:'等待 Worker',running:'运行中',completed:'本段完成'};
