"""One independent local process owns scene steps, never the renderer."""
import asyncio
import json
import os
import re
import sys
from pathlib import Path
import httpx
from .creation import CreationError, encoded
from .provider import ProviderSettings
from .simulation_repository import SimulationRepository
from .simulation_engine import context_for, step
from .simulation_models import Action

ROOT = Path(__file__).resolve().parents[2]
SYSTEM = '''你是独立世界中的一个角色 Agent。依据你自己的目标、信念、知识、可观察场景和经历选择下一步。
你不知道未提供的世界秘密；报告可能不真实，不能把他人说法当全知事实。不要代替其他角色行动。
knowledge 中的记录是获知时的内容，不随世界自动更新；起点记录不是对当前动态状态的全知保证，以实际观察为准。
每次只提议一个支持的行动。移动只到 exits；物品只能转移自己持有的；交谈目标须在场。
只能传播 knowledge 中的 share_ids，传播记录会作为明确告知附在台词后。文字不能直接改变世界状态。
只输出 JSON，字段顺序为 speech,type,target_id,item_id,share_ids,new_goal。
type 仅 observe/move/speak/transfer/take/wait/goal。take 用于拾取当前位置尚未被持有的物品。
只有 speak 有 speech 与 share_ids；只有 goal 有 new_goal。
target_id 和 item_id 使用已提供的精确 ID，不使用名字；无目标／物品时用 null。
非 speak 的 speech 必须为空字符串，share_ids 必须为空数组；非 goal 的 new_goal 必须为 null。
自然中文台词简短具体，通常不超过120字。可等待、观察、拒绝告知、改变目标，不必机械轮流聊天。
不得输出思维链、Markdown或多个行动。'''


def spoken_prefix(raw):
    match = re.search(r'"speech"\s*:\s*"((?:\\.|[^"\\])*)', raw)
    if not match:
        return ''
    try:
        return json.loads('"' + match[1] + '"')
    except ValueError:
        return ''


async def request_action(repo, session, actor, settings, budget, calls):
    context = context_for(session, actor)
    messages = [{'role':'system','content':SYSTEM}, {'role':'user','content':encoded(context)}]
    # UTF-8 bytes plus framing is deliberately conservative for this Qwen tokenizer.
    input_bound = len(encoded(messages).encode('utf-8')) + 1024
    if input_bound > 8000:
        raise CreationError('本角色必要上下文超过首轮调用预算，请缩小场景／资料或开启新场景；未静默删掉知识。')
    call = repo.reserve(session['id'], session['generation'], actor, settings.model, context, input_bound, budget, calls)
    if not call:
        return None
    payload = dict(model=settings.model, messages=messages, stream=True, stream_options={'include_usage':True},
                   response_format={'type':'json_object'}, max_tokens=1000, enable_thinking=False)
    raw, usage, finish = '', {}, None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(settings.timeout, read=min(settings.timeout,60))) as client:
            async with client.stream('POST', settings.base_url.rstrip('/')+'/chat/completions',
                                     headers={'Authorization':'Bearer '+settings.api_key}, json=payload) as response:
                if response.status_code != 200:
                    raise CreationError(f'模型请求失败（HTTP {response.status_code}），未重试。')
                async for line in response.aiter_lines():
                    with repo.connection() as conn:
                        current = repo.session(conn, session['id'])
                    if current['generation'] != session['generation'] or current['status'] != 'running':
                        repo.settle(call, usage, raw, 'cancelled')
                        return None
                    if not line.startswith('data:') or line[5:].strip() == '[DONE]':
                        continue
                    data = json.loads(line[5:])
                    if data.get('usage'):
                        usage = data['usage']
                    for choice in data.get('choices', []):
                        raw += choice.get('delta', {}).get('content') or ''
                        finish = choice.get('finish_reason') or finish
                    if len(raw) > 16000:
                        raise CreationError('模型输出超过本次限制。')
                    repo.draft(call, spoken_prefix(raw))
        if finish != 'stop':
            raise CreationError('模型流未正常完成，未提交行动。')
        action = Action.model_validate_json(raw)
        repo.settle(call, usage, raw, 'completed')
        return action
    except (httpx.HTTPError, ValueError) as exc:
        repo.settle(call, usage, raw, 'failed')
        raise CreationError('模型连接／输出合同失败，已暂停；未重试、未提交行动。') from exc
    except BaseException:
        repo.settle(call, usage, raw, 'failed')
        raise


async def run(path):
    repo = SimulationRepository(path)
    settings = ProviderSettings.load(ROOT)
    budget = min(10, max(0, float(os.environ.get('AETHERLOOM_SIM_BUDGET', '10'))))
    calls = min(48, max(0, int(os.environ.get('AETHERLOOM_SIM_CALL_LIMIT', '48'))))
    while True:
        with repo.connection() as conn:
            row = conn.execute("SELECT id FROM simulations WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1").fetchone()
            session = repo.session(conn, row[0]) if row else None
        if not session:
            await asyncio.sleep(.15)
            continue
        try:
            if os.environ.get('AETHERLOOM_SIM_PROVIDER_DISABLED') == '1' or not settings.api_key or settings.protocol != 'openai-compatible' or settings.model != 'qwen3.8-max' or settings.public()['host'] != 'dashscope.aliyuncs.com':
                raise CreationError('首轮真实运行需要当前 DashScope qwen3.8-max 配置；预算不自动适用于其他 Provider。')
            frozen = session['manifest'].get('run_config')
            if frozen and any(frozen[key] != settings.public()[key] for key in ('protocol','host','model')):
                raise CreationError('当前模型配置与本次冻结配置不同，请恢复原配置或明确准备新会话。')
            actors = list(session['state']['agents'])
            actor = actors[session['state']['next_actor']]
            action = await request_action(repo, session, actor, settings, budget, calls)
            if action:
                state, diff, narration, accepted = step(session, actor, action)
                repo.commit_step(session['id'], session['generation'], actor, action.model_dump(), state, diff, narration, accepted)
        except CreationError as exc:
            repo.error(session['id'], session['generation'], exc.message)
        except Exception:
            repo.error(session['id'], session['generation'], '运行机制异常，已暂停。请保留会话并检查本地日志。')
            import traceback
            traceback.print_exc()


async def supervised(path, parent):
    async def parent_exit():
        if sys.platform == 'win32':
            import ctypes
            kernel = ctypes.windll.kernel32
            kernel.OpenProcess.restype = ctypes.c_void_p
            handle = kernel.OpenProcess(0x100000, False, parent)
            if handle:
                try:
                    while kernel.WaitForSingleObject(ctypes.c_void_p(handle), 0) == 258:
                        await asyncio.sleep(.2)
                finally:
                    kernel.CloseHandle(ctypes.c_void_p(handle))
        else:
            while True:
                try:
                    os.kill(parent,0)
                except ProcessLookupError:
                    break
                await asyncio.sleep(.2)
        SimulationRepository(path).pause_all('本地服务异常停止：已保留提交状态，重开需显式继续。')
    tasks = [asyncio.create_task(run(path)),asyncio.create_task(parent_exit())]
    done, pending = await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    await asyncio.gather(*tasks,return_exceptions=True)


if __name__ == '__main__':
    asyncio.run(supervised(Path(sys.argv[1]),int(sys.argv[2])) if len(sys.argv)>2 else run(Path(sys.argv[1])))
