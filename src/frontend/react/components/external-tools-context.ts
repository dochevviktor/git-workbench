import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { ExternalMergeDraft, ExternalTarget, ExternalTool } from '../../../common/ipc/external-tools';
import type { MenuEntry } from './menu/menu-model';

export interface ToolContext {
  readonly settingsPanel: ReactNode;
  settings(): void;
  openDefault(repositoryId: string, target: ExternalTarget, kind: ExternalTool['kind']): void;
  items(
    repositoryId: string,
    target: ExternalTarget,
    onDraft?: (draft: ExternalMergeDraft) => void,
    kinds?: readonly ExternalTool['kind'][],
  ): MenuEntry[];
}
export const ExternalToolsContext = createContext<ToolContext>({
  settingsPanel: null,
  settings: () => undefined,
  openDefault: () => undefined,
  items: () => [],
});
export const useExternalTools = () => useContext(ExternalToolsContext);
