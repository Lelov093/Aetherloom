import { request } from "../creation/api";

export type ObjectType =
  | "entity"
  | "work"
  | "content"
  | "event"
  | "relationship";
export interface ObjectRef {
  id: string;
  type: ObjectType;
  kind: string;
  label: string;
  subtitle: string;
  context: string;
  to: string;
  work_id?: string;
}
export interface ObjectPage {
  items: ObjectRef[];
  total: number;
  offset: number;
  limit: number;
}
export interface ObjectDetail {
  item: ObjectRef;
  fields: { label: string; text: string }[];
  references: { label: string; to: string }[];
  sources: { label: string; to: string; download?: boolean }[];
}
export const objectTypeNames: Record<ObjectType, string> = {
  entity: "世界对象",
  work: "作品",
  content: "作品内容",
  event: "正式事件",
  relationship: "关系状态",
};
export const catalogApi = {
  list: (
    world: string,
    query: {
      type: ObjectType | "all";
      q?: string;
      entity_kind?: string;
      work_id?: string;
      offset?: number;
    },
  ) => {
    const params = new URLSearchParams(
      Object.entries(query)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    return request<ObjectPage>(`/worlds/${world}/catalog?${params}`);
  },
  inspect: (world: string, item: Pick<ObjectRef, "id" | "type">) =>
    request<ObjectDetail>(`/worlds/${world}/catalog/${item.type}/${item.id}`),
};
