import { container } from '@services/container';
import type { IPromptConcatTool } from '@services/agentInstance/promptConcat/promptConcatSchema';
import type { AIStreamResponse } from '@services/externalAPI/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IUIBridgeService } from '@services/uiBridge/interface';
import { describe, expect, it, vi } from 'vitest';
import type { AgentFrameworkContext } from '../../agentFrameworks/utilities/type';
import type { AgentInstance } from '../../interface';
import { createAgentFrameworkHooks } from '../index';
import type { AIResponseContext, ToolActions } from '../types';
import { uiActionTool } from '../uiAction';

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

describe('uiActionTool', () => {
  it('should execute ui.open_tiddler and append tool result', async () => {
    const hooks = createAgentFrameworkHooks();
    uiActionTool(hooks);
    const uiBridge = container.get<Partial<IUIBridgeService>>(serviceIdentifier.UIBridge);

    const agentFrameworkContext = makeAgentFrameworkContext();
    const content = `<tool_use name="ui.action">${JSON.stringify({
      operation: 'ui.open_tiddler',
      workspaceNameOrId: 'Test Wiki 1',
      title: 'Daily Note',
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
        id: 'ui-action-plugin',
        toolId: 'uiAction',
        uiActionParam: { toolResultDuration: 1 },
      } as unknown as IPromptConcatTool,
      agentFrameworkConfig: {
        plugins: [{
          id: 'ui-action-plugin',
          toolId: 'uiAction',
          uiActionParam: { toolResultDuration: 1 },
        }],
      },
      response: { requestId: 'r-ui-action', content, status: 'done' } as AIStreamResponse,
      actions: {} as ToolActions,
      requestId: 'r-ui-action',
      isFinal: true,
    };

    await hooks.responseComplete.promise(responseContext);

    expect(uiBridge.openTiddler).toHaveBeenCalledWith('Daily Note', 'Test Wiki 1');
    expect(agentFrameworkContext.agent.messages.some(m => m.metadata?.isToolResult)).toBe(true);
    expect(responseContext.actions?.yieldNextRoundTo).toBe('self');
  });

  it('should return error result when required field is missing', async () => {
    const hooks = createAgentFrameworkHooks();
    uiActionTool(hooks);

    const agentFrameworkContext = makeAgentFrameworkContext();
    const content = `<tool_use name="ui.action">${JSON.stringify({
      operation: 'ui.open_tiddler',
      workspaceNameOrId: 'Test Wiki 1',
    })}</tool_use>`;
    agentFrameworkContext.agent.messages.push({
      id: 'm2',
      agentId: agentFrameworkContext.agent.id,
      role: 'assistant',
      content,
      modified: new Date(),
    });

    const responseContext: AIResponseContext = {
      agentFrameworkContext,
      toolConfig: {
        id: 'ui-action-plugin',
        toolId: 'uiAction',
        uiActionParam: { toolResultDuration: 1 },
      } as unknown as IPromptConcatTool,
      agentFrameworkConfig: {
        plugins: [{
          id: 'ui-action-plugin',
          toolId: 'uiAction',
          uiActionParam: { toolResultDuration: 1 },
        }],
      },
      response: { requestId: 'r-ui-action-err', content, status: 'done' } as AIStreamResponse,
      actions: {} as ToolActions,
      requestId: 'r-ui-action-err',
      isFinal: true,
    };

    await hooks.responseComplete.promise(responseContext);

    const toolResult = agentFrameworkContext.agent.messages.find(m => m.metadata?.isToolResult);
    expect(toolResult?.content).toContain('title is required');
    expect(toolResult?.metadata?.isError).toBe(true);
  });
});
