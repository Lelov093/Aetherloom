import { runtimeRequest, RuntimeError, type HostSession } from './api';
import type { SimulationSource } from '../review/api';

let access: {world: string; session: Promise<HostSession | null>} | undefined;
export async function runtimeReviewRequest<T>(world: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const connect = () => window.aetherloomRuntime!.session(world, 'creator_observer');
  if (!window.aetherloomRuntime || !(await window.aetherloomRuntime.available())) throw new Error('新世界线审阅需要已启用的桌面宿主。');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!access || access.world !== world) access = {world, session: connect()};
    const selected = access;
    const session = await selected.session;
    if (!session) throw new Error('无法建立创作者审阅授权。');
    try { return await runtimeRequest<T>(session, path, undefined, method, body); }
    catch (e) {
      if (!(e instanceof RuntimeError) || e.status !== 401 || attempt) throw e;
      if (access === selected) access = undefined;
    }
  }
  throw new Error('审阅授权已失效。');
}

export async function runtimeReviewList<T>(world: string, path = '/review'): Promise<T[]> {
  if (!window.aetherloomRuntime || !(await window.aetherloomRuntime.available())) return [];
  try { return await runtimeReviewRequest<T[]>(world, path); }
  catch (e) { if (e instanceof RuntimeError && e.status === 404) return []; throw e; }
}

export function runtimeCanonSources(world: string, kind: string, id: string) {
  return runtimeReviewList<SimulationSource>(world, `/review-sources/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`);
}
