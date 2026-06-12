import { container } from '@services/container';
import { i18n } from '@services/libs/i18n';
import { t } from '@services/libs/i18n/placeholder';
import { logger } from '@services/libs/log';
import serviceIdentifier from '@services/serviceIdentifier';
import { UI_BRIDGE_PREFERENCE_ALLOW_LIST, type IUIBridgeService } from '@services/uiBridge/interface';
import { z } from 'zod/v4';
import { ACI_VERSION } from './aciSchema';
import { registerToolDefinition, type ToolExecutionResult } from './defineTool';

export const UIActionParameterSchema = z.object({
  toolListPosition: z.object({
    targetId: z.string(),
    position: z.enum(['before', 'after']).default('after'),
  }).optional(),
  toolResultDuration: z.number().optional().default(1),
}).meta({
  title: t('Schema.UIAction.Title'),
  description: t('Schema.UIAction.Description'),
});
export type UIActionParameter = z.infer<typeof UIActionParameterSchema>;

const UIActionToolSchema = z.object({
  operation: z.enum([
    'ui.open_tiddler',
    'ui.close_tiddler',
    'ui.focus_tiddler',
    'ui.set_layout',
    'ui.set_pref',
  ]),
  workspaceNameOrId: z.string().optional(),
  title: z.string().optional(),
  layoutKey: z.enum(['sidebar', 'tidgiMiniWindowShowSidebar', 'titleBar', 'notebookSidebar']).optional(),
  layoutValue: z.union([z.boolean(), z.string()]).optional(),
  prefKey: z.enum(UI_BRIDGE_PREFERENCE_ALLOW_LIST).optional(),
  prefValue: z.unknown().optional(),
}).meta({
  title: 'ui.action',
  description: 'Mutate UI state for collaboration, including opening/closing/focusing tiddlers and updating layout/preferences.',
});

type UIActionToolParameters = z.infer<typeof UIActionToolSchema>;

async function executeUIAction(parameters: UIActionToolParameters): Promise<ToolExecutionResult> {
  const uiBridge = container.get<IUIBridgeService>(serviceIdentifier.UIBridge);
  try {
    let state;
    switch (parameters.operation) {
      case 'ui.open_tiddler': {
        if (!parameters.title) {
          return { success: false, error: 'title is required for ui.open_tiddler' };
        }
        state = await uiBridge.openTiddler(parameters.title, parameters.workspaceNameOrId);
        break;
      }
      case 'ui.close_tiddler': {
        if (!parameters.title) {
          return { success: false, error: 'title is required for ui.close_tiddler' };
        }
        state = await uiBridge.closeTiddler(parameters.title, parameters.workspaceNameOrId);
        break;
      }
      case 'ui.focus_tiddler': {
        if (!parameters.title) {
          return { success: false, error: 'title is required for ui.focus_tiddler' };
        }
        state = await uiBridge.focusTiddler(parameters.title, parameters.workspaceNameOrId);
        break;
      }
      case 'ui.set_layout': {
        if (!parameters.layoutKey) {
          return { success: false, error: 'layoutKey is required for ui.set_layout' };
        }
        state = await uiBridge.setLayout({
          workspaceNameOrId: parameters.workspaceNameOrId,
          layoutKey: parameters.layoutKey,
          value: parameters.layoutValue ?? true,
        });
        break;
      }
      case 'ui.set_pref': {
        if (!parameters.prefKey) {
          return { success: false, error: 'prefKey is required for ui.set_pref' };
        }
        state = await uiBridge.setPreference({
          key: parameters.prefKey,
          value: parameters.prefValue,
        });
        break;
      }
      default: {
        return {
          success: false,
          error: `Unsupported UI operation: ${parameters.operation}`,
        };
      }
    }
    return {
      success: true,
      data: JSON.stringify(state),
      metadata: {
        aciVersion: ACI_VERSION,
        operation: parameters.operation,
        workspaceId: state.workspaceId,
      },
    };
  } catch (error) {
    logger.error('UI action execution failed', { error, parameters });
    return {
      success: false,
      error: i18n.t('Tool.UIAction.Error.ExecutionFailed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

const uiActionDefinition = registerToolDefinition({
  toolId: 'uiAction',
  displayName: t('Schema.UIAction.Title'),
  description: t('Schema.UIAction.Description'),
  configSchema: UIActionParameterSchema,
  llmToolSchemas: {
    'ui.action': UIActionToolSchema,
  },
  onProcessPrompts({ config, injectToolList }) {
    if (!config.toolListPosition?.targetId) return;
    injectToolList({
      targetId: config.toolListPosition.targetId,
      position: config.toolListPosition.position || 'after',
      caption: 'UI action tools',
    });
  },
  async onResponseComplete({ toolCall, executeToolCall, agentFrameworkContext }) {
    if (!toolCall || toolCall.toolId !== 'ui.action') return;
    if (agentFrameworkContext.isCancelled()) {
      logger.debug('ui.action cancelled', { agentId: agentFrameworkContext.agent.id });
      return;
    }
    await executeToolCall('ui.action', executeUIAction);
  },
});

export const uiActionTool = uiActionDefinition.tool;
