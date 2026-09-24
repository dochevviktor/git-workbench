import { createContext, useContext } from 'react';
import type { ExternalMergeDraft, ExternalTarget, ExternalTool } from '../../../common/ipc/external-tools';
import type { MenuEntry } from './menu/menu-model';

export interface ToolContext {
  settings(): void;
  items(
    repositoryId: string,
    target: ExternalTarget,
    onDraft?: (draft: ExternalMergeDraft) => void,
    kinds?: readonly ExternalTool['kind'][],
  ): MenuEntry[];
}
export const ExternalToolsContext = createContext<ToolContext>({
  settings: () => undefined,
  items: () => [],
});
export const useExternalTools = () => useContext(ExternalToolsContext);
