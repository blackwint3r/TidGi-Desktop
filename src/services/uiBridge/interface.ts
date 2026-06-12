import type { IPreferences } from '@services/preferences/interface';

export const UI_BRIDGE_PREFERENCE_ALLOW_LIST = [
  'sidebar',
  'tidgiMiniWindowShowSidebar',
  'titleBar',
  'tidgiMiniWindowAlwaysOnTop',
  'alwaysOnTop',
  'themeSource',
] as const;

export type UIBridgePreferenceKey = typeof UI_BRIDGE_PREFERENCE_ALLOW_LIST[number];

export interface IUIBridgeState {
  workspaceId: string;
  workspaceName: string;
  activeWindow: 'main' | 'tidgiMiniWindow';
  openedTiddlers: string[];
  activeTiddler?: string;
  sidebarVisible?: boolean;
  sidebarTab?: string;
  notebookSidebar?: string;
  preferences: Partial<IPreferences>;
}

export interface ISetLayoutInput {
  workspaceNameOrId?: string;
  layoutKey: 'sidebar' | 'tidgiMiniWindowShowSidebar' | 'titleBar' | 'notebookSidebar';
  value: string | boolean;
}

export interface ISetPreferenceInput {
  key: UIBridgePreferenceKey;
  value: unknown;
}

export interface IUIBridgeService {
  getUIState(workspaceNameOrId?: string): Promise<IUIBridgeState>;
  openTiddler(title: string, workspaceNameOrId?: string): Promise<IUIBridgeState>;
  closeTiddler(title: string, workspaceNameOrId?: string): Promise<IUIBridgeState>;
  focusTiddler(title: string, workspaceNameOrId?: string): Promise<IUIBridgeState>;
  setLayout(input: ISetLayoutInput): Promise<IUIBridgeState>;
  setPreference(input: ISetPreferenceInput): Promise<IUIBridgeState>;
}
