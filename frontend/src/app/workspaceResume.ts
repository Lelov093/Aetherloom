import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const workspaces = ['create', 'inspirations', 'simulate', 'explore'] as const;
type Workspace = typeof workspaces[number];
const key = (world: string, workspace: Workspace) =>
  `aetherloom:resume:${world}:${workspace}`;
export function workspaceDestination(
  world: string,
  workspace: Workspace,
): string {
  const base = `/worlds/${world}/${workspace}`;
  try {
    const saved = localStorage.getItem(key(world, workspace));
    if (
      saved &&
      (saved === base ||
        saved.startsWith(base + "?") ||
        saved.startsWith(base + "/"))
    )
      return saved;
  } catch {
    /* Navigation remains available if local preferences cannot be saved. */
  }
  return base;
}
export function useWorkspaceResume(world?: string) {
  const location = useLocation();
  useEffect(() => {
    if (!world) return;
    for (const workspace of workspaces) {
      const base = `/worlds/${world}/${workspace}`;
      if (
        location.pathname === base ||
        location.pathname.startsWith(base + "/")
      ) {
        if (workspace === 'simulate' && new URLSearchParams(location.search).has('prepare')) return;
        try {
          localStorage.setItem(
            key(world, workspace),
            location.pathname + location.search,
          );
        } catch {}
      }
    }
  }, [world, location.pathname, location.search]);
}
