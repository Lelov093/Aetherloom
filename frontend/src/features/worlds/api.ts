export interface World {
  id: string; name: string; description: string; archived: boolean;
  created_at: string; updated_at: string; version: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
  catch { throw new Error('暂时无法连接本地服务。已保存的世界不会丢失，请稍后重试。'); }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : '无法保存，请检查名称与说明的长度后重试。');
  }
  return response.json();
}

export const worldApi = {
  list: (archived = false) => request<World[]>(`/api/worlds?archived=${archived}`),
  get: (id: string) => request<World>(`/api/worlds/${encodeURIComponent(id)}`),
  create: (data: { name: string; description: string }) => request<World>('/api/worlds', { method: 'POST', body: JSON.stringify(data) }),
  update: (world: World, data: Partial<Pick<World, 'name' | 'description' | 'archived'>>) => request<World>(`/api/worlds/${world.id}`, {
    method: 'PATCH', body: JSON.stringify({ ...data, version: world.version }),
  }),
};
