import { container } from '@services/container';
import { i18n } from '@services/libs/i18n';
import { t } from '@services/libs/i18n/placeholder';
import { logger } from '@services/libs/log';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IUIBridgeService } from '@services/uiBridge/interface';
import { z } from 'zod/v4';
import { ACI_VERSION } from './aciSchema';
import { registerToolDefinition, type ToolExecutionResult } from './defineTool';

export const UIStateParameterSchema = z.object({
  toolListPosition: z.object({
    targetId: z.string(),
    position: z.enum(['before', 'after']).default('after'),
  }).optional(),
  toolResultDuration: z.number().optional().default(1),
}).meta({
  title: t('Schema.UIState.Title'),
  description: t('Schema.UIState.Description'),
});
export type UIStateParameter = z.infer<typeof UIStateParameterSchema>;

const UIGetStateToolSchema = z.object({
  workspaceNameOrId: z.string().optional(),
  includePreferences: z.boolean().optional().default(true),
}).meta({
  title: 'ui.get_state',
  description: 'Get current UI state for active workspace: opened tiddlers, focused tiddler and preferences snapshot.',
});

type UIGetStateToolParameters = z.infer<typeof UIGetStateToolSchema>;

async function executeUIGetState(parameters: UIGetStateToolParameters): Promise<ToolExecutionResult> {
  try {
    const uiBridge = container.get<IUIBridgeService>(serviceIdentifier.UIBridge);
    const state = await uiBridge.getUIState(parameters.workspaceNameOrId);
    const data = parameters.includePreferences
      ? state
      : { ...state, preferences: {} };
    return {
      success: true,
      data: JSON.stringify(data),
      metadata: {
        aciVersion: ACI_VERSION,
        workspaceId: state.workspaceId,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: i18n.t('Tool.UIState.Error.ExecutionFailed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    };
  }
}

const uiStateDefinition = registerToolDefinition({
  toolId: 'uiState',
  displayName: t('Schema.UIState.Title'),
  description: t('Schema.UIState.Description'),
  configSchema: UIStateParameterSchema,
  llmToolSchemas: {
    'ui.get_state': UIGetStateToolSchema,
  },
  onProcessPrompts({ config, injectToolList }) {
    if (!config.toolListPosition?.targetId) return;
    injectToolList({
      targetId: config.toolListPosition.targetId,
      position: config.toolListPosition.position || 'after',
      caption: 'UI state tools',
    });
  },
  async onResponseComplete({ toolCall, executeToolCall, agentFrameworkContext }) {
    if (!toolCall || toolCall.toolId !== 'ui.get_state') return;
    if (agentFrameworkContext.isCancelled()) {
      logger.debug('ui.get_state cancelled', { agentId: agentFrameworkContext.agent.id });
      return;
    }
    await executeToolCall('ui.get_state', executeUIGetState);
  },
});

export const uiStateTool = uiStateDefinition.tool;
