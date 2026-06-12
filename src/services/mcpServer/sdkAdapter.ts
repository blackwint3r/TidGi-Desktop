/**
 * Thin adapter over @modelcontextprotocol/sdk.
 * SDK types (Server, etc.) must NOT leak into inversify-bound modules —
 * they conflict with inversify's global type namespace causing cascading
 * error-typed container operations. This module wraps the SDK so IoC files
 * only see a plain http.Server factory.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';

import { KB_TOOL_SCHEMAS, KB_TOOLS } from './kbTools';
import type { ToolInput } from './types';

function createMcpServerWithTools(): McpServer {
  const server = new McpServer(
    { name: 'ghost-kb-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  for (const tool of KB_TOOLS) {
    const schema = KB_TOOL_SCHEMAS[tool.name as keyof typeof KB_TOOL_SCHEMAS];
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: schema,
      },
      async (parameters: unknown) => {
        const { callKbTool } = await import('./kbTools');
        const result = await callKbTool(tool.name, parameters as ToolInput);
        return {
          content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
        };
      },
    );
  }
  return server;
}

export { createMcpServerWithTools, StreamableHTTPServerTransport };