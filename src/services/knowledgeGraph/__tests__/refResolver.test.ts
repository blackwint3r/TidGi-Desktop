import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraphMetadata } from '../graphRegistry';

const resolveKnowledgeGraph = vi.fn();

vi.mock('../graphRegistry', () => ({
  resolveKnowledgeGraph,
}));

const graph: KnowledgeGraphMetadata = {
  workspaceId: 'workspace',
  name: 'Ghost Knowledge Base',
  graphUri: 'http://worldshell.online/ghost/kb/Ghost%20Knowledge%20Base',
  prefix: 'http://worldshell.online/ghost/kb/',
  active: true,
  isSubWiki: false,
};

describe('refResolver', () => {
  it('expands node local names with graph prefix', async () => {
    const { resolveNodeRef } = await import('../refResolver');
    const resolved = resolveNodeRef('GHOST', graph);

    expect(resolved).toEqual({
      input: 'GHOST',
      uri: 'http://worldshell.online/ghost/kb/GHOST',
      localName: 'GHOST',
      kind: 'node',
    });
  });

  it('expands kb CURIE property refs with the same resource IRI policy as nodes', async () => {
    const { resolveNodeRef, resolvePropertyRef } = await import('../refResolver');
    const property = resolvePropertyRef('kb:状态', graph);
    const node = resolveNodeRef('状态', graph);

    expect(property.uri).toBe('http://worldshell.online/ghost/kb/状态');
    expect(property.localName).toBe('状态');
    expect(property.kind).toBe('property');
    expect(property.uri).toBe(node.uri);
  });

  it('preserves Unicode resource names and escapes only syntax-unsafe characters', async () => {
    const { resolveNodeRef } = await import('../refResolver');
    const resolved = resolveNodeRef('买 自行车', graph);

    expect(resolved.uri).toBe('http://worldshell.online/ghost/kb/买%20自行车');
    expect(resolved.localName).toBe('买 自行车');
    expect(resolved.kind).toBe('node');
  });

  it('keeps absolute URIs unchanged', async () => {
    const { resolveNodeRef } = await import('../refResolver');
    const resolved = resolveNodeRef('http://example.test/External', graph);

    expect(resolved.uri).toBe('http://example.test/External');
    expect(resolved.localName).toBeNull();
  });

  it('delegates graph refs to graph registry', async () => {
    resolveKnowledgeGraph.mockResolvedValue({ ...graph, source: 'argument' });

    const { resolveGraphRef } = await import('../refResolver');
    const resolved = await resolveGraphRef('Ghost Knowledge Base');

    expect(resolveKnowledgeGraph).toHaveBeenCalledWith('Ghost Knowledge Base');
    expect(resolved.workspaceId).toBe('workspace');
  });
});