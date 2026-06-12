import { container } from '@services/container';
import { logger } from '@services/libs/log';
import type { IPreferenceService, IPreferences } from '@services/preferences/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IViewService } from '@services/view/interface';
import { WindowNames } from '@services/windows/WindowProperties';
import type { IWindowService } from '@services/windows/interface';
import type { IWorkspaceService } from '@services/workspaces/interface';
import { isWikiWorkspace, type IWorkspace } from '@services/workspaces/interface';
import type { IWorkspaceViewService } from '@services/workspacesView/interface';
import { inject, injectable } from 'inversify';
import { UI_BRIDGE_PREFERENCE_ALLOW_LIST, type ISetLayoutInput, type ISetPreferenceInput, type IUIBridgeService, type IUIBridgeState, type UIBridgePreferenceKey } from './interface';

@injectable()
export class UIBridgeService implements IUIBridgeService {
  constructor(
    @inject(serviceIdentifier.Workspace) private readonly workspaceService: IWorkspaceService,
    @inject(serviceIdentifier.WorkspaceView) private readonly workspaceViewService: IWorkspaceViewService,
    @inject(serviceIdentifier.View) private readonly viewService: IViewService,
    @inject(serviceIdentifier.Window) private readonly windowService: IWindowService,
    @inject(serviceIdentifier.Preference) private readonly preferenceService: IPreferenceService,
  ) {}

