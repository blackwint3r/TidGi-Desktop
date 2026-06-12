import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Graph, Triple } from '../index';
import { createDerivedAssertion, createExplicitAssertion } from '../assertions';

const loadGraph = vi.fn();
const injectSystemStateTriples = vi.fn();
const writeTriple = vi.fn();
const deleteTriple = vi.fn();
const inferAssertions = vi.fn();

vi.mock('../index', () => ({
  loadGraph,
  injectSystemStateTriples,
  writeTriple,
  deleteTriple,
}));

vi.mock('../reasoner', () => ({
  explicitAssertions: (graph: Graph) => graph.triples.map(createExplicitAssertion),
  inferAssertions,
}));

const explicitTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/A',
  predicate: 'http://worldshell.online/ghost/kb/p',
  object: 'value',
  isLiteral: true,
};

const readonlyCreatedTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/A',
  predicate: 'http://worldshell.online/ghost/kb/created',
  object: '2026-01-01T00:00:00.000Z',
  isLiteral: true,
  datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
};

const derivedTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/A',
  predicate: 'http://worldshell.online/ghost/kb/derived',
  object: 'value',
  isLiteral: true,
};

const virtualTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/',
  predicate: 'http://worldshell.online/ghost/kb/current-workspace',
  object: 'http://worldshell.online/ghost/kb/workspace',
  isLiteral: false,
};

function setupGraph(triples: Triple[] = [explicitTriple]): void {
  loadGraph.mockResolvedValue({ id: 'workspace', triples });
  injectSystemStateTriples.mockImplementation((graph: Graph) => ({
    ...graph,
    triples: [...graph.triples, virtualTriple],
  }));
}

describe('knowledge operation layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGraph();
    inferAssertions.mockResolvedValue([]);
    writeTriple.mockResolvedValue({ success: true });
    deleteTriple.mockResolvedValue({ success: true });
  });

  it('returns explicit and virtual assertions from queryAssertions', async () => {
    const { queryAssertions } = await import('../operations');
    const result = await queryAssertions('workspace', {});

    expect(result.assertions.map((assertion) => assertion.kind)).toEqual(['explicit', 'virtual']);
    expect(result.rdfStar).toContain('<< kb:A kb:p "value" >>');
    expect(result.rdfStar).toContain('kb:writable true');
    expect(result.rdfStar).toContain('kb:assertionKind kb:Explicit');
    expect(result.rdfStar).toContain('kb:assertionKind kb:Virtual');
  });

  it('allows writing a new explicit fact', async () => {
    const { proposeWrite } = await import('../operations');
    const decision = await proposeWrite('workspace', { ...explicitTriple, object: 'new' });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain('可以作为显式事实写入');
  });

  it('rejects writing a readonly explicit system field through update decisions', async () => {
    setupGraph([readonlyCreatedTriple]);

    const { proposeWrite } = await import('../operations');
    const decision = await proposeWrite('workspace', readonlyCreatedTriple);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.matchingAssertions[0].kind).toBe('explicit');
      expect(decision.matchingAssertions[0].writable).toBe(false);
      expect(decision.reason).toContain('system-managed-field');
    }
  });

  it('rejects deleting a readonly explicit identity field through update decisions', async () => {
    const titleTriple: Triple = {
      ...explicitTriple,
      predicate: 'http://worldshell.online/ghost/kb/title',
      object: 'A',
    };
    setupGraph([titleTriple]);

    const { proposeDelete } = await import('../operations');
    const decision = await proposeDelete('workspace', titleTriple);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.matchingAssertions[0].kind).toBe('explicit');
      expect(decision.matchingAssertions[0].writable).toBe(false);
      expect(decision.reason).toContain('identity-local-name');
    }
  });

  it('rejects writing a derived assertion', async () => {
    inferAssertions.mockResolvedValue([createDerivedAssertion(derivedTriple, ['Rule:derived'])]);

    const { proposeWrite } = await import('../operations');
    const decision = await proposeWrite('workspace', derivedTriple);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.matchingAssertions[0].kind).toBe('derived');
      expect(decision.alternatives).toContain('修改产生该结论的基础事实。');
    }
  });

  it('rejects deleting a virtual assertion', async () => {
    const { proposeDelete } = await import('../operations');
    const decision = await proposeDelete('workspace', virtualTriple);

    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.matchingAssertions[0].kind).toBe('virtual');
  });

  it('preflights the full patch before applying any operation', async () => {
    const readonlyPatchTriple: Triple = {
      ...explicitTriple,
      predicate: 'http://worldshell.online/ghost/kb/title',
      object: 'A',
    };
    setupGraph([readonlyPatchTriple]);

    const { patchWithPolicy } = await import('../operations');
    const result = await patchWithPolicy('workspace', {
      delete: [readonlyPatchTriple],
      insert: [{ ...explicitTriple, object: 'new' }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('identity-local-name');
    expect(deleteTriple).not.toHaveBeenCalled();
    expect(writeTriple).not.toHaveBeenCalled();
  });

  it('applies allowed patch operations in delete-then-insert order', async () => {
    const { patchWithPolicy } = await import('../operations');
    const nextTriple = { ...explicitTriple, object: 'next' };
    const result = await patchWithPolicy('workspace', {
      delete: [explicitTriple],
      insert: [nextTriple],
    });

    expect(result.success).toBe(true);
    expect(deleteTriple).toHaveBeenCalledWith(explicitTriple, 'workspace');
    expect(writeTriple).toHaveBeenCalledWith(nextTriple, 'workspace');
    expect(result.operations.map((operation) => operation.action)).toEqual(['delete', 'write']);
  });
});