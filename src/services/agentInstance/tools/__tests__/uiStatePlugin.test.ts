import { container } from '@services/container';
import type { IPromptConcatTool } from '@services/agentInstance/promptConcat/promptConcatSchema';
import type { AIStreamResponse } from '@services/externalAPI/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IUIBridgeService } from '@services/uiBridge/interface';
import { describe, expect, it } from 'vitest';
import type { AgentFrameworkContext } from '../../agentFrameworks/utilities/type';
import type { AgentInstance } from '../../interface';
import { createAgentFrameworkHooks } from '../index';
import type { AIResponseContext, ToolActions } from '../types';
import { uiStateTool } from '../uiState';

const makeAgentFrameworkContext = (agentId = 'test-agent'): AgentFrameworkContext => ({
  agent: {
    id: agentId,
    agentDefId: 'test-agent-def',
    messages: [],
    status: { state: 'working', modified: new Date() },
    created: new Date(),
  } as unknown as AgentInstance,
  agentDef: { id: 'test-agent-def', name: 'test-agent-def', agentFrameworkConfig: {} } as unknown as { id: string; name: string; agentFrameworkConfig: Record<string, unknown> },
  isCancelled: () => false,
});

describe('uiStateTool', () => {
  it('should execute ui.get_state successfully', async () => {
    const hooks = createAgentFrameworkHooks();
    uiStateTool(hooks);
    const uiBridge = container.get<Partial<IUIBridgeService>>(serviceIdentifier.UIBridge);

    const agentFrameworkContext = makeAgentFrameworkContext();
    const content = `<tool_use name="ui.get_state">${JSON.stringify({
      workspaceNameOrId: 'Test Wiki 1',
      includePreferences: true,
    })}</tool_use>`;
    agentFrameworkContext.agent.messages.push({
      id: 'm1',
      agentId: agentFrameworkContext.agent.id,
      role: 'assistant',
      content,
      modified: new Date(),
    });

    const responseContext: AIResponseContext = {
      agentFrameworkContext,
      toolConfig: {
        id: 'ui-state-plugin',
        toolId: 'uiState',
        uiStateParam: { toolResultDuration: 1 },
      } as unknown as IPromptConcatTool,
      agentFrameworkConfig: {
        plugins: [{
          id: 'ui-state-plugin',
          toolId: 'uiState',
          uiStateParam: { toolResultDuration: 1 },
        }],
      },
      response: { requestId: 'r-ui-state', content, status: 'done' } as AIStreamResponse,
      actions: {} as ToolActions,
      requestId: 'r-ui-state',
      isFinal: true,
    };

    await hooks.responseComplete.promise(responseContext);

    expect(uiBridge.getUIState).toHaveBeenCalledWith('Test Wiki 1');
    const toolResult = agentFrameworkContext.agent.messages.find(m => m.metadata?.isToolResult);
    expect(toolResult?.content).toContain('workspaceId');
    expect(responseContext.actions?.yieldNextRoundTo).toBe('self');
  });
});
