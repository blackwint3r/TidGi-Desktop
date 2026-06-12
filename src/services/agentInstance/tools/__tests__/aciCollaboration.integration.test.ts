import { WikiChannel } from '@/constants/channels';
import { container } from '@services/container';
import type { IPromptConcatTool } from '@services/agentInstance/promptConcat/promptConcatSchema';
import type { AIStreamResponse } from '@services/externalAPI/interface';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IUIBridgeService } from '@services/uiBridge/interface';
import type { IWikiService } from '@services/wiki/interface';
import { describe, expect, it, vi } from 'vitest';
import type { AgentFrameworkContext } from '../../agentFrameworks/utilities/type';
import type { AgentInstance } from '../../interface';
import { createAgentFrameworkHooks } from '../index';
import type { AIResponseContext, ToolActions } from '../types';
import { uiActionTool } from '../uiAction';
import { wikiOperationTool } from '../wikiOperation';
import { wikiSearchTool } from '../wikiSearch';

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

describe('ACI collaboration integration', () => {
  it('supports kb.search -> kb.write -> ui.open_tiddler sequence', async () => {
    const hooks = createAgentFrameworkHooks();
    wikiSearchTool(hooks);
    wikiOperationTool(hooks);
    uiActionTool(hooks);

    const wikiService = container.get<Partial<IWikiService>>(serviceIdentifier.Wiki);
    const uiBridge = container.get<Partial<IUIBridgeService>>(serviceIdentifier.UIBridge);

    const agentFrameworkContext = makeAgentFrameworkContext();
    const plugins: IPromptConcatTool[] = [
      { id: 'wiki-search-plugin', toolId: 'wikiSearch', wikiSearchParam: { toolResultDuration: 1 } } as unknown as IPromptConcatTool,
      { id: 'wiki-operation-plugin', toolId: 'wikiOperation', wikiOperationParam: { toolResultDuration: 1 } } as unknown as IPromptConcatTool,
      { id: 'ui-action-plugin', toolId: 'uiAction', uiActionParam: { toolResultDuration: 1 } } as unknown as IPromptConcatTool,
    ];

    const searchContent = `<tool_use name="wiki-search">${JSON.stringify({
      workspaceName: 'Test Wiki 1',
      searchType: 'filter',
      filter: '[tag[note]]',
      limit: 3,
    })}</tool_use>`;
    agentFrameworkContext.agent.messages.push({
      id: 'assistant-1',
      agentId: agentFrameworkContext.agent.id,
      role: 'assistant',
      content: searchContent,
      modified: new Date(),
    });
    await hooks.responseComplete.promise({
      agentFrameworkContext,
      toolConfig: plugins[0]!,
      agentFrameworkConfig: { plugins },
      response: { requestId: 'r1', content: searchContent, status: 'done' } as AIStreamResponse,
      actions: {} as ToolActions,
      requestId: 'r1',
      isFinal: true,
    } as AIResponseContext);
    expect(wikiService.wikiOperationInServer).toHaveBeenCalledWith(
      WikiChannel.runFilter,
      'test-wiki-1',
      ['[tag[note]]'],
    );

    const writeContent = `<tool_use name="wiki-operation">${JSON.stringify({
      workspaceName: 'Test Wiki 1',
      operation: WikiChannel.addTiddler,
      title: '协作结果',
      text: '由 Agent 生成的内容',
      extraMeta: '{}',
      options: '{}',
    })}</tool_use>`;
    agentFrameworkContext.agent.messages.push({
      id: 'assistant-2',
      agentId: agentFrameworkContext.agent.id,
      role: 'assistant',
      content: writeContent,
      modified: new Date(),
    });
    await hooks.responseComplete.promise({
      agentFrameworkContext,
      toolConfig: plugins[1]!,
      agentFrameworkConfig: { plugins },
      response: { requestId: 'r2', content: writeContent, status: 'done' } as AIStreamResponse,
      actions: {} as ToolActions,
      requestId: 'r2',
      isFinal: true,
    } as AIResponseContext);
    expect(wikiService.wikiOperationInServer).toHaveBeenCalledWith(
      WikiChannel.addTiddler,
      'test-wiki-1',
      ['协作结果', '由 Agent 生成的内容', '{}', '{"withDate":true}'],
    );

    const uiOpenContent = `<tool_use name="ui.action">${JSON.stringify({
      operation: 'ui.open_tiddler',
      workspaceNameOrId: 'Test Wiki 1',
      title: '协作结果',
    })}</tool_use>`;
    agentFrameworkContext.agent.messages.push({
      id: 'assistant-3',
      agentId: agentFrameworkContext.agent.id,
      role: 'assistant',
      content: uiOpenContent,
      modified: new Date(),
    });
    await hooks.responseComplete.promise({
      agentFrameworkContext,
      toolConfig: plugins[2]!,
      agentFrameworkConfig: { plugins },
      response: { requestId: 'r3', content: uiOpenContent, status: 'done' } as AIStreamResponse,
      actions: {} as ToolActions,
      requestId: 'r3',
      isFinal: true,
    } as AIResponseContext);
    expect(uiBridge.openTiddler).toHaveBeenCalledWith('协作结果', 'Test Wiki 1');

    expect(agentFrameworkContext.agent.messages.filter(m => m.metadata?.isToolResult).length).toBeGreaterThanOrEqual(3);
  });
});
