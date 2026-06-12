import { ACI_VERSION } from '@services/agentInstance/tools/aciSchema';
import { container } from '@services/container';
import { t } from '@services/libs/i18n/placeholder';
import { logger } from '@services/libs/log';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IMCPServerService } from '@services/mcpServer/interface';
import { z } from 'zod/v4';
import { registerToolDefinition, type ToolExecutionResult } from './defineTool';

export const ModelContextProtocolParameterSchema = z.object({
  id: z.string().meta({
    title: t('Schema.MCP.IdTitle'),
    description: t('Schema.MCP.Id'),
  }),
  timeoutSecond: z.number().optional().meta({
    title: t('Schema.MCP.TimeoutSecondTitle'),
    description: t('Schema.MCP.TimeoutSecond'),
  }),
  timeoutMessage: z.string().optional().meta({
    title: t('Schema.MCP.TimeoutMessageTitle'),
    description: t('Schema.MCP.TimeoutMessage'),
  }),
  position: z.enum(['before', 'after']).meta({
    title: t('Schema.Position.TypeTitle'),
    description: t('Schema.Position.Type'),
  }),
  targetId: z.string().meta({
    title: t('Schema.Position.TargetIdTitle'),
    description: t('Schema.Position.TargetId'),
  }),
}).meta({
  title: t('Schema.MCP.Title'),
  description: t('Schema.MCP.Description'),
});

const MCPServerInfoToolSchema = z.object({}).meta({
  title: 'mcp.get_server_info',
  description: 'Get MCP server endpoint and ACI version used by TidGi.',
});

export type ModelContextProtocolParameter = z.infer<typeof ModelContextProtocolParameterSchema>;

export function getModelContextProtocolParameterSchema() {
  return ModelContextProtocolParameterSchema;
}

async function executeMCPGetServerInfo(): Promise<ToolExecutionResult> {
  const mcpService = container.get<IMCPServerService>(serviceIdentifier.MCPServer);
  return {
    success: true,
    data: JSON.stringify({
      endpoint: mcpService.getServerEndpoint(),
      running: mcpService.isRunning(),
      aciVersion: ACI_VERSION,
    }),
    metadata: {
      aciVersion: ACI_VERSION,
    },
  };
}

const mcpToolDefinition = registerToolDefinition({
  toolId: 'modelContextProtocol',
  displayName: t('Schema.MCP.Title'),
  description: t('Schema.MCP.Description'),
  configSchema: ModelContextProtocolParameterSchema,
  llmToolSchemas: {
    'mcp.get_server_info': MCPServerInfoToolSchema,
  },
  onProcessPrompts({ config, injectToolList, injectContent }) {
    const mcpService = container.get<IMCPServerService>(serviceIdentifier.MCPServer);
    const endpoint = mcpService.getServerEndpoint();
    injectToolList({
      targetId: config.targetId,
      position: config.position,
      caption: 'MCP tools',
    });
    injectContent({
      targetId: config.targetId,
      position: config.position,
      caption: 'MCP endpoint',
      content: `MCP endpoint: ${endpoint ?? 'not-started'}\nACI version: ${ACI_VERSION}`,
    });
  },
  async onResponseComplete({ toolCall, executeToolCall, agentFrameworkContext }) {
    if (!toolCall || toolCall.toolId !== 'mcp.get_server_info') return;
    if (agentFrameworkContext.isCancelled()) {
      logger.debug('mcp.get_server_info cancelled', { agentId: agentFrameworkContext.agent.id });
      return;
    }
    await executeToolCall('mcp.get_server_info', executeMCPGetServerInfo);
  },
});

export const modelContextProtocolTool = mcpToolDefinition.tool;

/**
 * No-op for the local MCP Server architecture.
 * In this mode, TidGi exposes itself as an MCP server; no per-instance client cleanup needed.
 */
export async function cleanupMCPClient(_agentId: string): Promise<void> {
  // no-op
}
