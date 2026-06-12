import http from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createMcpHttpServer } from '../server';

function request(
  server: http.Server,
  options: { method: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<{ statusCode: number; headers: IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += String(chunk);
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('MCP HTTP Server', () => {
  it('returns 401 for /mcp when token is required and empty (defense-in-depth)', async () => {
    const server = createMcpHttpServer({ requireToken: true, token: '' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await request(server, { method: 'POST', path: '/mcp', body: '{}' });
      expect(res.statusCode).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('returns 401 for /mcp when token is required and missing', async () => {
    const server = createMcpHttpServer({ requireToken: true, token: 'secret-token' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await request(server, { method: 'POST', path: '/mcp', body: '{}' });
      expect(res.statusCode).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('returns 401 for /mcp when token is required and invalid', async () => {
    const server = createMcpHttpServer({ requireToken: true, token: 'secret-token' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await request(server, {
        method: 'POST',
        path: '/mcp',
        headers: { Authorization: 'Bearer wrong-token' },
        body: '{}',
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('returns 200 for /mcp when token is valid via Bearer header', async () => {
    const server = createMcpHttpServer({ requireToken: true, token: 'secret-token' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await request(server, {
        method: 'POST',
        path: '/mcp',
        headers: { Authorization: 'Bearer secret-token' },
        body: '{}',
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('returns 200 for /mcp when token is valid via query parameter', async () => {
    const server = createMcpHttpServer({ requireToken: true, token: 'secret-token' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await request(server, {
        method: 'POST',
        path: '/mcp?token=secret-token',
        body: '{}',
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('returns 200 for /health without token even when token is required', async () => {
    const server = createMcpHttpServer({ requireToken: true, token: 'secret-token' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const res = await request(server, { method: 'GET', path: '/health' });
      expect(res.statusCode).toBe(200);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });

  it('handles initialize, initialized notification, and tools/list in one MCP session', async () => {
    const server = createMcpHttpServer({ requireToken: false, token: '' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const init = await request(server, {
        method: 'POST',
        path: '/mcp',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'vitest', version: '1.0.0' },
          },
        }),
      });
      expect(init.statusCode).toBe(200);
      const sessionId = init.headers['mcp-session-id'];
      expect(typeof sessionId).toBe('string');

      const initialized = await request(server, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Session-Id': sessionId as string,
          'Mcp-Protocol-Version': '2024-11-05',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      expect([200, 202]).toContain(initialized.statusCode);

      const tools = await request(server, {
        method: 'POST',
        path: '/mcp',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Session-Id': sessionId as string,
          'Mcp-Protocol-Version': '2024-11-05',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      expect(tools.statusCode).toBe(200);
      expect(tools.body).not.toContain('Server not initialized');
      expect(tools.body).not.toContain('Session not found');
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        })
      );
    }
  });
});
