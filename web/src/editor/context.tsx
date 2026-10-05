import { createContext, useContext } from 'react';

export interface DocContextValue {
  mode: 'view' | 'edit';
  pageId: number | null;
  spaceKey: string | null;
  /** Verschachtelungstiefe (eingebundene Seiten). */
  depth: number;
}

export const DocContext = createContext<DocContextValue>({ mode: 'view', pageId: null, spaceKey: null, depth: 0 });

export function useDoc(): DocContextValue {
  return useContext(DocContext);
}
