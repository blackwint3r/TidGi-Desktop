import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryAssertions = vi.fn();
const writeWithPolicy = vi.fn();
const deleteWithPolicy = vi.fn();
const patchWithPolicy = vi.fn();
const queryWithEye = vi.fn();
const buildQueryGraph = vi.fn();
const writeTriple = vi.fn();
const listKnowledgeGraphs = vi.fn();
const getCurrentKnowledgeGraph = vi.fn();
const resolveKnowledgeGraph = vi.fn();
const setCurrentKnowledgeGraph = vi.fn();
const clearSelectedGraph = vi.fn();

vi.mock('../../knowledgeGraph/operations', () => ({
  queryAssertions,
  writeWithPolicy,
  deleteWithPolicy,
  patchWithPolicy,
}));

vi.mock('../../knowledgeGraph/eyeReasoner', () => ({
  queryWithEye,
}));

vi.mock('../../knowledgeGraph/index', () => ({
  buildQueryGraph,
  writeTriple,
  updateSystemState: vi.fn(),
  getSystemState: vi.fn(() => ({})),
}));

vi.mock('../../knowledgeGraph/graphRegistry', () => ({
  listKnowledgeGraphs,
  getCurrentKnowledgeGraph,
  resolveKnowledgeGraph,
  setCurrentKnowledgeGraph,
  clearSelectedGraph,
}));

vi.mock('@services/container', () => ({
  container: {
    get: vi.fn(),
  },
}));

const triple = {
  subject: 'http://worldshell.online/ghost/kb/A',
  predicate: 'http://worldshell.online/ghost/kb/p',
  object: 'value',
  isLiteral: true,
};

