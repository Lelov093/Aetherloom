import { useEffect, useState } from 'react';
import { request, type Entity } from '../creation/api';

export interface CategoryInput {
  name: string;
  parent_id: string | null;
  card_fields: string[];
}

export interface WorldCategory extends CategoryInput {
  id: string;
  version: number;
}

export interface CategoryLayout {
  categories: WorldCategory[];
  home_ids: string[];
}

const apiPath = (world: string) => `/worlds/${world}/categories`;
const write = (method: string, data: unknown) => ({ method, body: JSON.stringify(data) });

export const categoriesApi = {
  list: (world: string) => request<CategoryLayout>(apiPath(world)),
  create: (world: string, data: CategoryInput) => request<WorldCategory>(apiPath(world), write('POST', data)),
  edit: (world: string, category: WorldCategory, data: CategoryInput) =>
    request<WorldCategory>(`${apiPath(world)}/${category.id}`, write('PATCH', { ...data, version: category.version })),
  remove: (world: string, category: WorldCategory) =>
    request(`${apiPath(world)}/${category.id}?version=${category.version}`, { method: 'DELETE' }),
  arrangeHome: (world: string, previous_ids: string[], ids: string[]) =>
    request<{ home_ids: string[] }>(`/worlds/${world}/category-home`, write('PUT', { previous_ids, ids })),
  objects: (world: string, category: string) => request<Entity[]>(`${apiPath(world)}/${category}/objects`),
  place: (world: string, category: string, entity: string) =>
    request(`${apiPath(world)}/${category}/objects/${entity}`, { method: 'PUT' }),
  unplace: (world: string, category: string, entity: string) =>
    request(`${apiPath(world)}/${category}/objects/${entity}`, { method: 'DELETE' }),
  move: (world: string, category: string, entity: string, category_id: string) =>
    request(`${apiPath(world)}/${category}/objects/${entity}`, write('PATCH', { category_id })),
};

export const objectsPath = (world: string) => `/worlds/${world}/create/objects`;
export const categoryDirectoryPath = (world: string) => `${objectsPath(world)}?view=categories`;
export const categoryPath = (world: string, category: string) =>
  `${objectsPath(world)}?${new URLSearchParams({ category })}`;

export function categoryTrail(category: WorldCategory, categories: WorldCategory[]): WorldCategory[] {
  const trail = [category];
  let parent = categories.find(item => item.id === category.parent_id);
  while (parent) {
    trail.unshift(parent);
    parent = categories.find(item => item.id === parent?.parent_id);
  }
  return trail;
}

export const categoryLabel = (category: WorldCategory, categories: WorldCategory[]) =>
  categoryTrail(category, categories).map(item => item.name).join(' / ');

export function useWorldCategories(world: string) {
  const [layout, setLayout] = useState<CategoryLayout>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    categoriesApi.list(world).then(value => {
      if (active) setLayout(value);
    }).catch(error => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [world, revision]);
  return { layout, setLayout, error, reload: () => setRevision(n => n + 1) };
}
