import type { ReactNode } from 'react';
import type { CognitiveView, CognitiveExperience } from './api';
import {evidenceText} from './api';

const actionNames:Record<string,string>={speak:'发言',move:'移动',take:'拿取',transfer:'交接',observe:'观察',wait:'等待',goal:'调整目标',read:'阅读冻结文本',compare:'核对文本片段'};
const evidenceNames:Record<string,string>={current_observation:'当次局部感知',historical_observation:'历史观察',action_result:'行动结果',report:'他人报告',read_text:'实际阅读的文本',text_comparison:'字面核对结果',initial:'起点资料',subjective:'本人主观解释'};
const factNames:Record<string,string>={location:'所在地点',item_holder:'物品持有者',person_present:'是否在场',text:'原文引句'};
const reasons:Record<string,string>={recipient_not_colocated:'接收者不在同一地点',item_not_available:'物品当前不能拿取',item_not_owned:'本人未持有该物品',entry_requires_item:'缺少进入所需物品',not_connected:'无法直接到达该地点'};
const planStates:Record<string,string>={active:'进行中',blocked:'受阻（本人判断）',completed:'完成（本人判断）',abandoned:'已放弃'};
export function CognitionInspector({state,beliefs,citation,describe}:{
  state:CognitiveView;beliefs:Record<string,unknown>;citation:(refs:string[])=>ReactNode;describe:(text:string)=>string;
}) {
  const summary=(e:CognitiveExperience)=>{
    if(e.summary==='rule_rejected')return '本次尝试没有产生预期的状态变化。';
    if(e.action==='compare')return evidenceText({basis:'checked',text:e.summary});
    if(e.action==='read'){try{return describe(`已阅读${JSON.parse(e.summary).item_id}的冻结片段；内容不自动为真。`);}catch{/* Older text remains visible. */}}
    return e.action==='speak'?e.summary:describe(e.summary.replace(new RegExp(`^${e.action}(?= · |$)`),actionNames[e.action]||'行动'));
  };
  const revision=(value:string)=>value.replace(/^(active|blocked|completed|abandoned)(?= · )/,s=>planStates[s]);
  const experience=(e:CognitiveExperience)=><>
    <p>{actionNames[e.action]||'经历'} · {e.accepted?'已提交':'规则拒绝'}{e.reason?` · ${reasons[e.reason]||'条件不满足'}`:''}</p>
    <p>{summary(e)}</p>{citation([e.ref])}
  </>;
  return <section aria-label="认知修订与行动依据">
    <h4>当前信念（主观）</h4>
    {Object.entries(state.beliefs).map(([key,record])=><article key={key}>
      <p>{String(beliefs[key]??'')}<small>{record.stance==='uncertain'?'仍存疑':'本人目前相信'}</small></p>
      {record.refs.length?citation(record.refs):<small>初态暂定看法；不等于已确认事实</small>}
    </article>)}
    {!Object.keys(state.beliefs).length&&<p>当前没有保留的信念条目。</p>}
    <details><summary>待重新考虑的经历（{state.pending.length}）</summary>
      <p>经历只提示角色考虑，不强制改变看法或计划。</p>
      {state.pending.map(e=><article key={e.ref}>{experience(e)}</article>)}
    </details>
    <details><summary>信念与计划的修订记录</summary>
      <p>经历 → 本人判断／计划 → 后续行动。这里只展示近期记录及其引用，不代表已证明因果关系。</p>
      {[...state.changes].reverse().map((change,i)=><article key={`${change.memory_ref}:${change.kind}:${change.key}:${i}`}>
        <strong>{change.kind==='belief'?'信念修订':'计划修订'}</strong>
        <p>此前：{change.before?revision(change.before):'无'}</p><p>{change.after===null?(change.kind==='plan'?'已移出当前计划（不等于完成或放弃）':'已撤回信念'):`修订后：${revision(change.after)}`}</p>
        <p>本人理由：{change.reason}</p>{citation(change.refs)}
        {change.evidence?.map((e,j)=><p key={j}><small>{evidenceNames[e.evidence_type]||e.evidence_type}</small> · {e.field==='text'?String(e.value):describe(`${factNames[e.field]||e.field} ${e.target||''}：${e.value===null?'当时局部未见':typeof e.value==='boolean'?(e.value?'是':'否'):e.value}`)}</p>)}
        <details><summary>后续行动{change.followup?'':'（尚未发生）'}</summary>
          {change.followup&&experience(change.followup)}
        </details>
      </article>)}
      {!state.changes.length&&<p>尚无显式修订。</p>}
    </details>
  </section>;
}
