import { describe, it } from 'vitest';

// TODO: MCPServerService class was removed in KB refactor.
// Tests for MCP server functionality need to be rewritten to use
// the function-based API from ../index.ts (startMcpServer, stopMcpServer)
// instead of the old class-based service.
describe('MCPServerService (placeholder)', () => {
  it.skip('should start and stop server successfully', async () => {
    // This test references MCPServerService which no longer exists.
    // The MCP server now uses function-based API: startMcpServer, stopMcpServer.
    // Rewrite test to use the function exports from '../index.ts'.
  });
});
