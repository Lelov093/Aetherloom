import {
  createContext,
  useContext,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";

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
