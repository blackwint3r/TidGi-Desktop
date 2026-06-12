import { describe, expect, it, vi } from 'vitest';
import type { Graph, Triple } from '../index';

const inferWithEye = vi.fn();

vi.mock('../eyeReasoner', () => ({
  inferWithEye,
}));

const baseTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/Alice',
  predicate: 'http://worldshell.online/ghost/kb/tags',
  object: 'http://worldshell.online/ghost/kb/Project',
  isLiteral: false,
};

const derivedTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/Alice',
  predicate: 'http://worldshell.online/ghost/kb/relatedTo',
  object: 'http://worldshell.online/ghost/kb/Bob',
  isLiteral: false,
};

describe('reasoner assertion adapter', () => {
  it('returns derived assertions with EYE rule provenance', async () => {
    const baseGraph: Graph = { id: 'workspace', triples: [baseTriple] };
    inferWithEye.mockResolvedValueOnce({
      graph: { id: 'workspace', triples: [baseTriple, derivedTriple] },
      inferredTriples: [derivedTriple],
      rules: [{ title: 'Rule:related', subject: 'http://worldshell.online/ghost/kb/Rule%3Arelated', text: 'rule text' }],
    });

    const { inferAssertions } = await import('../reasoner');
    const assertions = await inferAssertions(baseGraph);

    expect(inferWithEye).toHaveBeenCalledWith(baseGraph);
    expect(assertions).toHaveLength(1);
    expect(assertions[0].triple).toEqual(derivedTriple);
    expect(assertions[0].kind).toBe('derived');
    expect(assertions[0].writable).toBe(false);
    expect(assertions[0].provenance).toEqual([
      { type: 'rule', title: 'Rule:related' },
      { type: 'readonly-policy', policy: 'derived-rule', field: 'relatedTo' },
    ]);
  });

  it('returns no assertions when EYE yields no inferred triples', async () => {
    const baseGraph: Graph = { id: 'workspace', triples: [baseTriple] };
    inferWithEye.mockResolvedValueOnce({ graph: baseGraph, inferredTriples: [], rules: [] });

    const { inferAssertions } = await import('../reasoner');
    const assertions = await inferAssertions(baseGraph);

    expect(assertions).toEqual([]);
  });
});