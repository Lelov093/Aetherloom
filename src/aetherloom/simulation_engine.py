"""Local world mechanics. Model text cannot mutate this state directly."""
from copy import deepcopy


def record_text(entry):
    value = entry['payload']
    if entry['kind'] == 'assertion':
        return f"{value['predicate']}：{value['value']}"
    return value.get('title', value.get('label', '')) + '：' + value.get('description', '')


def context_for(session, actor):
    state, manifest = session['state'], session['manifest']
    me = state['agents'][actor]
    nearby = {key: value for key,value in state['agents'].items() if value['location'] == me['location']}
    place = state['places'][me['location']]
    names = manifest['entities']
    visible_items = {key:holder for key,holder in state['items'].items() if holder in nearby or holder == me['location']}
    known = {}
    for key, evidence in me['known'].items():
        if 'text' in evidence:
            known[key] = evidence
    return dict(identity={'id':actor,'name':names[actor]['name']}, persona=me['persona'], goal=me['goal'],
                beliefs=me['beliefs'], knowledge=known, recent_experiences=me['memories'][-12:],
                time={'start':manifest['setup']['start_label'],'elapsed_steps':state['tick']},
                location={'id':me['location'],'name':names[me['location']]['name'],'description':place['public_description']},
                exits=[{'id':key,'name':names[key]['name']} for key in place['neighbors']],
                visible_people=[{'id':key,'name':names[key]['name']} for key in nearby if key != actor],
                visible_items=[{'id':key,'name':names[key]['name'],'holder_id':holder} for key,holder in visible_items.items()],
                entry_conditions=[r for r in manifest['setup']['rules'] if r['destination_id'] in place['neighbors']],
                supported_actions=['observe','move','speak','transfer','take','wait','goal'])


def step(session, actor, proposal):
    old = session['state']
    state = deepcopy(old)
    me = state['agents'][actor]
    manifest = session['manifest']
    names = {key:entity['name'] for key,entity in manifest['entities'].items()}
    action = proposal.model_dump()
    kind, target = action['type'], action['target_id']
    location = me['location']
    witnesses = [key for key,value in state['agents'].items() if value['location'] == location]
    rejection = None
    if kind != 'speak' and (action['speech'] or action['share_ids']):
        rejection = '非交谈行动不能提交台词或传播记录。'
    elif kind != 'goal' and action['new_goal']:
        rejection = '只有目标调整行动可以改写自身目标。'
    elif kind == 'take':
        if state['items'].get(action['item_id']) != location:
            rejection = '只能拾取当前位置尚未被持有的物品。'
        else:
            state['items'][action['item_id']] = actor
    elif kind == 'move':
        if target not in state['places'][location]['neighbors']:
            rejection = '目的地不与当前位置连通。'
        elif any(r['destination_id'] == target and state['items'].get(r['item_id']) != actor for r in manifest['setup']['rules']):
            rejection = '未满足进入地点所需物品条件。'
        else:
            me['location'] = target
    elif kind == 'speak':
        if not action['speech'].strip():
            rejection = '交谈必须有实际台词。'
        elif target and (target not in state['agents'] or state['agents'][target]['location'] != location or target == actor):
            rejection = '交谈对象必须是同地点的其他角色。'
        elif any(key not in me['known'] for key in action['share_ids']):
            rejection = '不能传播尚未知晓的记录。'
        else:
            recipients = [target] if target else [key for key in witnesses if key != actor]
            for recipient in recipients:
                for key in action['share_ids']:
                    # Receipt is knowledge of a report; it is never a new World Truth.
                    if key not in state['agents'][recipient]['known']:
                        state['agents'][recipient]['known'][key] = {**me['known'][key], 'basis':'reported','sender_id':actor,'event_seq':session['cursor']+1}
            witnesses = [actor, *recipients]
    elif kind == 'transfer':
        if state['items'].get(action['item_id']) != actor:
            rejection = '只能转移自己持有的物品。'
        elif target not in witnesses or target == actor:
            rejection = '物品只能交给同地点的其他角色。'
        else:
            state['items'][action['item_id']] = target
    elif kind == 'observe':
        pass
    elif kind == 'goal':
        if not action['new_goal'] or not action['new_goal'].strip():
            rejection = '新目标不能为空。'
        else:
            me['goal'] = action['new_goal']
        witnesses = [actor]
    elif kind == 'wait':
        witnesses = [actor]
    if rejection:
        state = deepcopy(old)
        me = state['agents'][actor]
        witnesses = [actor]
        narration = f'{names[actor]}的行动被拒绝：{rejection}'
    elif kind == 'move':
        narration = f'{names[actor]}从{names[location]}前往{names[target]}。'
    elif kind == 'speak':
        narration = f'{names[actor]} → {names.get(target, "在场角色")}：{action["speech"]}'
        if action['share_ids']:
            shared = [me['known'][key].get('text','') for key in action['share_ids']]
            narration += '\n补充告知：' + '；'.join(shared)
    elif kind == 'transfer':
        narration = f'{names[actor]}将{names[action["item_id"]]}交给{names[target]}。'
    elif kind == 'take':
        narration = f'{names[actor]}从{names[location]}拾取了{names[action["item_id"]]}。'
    elif kind == 'observe':
        visible = [names[key] for key,value in state['agents'].items() if value['location'] == location and key != actor]
        objects = [names[key] for key,holder in state['items'].items() if holder == location or holder in witnesses]
        narration = f'{names[actor]}观察{names[location]}：{state["places"][location]["public_description"]}；在场：{"、".join(visible) or "无人"}；物品：{"、".join(objects) or "无"}。'
    elif kind == 'goal':
        narration = f'{names[actor]}调整了自身目标。'
    else:
        narration = f'{names[actor]}暂时等待。'
    seq = session['cursor'] + 1
    for witness in witnesses:
        state['agents'][witness]['memories'].append(dict(event_seq=seq, actor_id=actor, text=narration,
                                                       basis='own_action' if witness == actor else 'observed'))
    state['tick'] += 1
    state['environment']['elapsed_steps'] = state['tick']
    state['next_actor'] = (state['next_actor'] + 1) % len(state['agents'])
    diff = {key:{'before':old[key], 'after':state[key]} for key in state if old[key] != state[key]}
    return state, diff, narration, rejection is None
