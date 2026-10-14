import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from 'react-dom';

export interface ContextCrumb {
  label: string;
  to?: string;
}
export const WorkspaceContext = createContext<
  Dispatch<SetStateAction<ContextCrumb[]>>
>(() => {});

export function useWorkspaceTrail(trail: ContextCrumb[]) {
  const setTrail = useContext(WorkspaceContext);
  const serialized = JSON.stringify(trail);
  useEffect(() => {
    setTrail(JSON.parse(serialized) as ContextCrumb[]);
    return () => setTrail([]);
  }, [serialized, setTrail]);
}

/** Workspace-specific controls share the existing shell without changing its layout. */
export function WorkspaceHeader({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(document.getElementById('workspace-header-slot')); }, []);
  return host ? createPortal(children, host) : null;
}