  public async getUIState(workspaceNameOrId?: string): Promise<IUIBridgeState> {
    const workspace = await this.resolveWorkspace(workspaceNameOrId);
    const { view, activeWindow } = await this.getWorkspaceView(workspace.id);
    const viewState = await this.getViewStateFromRenderer(view);
    const preferences = this.getPreferencesSnapshot();
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      activeWindow,
      openedTiddlers: viewState.openedTiddlers,
      activeTiddler: viewState.activeTiddler,
      sidebarVisible: viewState.sidebarVisible,
      sidebarTab: viewState.sidebarTab,
      notebookSidebar: viewState.notebookSidebar,
      preferences,
    };
  }

  public async openTiddler(title: string, workspaceNameOrId?: string): Promise<IUIBridgeState> {
    if (!title.trim()) {
      throw new Error('title is required to open tiddler');
    }
    const workspace = await this.resolveWorkspace(workspaceNameOrId);
    const { view } = await this.getWorkspaceView(workspace.id);
    await this.executeInView(view, ({ tiddlerTitle }) => `
      (() => {
        const tw = window.$tw;
        if (!tw || !tw.wiki) return;
        const title = ${JSON.stringify(title)};
        const storyList = tw.wiki.getTiddlerList("$:/StoryList");
        const next = Array.isArray(storyList) ? [...storyList] : [];
        const oldIndex = next.indexOf(title);
        if (oldIndex !== -1) {
          next.splice(oldIndex, 1);
        }
        next.unshift(title);
        tw.wiki.setText("$:/StoryList","list",undefined,next);
        tw.rootWidget?.dispatchEvent({ type: "tm-navigate", navigateTo: title });
      })();
    `, { tiddlerTitle: title });
    return await this.getUIState(workspace.id);
  }

  public async closeTiddler(title: string, workspaceNameOrId?: string): Promise<IUIBridgeState> {
    if (!title.trim()) {
      throw new Error('title is required to close tiddler');
    }
    const workspace = await this.resolveWorkspace(workspaceNameOrId);
    const { view } = await this.getWorkspaceView(workspace.id);
    await this.executeInView(view, () => `
      (() => {
        const tw = window.$tw;
        if (!tw || !tw.wiki) return;
        const title = ${JSON.stringify(title)};
        const storyList = tw.wiki.getTiddlerList("$:/StoryList");
        const next = (Array.isArray(storyList) ? storyList : []).filter((item) => item !== title);
        tw.wiki.setText("$:/StoryList","list",undefined,next);
      })();
    `);
    return await this.getUIState(workspace.id);
  }

  public async focusTiddler(title: string, workspaceNameOrId?: string): Promise<IUIBridgeState> {
    if (!title.trim()) {
      throw new Error('title is required to focus tiddler');
    }
    const workspace = await this.resolveWorkspace(workspaceNameOrId);
    await this.workspaceViewService.setActiveWorkspaceView(workspace.id);
    const { view } = await this.getWorkspaceView(workspace.id);
    await this.executeInView(view, () => `
      (() => {
        const tw = window.$tw;
        if (!tw || !tw.wiki) return;
        const title = ${JSON.stringify(title)};
        const storyList = tw.wiki.getTiddlerList("$:/StoryList");
        const next = Array.isArray(storyList) ? [...storyList] : [];
        const oldIndex = next.indexOf(title);
        if (oldIndex !== -1) {
          next.splice(oldIndex, 1);
        }
        next.unshift(title);
        tw.wiki.setText("$:/StoryList","list",undefined,next);
        tw.rootWidget?.dispatchEvent({ type: "tm-navigate", navigateTo: title });
      })();
    `);
    return await this.getUIState(workspace.id);
  }

  public async setLayout(input: ISetLayoutInput): Promise<IUIBridgeState> {
    const workspace = await this.resolveWorkspace(input.workspaceNameOrId);
    switch (input.layoutKey) {
      case 'sidebar':
      case 'tidgiMiniWindowShowSidebar':
      case 'titleBar': {
        await this.preferenceService.set(input.layoutKey, Boolean(input.value));
        await this.workspaceViewService.realignActiveWorkspace(workspace.id);
        break;
      }
      case 'notebookSidebar': {
        const { view } = await this.getWorkspaceView(workspace.id);
        await this.executeInView(view, () => `
          (() => {
            const tw = window.$tw;
            if (!tw || !tw.wiki) return;
            tw.wiki.setText("$:/state/notebook-sidebar","text",undefined,${JSON.stringify(String(input.value))});
          })();
        `);
        break;
      }
      default:
        throw new Error(`Unsupported layout key: ${String(input.layoutKey)}`);
    }
    return await this.getUIState(workspace.id);
  }

  public async setPreference(input: ISetPreferenceInput): Promise<IUIBridgeState> {
    if (!UI_BRIDGE_PREFERENCE_ALLOW_LIST.includes(input.key)) {
      throw new Error(`Preference key is not allowed for ACI write: ${String(input.key)}`);
    }
    await this.preferenceService.set(
      input.key,
      input.value as IPreferences[UIBridgePreferenceKey],
    );
    const workspace = await this.resolveWorkspace();
    return await this.getUIState(workspace.id);
  }

  private async resolveWorkspace(workspaceNameOrId?: string): Promise<IWorkspace> {
    if (!workspaceNameOrId) {
      const activeWorkspace = await this.workspaceService.getActiveWorkspace();
      if (activeWorkspace && isWikiWorkspace(activeWorkspace)) {
        return activeWorkspace;
      }
      throw new Error('No active wiki workspace found');
    }

    const workspaces = await this.workspaceService.getWorkspacesAsList();
    const found = workspaces.find(
      ws => isWikiWorkspace(ws) && (ws.id === workspaceNameOrId || ws.name === workspaceNameOrId),
    );
    if (!found || !isWikiWorkspace(found)) {
      throw new Error(`Workspace not found: ${workspaceNameOrId}`);
    }
    return found;
  }

  private async getWorkspaceView(workspaceId: string) {
    const isMiniOpen = await this.windowService.isTidgiMiniWindowOpen();
    const preferredWindow = isMiniOpen ? WindowNames.tidgiMiniWindow : WindowNames.main;
    const fallbackWindow = preferredWindow === WindowNames.main ? WindowNames.tidgiMiniWindow : WindowNames.main;
    const preferredView = this.viewService.getView(workspaceId, preferredWindow);
    if (preferredView) {
      return { view: preferredView, activeWindow: preferredWindow === WindowNames.main ? 'main' as const : 'tidgiMiniWindow' as const };
    }
    const fallbackView = this.viewService.getView(workspaceId, fallbackWindow);
    if (fallbackView) {
      return { view: fallbackView, activeWindow: fallbackWindow === WindowNames.main ? 'main' as const : 'tidgiMiniWindow' as const };
    }
    throw new Error(`No browser view found for workspace: ${workspaceId}`);
  }

  private async getViewStateFromRenderer(
    view: Electron.CrossProcessExports.WebContentsView,
  ): Promise<Pick<IUIBridgeState, 'openedTiddlers' | 'activeTiddler' | 'sidebarVisible' | 'sidebarTab' | 'notebookSidebar'>> {
    return await this.executeInView(view, () => `
      (() => {
        const tw = window.$tw;
        if (!tw || !tw.wiki) {
          return {
            openedTiddlers: [],
            activeTiddler: undefined,
            sidebarVisible: undefined,
            sidebarTab: undefined,
            notebookSidebar: undefined
          };
        }
        const openedTiddlers = tw.wiki.getTiddlerList("$:/StoryList");
        const historyList = tw.wiki.getTiddlerDataCached("$:/HistoryList", []);
        const lastHistory = Array.isArray(historyList) && historyList.length > 0 ? historyList[historyList.length - 1] : undefined;
        const activeTiddler = (lastHistory && typeof lastHistory.title === "string")
          ? lastHistory.title
          : (Array.isArray(openedTiddlers) && openedTiddlers.length > 0 ? openedTiddlers[0] : undefined);
        return {
          openedTiddlers: Array.isArray(openedTiddlers) ? openedTiddlers : [],
          activeTiddler,
          sidebarVisible: tw.wiki.getTiddlerText("$:/state/sidebar"),
          sidebarTab: tw.wiki.getTiddlerText("$:/state/tab/sidebar"),
          notebookSidebar: tw.wiki.getTiddlerText("$:/state/notebook-sidebar")
        };
      })();
    `);
  }

  private getPreferencesSnapshot(): Partial<IPreferences> {
    const preferences = this.preferenceService.getPreferences();
    return {
      sidebar: preferences.sidebar,
      tidgiMiniWindowShowSidebar: preferences.tidgiMiniWindowShowSidebar,
      titleBar: preferences.titleBar,
      tidgiMiniWindowAlwaysOnTop: preferences.tidgiMiniWindowAlwaysOnTop,
      alwaysOnTop: preferences.alwaysOnTop,
      themeSource: preferences.themeSource,
    };
  }

  private async executeInView<T>(
    view: Electron.CrossProcessExports.WebContentsView,
    scriptFactory: (args: Record<string, unknown>) => string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    try {
      const script = scriptFactory(args);
      return await view.webContents.executeJavaScript(script, true) as T;
    } catch (error) {
      logger.error('UI bridge executeInView failed', { error, args });
      throw error;
    }
  }
}

export function getUIBridgeServiceFromContainer(): IUIBridgeService {
  return container.get<IUIBridgeService>(serviceIdentifier.UIBridge);
}