describe('kbTools operation layer integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryAssertions.mockResolvedValue({
      graph: 'workspace',
      assertions: [{ triple, kind: 'explicit', writable: true, provenance: [] }],
    });
    resolveKnowledgeGraph.mockResolvedValue({
      workspaceId: 'workspace',
      name: 'Test Graph',
      graphUri: 'http://worldshell.online/ghost/kb/Test%20Graph',
      prefix: 'http://worldshell.online/ghost/kb/',
      active: true,
      isSubWiki: false,
      source: 'argument',
    });
  });

  it('registers explicit query tools and removes deprecated query entrypoints', async () => {
    const { KB_TOOLS, KB_TOOL_SCHEMAS } = await import('../kbTools');
    const toolNames = KB_TOOLS.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining(['kb_query_graph', 'kb_find_resources', 'kb_get_resource', 'kb_explain', 'kb_eye_query', 'kb_patch']));
    expect(toolNames).not.toContain('kb_query');
    expect(toolNames).not.toContain('kb_get_entry');
    expect(toolNames).not.toContain('kb_query_triples');
    expect(toolNames).not.toContain('kb_find_nodes');
    expect(toolNames).not.toContain('kb_get_node');
    expect('kb_query' in KB_TOOL_SCHEMAS).toBe(false);
    expect('kb_get_entry' in KB_TOOL_SCHEMAS).toBe(false);
    expect('kb_query_triples' in KB_TOOL_SCHEMAS).toBe(false);
    expect('kb_find_nodes' in KB_TOOL_SCHEMAS).toBe(false);
    expect('kb_get_node' in KB_TOOL_SCHEMAS).toBe(false);
    expect(KB_TOOL_SCHEMAS.kb_query_graph.safeParse({ subject: 'A', limit: 10 }).success).toBe(true);
    expect(KB_TOOL_SCHEMAS.kb_find_resources.safeParse({ where: [{ predicate: '状态', object: '成熟' }] }).success).toBe(true);
    expect(KB_TOOL_SCHEMAS.kb_get_resource.safeParse({ resource: 'A' }).success).toBe(true);
    expect(KB_TOOL_SCHEMAS.kb_eye_query.safeParse({ query: '@prefix kb: <http://worldshell.online/ghost/kb/> .\n{ ?s kb:p ?o } => { ?s kb:matched true } .' }).success).toBe(true);
    expect(KB_TOOL_SCHEMAS.kb_patch.safeParse({ insert: '@prefix kb: <http://worldshell.online/ghost/kb/> .\nkb:A kb:p "value" .' }).success).toBe(true);
    expect(KB_TOOL_SCHEMAS.kb_explain.safeParse({ subject: triple.subject, rules: ['OldRule'] }).success).toBe(false);
  });

  it('registers graph registry tools and returns graph metadata', async () => {
    const current = {
      workspaceId: 'workspace',
      name: 'Test Graph',
      graphUri: 'http://worldshell.online/ghost/kb/Test%20Graph',
      prefix: 'http://worldshell.online/ghost/kb/',
      active: true,
      isSubWiki: false,
      source: 'active',
    };
    listKnowledgeGraphs.mockResolvedValue([current]);
    getCurrentKnowledgeGraph.mockResolvedValue(current);

    const { KB_TOOLS, KB_TOOL_SCHEMAS, callKbTool } = await import('../kbTools');

    expect(KB_TOOLS.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'kb_list_graphs',
      'kb_get_current_graph',
      'kb_set_current_graph',
    ]));
    expect(KB_TOOL_SCHEMAS.kb_set_current_graph.safeParse({ graph: 'Test Graph' }).success).toBe(true);
    await expect(callKbTool('kb_list_graphs', {})).resolves.toEqual({ current, graphs: [current] });
  });

  it('sets current graph through graph registry', async () => {
    const selected = {
      workspaceId: 'workspace',
      name: 'Test Graph',
      graphUri: 'http://worldshell.online/ghost/kb/Test%20Graph',
      prefix: 'http://worldshell.online/ghost/kb/',
      active: true,
      isSubWiki: false,
      source: 'selected',
    };
    setCurrentKnowledgeGraph.mockResolvedValue(selected);

    const { callKbTool } = await import('../kbTools');

    await expect(callKbTool('kb_set_current_graph', { graph: 'Test Graph' })).resolves.toEqual(selected);
    expect(setCurrentKnowledgeGraph).toHaveBeenCalledWith('Test Graph');
  });

  it('returns paginated RDF-star N3 from kb_query_graph', async () => {
    const { callKbTool } = await import('../kbTools');

    const result = await callKbTool('kb_query_graph', { graph: 'workspace', subject: triple.subject, limit: 10 }) as string;

    expect(queryAssertions).toHaveBeenCalledWith('workspace', expect.objectContaining({ subject: triple.subject }));
    expect(result).toContain('@prefix kb: <http://worldshell.online/ghost/kb/> .');
    expect(result).toContain('<< kb:A kb:p "value" >>');
    expect(result).toContain('kb:writable true');
    expect(result).toContain('kb:assertionKind kb:Explicit');
  });

  it('normalizes local refs before querying graph text', async () => {
    const { callKbTool } = await import('../kbTools');

    await callKbTool('kb_query_graph', { graph: 'workspace', subject: 'A', predicate: 'kb:p' });

    expect(queryAssertions).toHaveBeenCalledWith('workspace', expect.objectContaining({
      subject: 'http://worldshell.online/ghost/kb/A',
      predicate: 'http://worldshell.online/ghost/kb/p',
    }));
  });

  it('finds resources by property conditions and returns RDF-star context', async () => {
    const secondTriple = {
      subject: 'http://worldshell.online/ghost/kb/B',
      predicate: 'http://worldshell.online/ghost/kb/p',
      object: 'other',
      isLiteral: true,
    };
    queryAssertions.mockResolvedValue({
      graph: 'workspace',
      assertions: [
        { triple, kind: 'explicit', writable: true, provenance: [] },
        { triple: secondTriple, kind: 'explicit', writable: true, provenance: [] },
      ],
    });

    const { callKbTool } = await import('../kbTools');
    const result = await callKbTool('kb_find_resources', {
      graph: 'workspace',
      where: [{ predicate: 'p', object: 'value' }],
    }) as string;

    expect(queryAssertions).toHaveBeenCalledWith('workspace', { includeSystemState: false });
    expect(result).toContain('<< kb:A kb:p "value" >>');
    expect(result).not.toContain('kb:B kb:p "other"');
  });

  it('keeps non-ASCII property refs unencoded when matching resource conditions', async () => {
    const statusTriple = {
      subject: 'http://worldshell.online/ghost/kb/A',
      predicate: 'http://worldshell.online/ghost/kb/状态',
      object: '成熟',
      isLiteral: true,
    };
    queryAssertions.mockResolvedValue({
      graph: 'workspace',
      assertions: [{ triple: statusTriple, kind: 'explicit', writable: true, provenance: [] }],
    });

    const { callKbTool } = await import('../kbTools');
    const result = await callKbTool('kb_find_resources', {
      graph: 'workspace',
      where: [{ predicate: '状态', object: '成熟' }],
    }) as string;

    expect(result).toContain('<< kb:A kb:状态 "成熟" >>');
  });

  it('gets one resource with outbound and inbound assertions as RDF-star text', async () => {
    const inboundTriple = {
      subject: 'http://worldshell.online/ghost/kb/B',
      predicate: 'http://worldshell.online/ghost/kb/linksTo',
      object: 'http://worldshell.online/ghost/kb/A',
      isLiteral: false,
    };
    queryAssertions.mockResolvedValue({
      graph: 'workspace',
      assertions: [
        { triple, kind: 'explicit', writable: true, provenance: [] },
        { triple: inboundTriple, kind: 'explicit', writable: true, provenance: [] },
      ],
    });

    const { callKbTool } = await import('../kbTools');
    const result = await callKbTool('kb_get_resource', { graph: 'workspace', resource: 'A' }) as string;

    expect(queryAssertions).toHaveBeenCalledWith('workspace', { includeSystemState: false });
    expect(result).toContain('<< kb:A kb:p "value" >>');
    expect(result).toContain('<< kb:B kb:linksTo kb:A >>');
  });

  it('runs strict N3 EYE query against graph facts', async () => {
    buildQueryGraph.mockResolvedValue({ id: 'workspace', triples: [triple] });
    queryWithEye.mockResolvedValue('@prefix kb: <http://worldshell.online/ghost/kb/> .\nkb:A kb:matched true .');

    const { callKbTool } = await import('../kbTools');
    const query = '@prefix kb: <http://worldshell.online/ghost/kb/> .\n{ ?s kb:p "value" } => { ?s kb:matched true } .';
    const result = await callKbTool('kb_eye_query', { graph: 'workspace', query }) as string;

    expect(buildQueryGraph).toHaveBeenCalledWith('workspace', { includeSystemState: false });
    expect(queryWithEye).toHaveBeenCalledWith({ id: 'workspace', triples: [triple] }, query);
    expect(result).toContain('kb:A kb:matched true');
  });

  it('applies strict Turtle/N3 patch through policy layer', async () => {
    patchWithPolicy.mockResolvedValue({
      success: true,
      graph: 'workspace',
      operations: [
        {
          action: 'write',
          triple,
          decision: { allowed: true, action: 'write', reason: 'ok', target: triple, matchingAssertions: [] },
        },
      ],
    });

    const { callKbTool } = await import('../kbTools');
    const result = await callKbTool('kb_patch', {
      graph: 'workspace',
      insert: '@prefix kb: <http://worldshell.online/ghost/kb/> .\nkb:A kb:p "value" .',
    }) as { success: boolean; operations: Array<{ allowed: boolean; reason: string }> };

    expect(patchWithPolicy).toHaveBeenCalledWith('workspace', {
      delete: [],
      insert: [expect.objectContaining(triple)],
    });
    expect(result.success).toBe(true);
    expect(result.operations[0]).toEqual(expect.objectContaining({ allowed: true, reason: 'ok' }));
  });

  it('rejects RDF/N3 patch input without explicit prefixes', async () => {
    const { callKbTool } = await import('../kbTools');

    await expect(callKbTool('kb_patch', {
      graph: 'workspace',
      insert: 'kb:A kb:p "value" .',
    })).rejects.toThrow();
  });

  it('normalizes local refs before writing triples', async () => {
    writeWithPolicy.mockResolvedValue({ success: true, decision: { allowed: true, action: 'write', reason: 'ok', target: triple, matchingAssertions: [] } });

    const { callKbTool } = await import('../kbTools');
    const result = await callKbTool('kb_write', {
      graph: 'workspace',
      subject: 'A',
      predicate: 'kb:p',
      object: 'B',
      isLiteral: false,
    }) as { subject: string; predicate: string; object: string };

    expect(writeWithPolicy).toHaveBeenCalledWith('workspace', expect.objectContaining({
      subject: 'http://worldshell.online/ghost/kb/A',
      predicate: 'http://worldshell.online/ghost/kb/p',
      object: 'http://worldshell.online/ghost/kb/B',
      isLiteral: false,
    }));
    expect(result).toEqual(expect.objectContaining({
      subject: 'http://worldshell.online/ghost/kb/A',
      predicate: 'http://worldshell.online/ghost/kb/p',
      object: 'http://worldshell.online/ghost/kb/B',
    }));
  });

  it('returns policy rejection instead of throwing for kb_write', async () => {
    writeWithPolicy.mockResolvedValue({
      success: false,
      error: 'rejected',
      decision: {
        allowed: false,
        action: 'write',
        reason: 'derived',
        target: triple,
        matchingAssertions: [],
        alternatives: [],
      },
    });

    const { callKbTool } = await import('../kbTools');
    const result = await callKbTool('kb_write', { graph: 'workspace', ...triple }) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toBe('rejected');
  });
});