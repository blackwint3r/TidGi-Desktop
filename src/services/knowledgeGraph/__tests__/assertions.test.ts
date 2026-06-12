import { Parser } from 'n3';
import { describe, expect, it } from 'vitest';

import {
  assertionsToRdfStarN3,
  assertionToRdfStarN3,
  createDerivedAssertion,
  createExplicitAssertion,
  createVirtualAssertion,
  exactMatches,
  matchesAssertionPattern,
  tripleKey,
} from '../assertions';
import type { Triple } from '../index';

const triple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/Alice',
  predicate: 'http://worldshell.online/ghost/kb/tags',
  object: 'http://worldshell.online/ghost/kb/Project',
  isLiteral: false,
};

describe('knowledge assertions', () => {
  it('marks explicit assertions as writable with tiddler-field provenance', () => {
    const assertion = createExplicitAssertion(triple);

    expect(assertion.kind).toBe('explicit');
    expect(assertion.writable).toBe(true);
    expect(assertion.provenance).toEqual([{ type: 'tiddler-field', title: 'Alice', field: 'tags' }]);
  });

  it('marks explicit system-managed fields as non-writable', () => {
    const assertion = createExplicitAssertion({
      ...triple,
      predicate: 'http://worldshell.online/ghost/kb/created',
      object: '2026-01-01T00:00:00.000Z',
      isLiteral: true,
      datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
    });

    expect(assertion.kind).toBe('explicit');
    expect(assertion.writable).toBe(false);
    expect(assertion.provenance).toContainEqual({ type: 'readonly-policy', policy: 'system-managed-field', field: 'created' });
  });

  it('marks explicit identity local-name fields as non-writable', () => {
    const assertion = createExplicitAssertion({
      ...triple,
      predicate: 'http://worldshell.online/ghost/kb/title',
      object: 'Alice',
      isLiteral: true,
    });

    expect(assertion.kind).toBe('explicit');
    expect(assertion.writable).toBe(false);
    expect(assertion.provenance).toContainEqual({ type: 'readonly-policy', policy: 'identity-local-name', field: 'title' });
  });

  it('marks derived assertions as non-writable with rule provenance', () => {
    const assertion = createDerivedAssertion(triple, ['Rule:tag-inheritance']);

    expect(assertion.kind).toBe('derived');
    expect(assertion.writable).toBe(false);
    expect(assertion.provenance).toEqual([
      { type: 'rule', title: 'Rule:tag-inheritance' },
      { type: 'readonly-policy', policy: 'derived-rule', field: 'tags' },
    ]);
  });

  it('marks virtual assertions as non-writable with system-state provenance', () => {
    const assertion = createVirtualAssertion({
      ...triple,
      predicate: 'http://worldshell.online/ghost/kb/current-workspace',
    });

    expect(assertion.kind).toBe('virtual');
    expect(assertion.writable).toBe(false);
    expect(assertion.provenance).toEqual([
      { type: 'system-state', key: 'current-workspace' },
      { type: 'readonly-policy', policy: 'virtual-system-state', field: 'current-workspace' },
    ]);
  });

  it('serializes assertion policy as RDF-star N3 metadata', () => {
    const assertion = createExplicitAssertion(triple);
    const n3 = assertionToRdfStarN3(assertion);

    expect(n3).toContain('<< kb:Alice kb:tags kb:Project >>');
    expect(n3).toContain('kb:writable true');
    expect(n3).toContain('kb:assertionKind kb:Explicit');
    expect(n3).toContain('kb:provenanceField "tags"');
    expect(() => new Parser().parse(`@prefix kb: <http://worldshell.online/ghost/kb/> .\n${n3}`)).not.toThrow();
  });

  it('serializes readonly and derived policy into RDF-star metadata', () => {
    const readonly = createExplicitAssertion({
      ...triple,
      predicate: 'http://worldshell.online/ghost/kb/created',
      object: '2026-01-01T00:00:00.000Z',
      isLiteral: true,
      datatype: 'http://www.w3.org/2001/XMLSchema#dateTime',
    });
    const derived = createDerivedAssertion(triple, ['Rule:tag-inheritance']);
    const n3 = assertionsToRdfStarN3([readonly, derived]);

    expect(n3).toContain('kb:writable false');
    expect(n3).toContain('kb:assertionKind kb:Explicit');
    expect(n3).toContain('kb:assertionKind kb:Derived');
    expect(n3).toContain('kb:readonlyReason kb:system-managed-field');
    expect(n3).toContain('kb:readonlyReason kb:derived-rule');
    expect(n3).toContain('kb:derivedBy <http://worldshell.online/ghost/kb/Rule:tag-inheritance>');
    expect(() => new Parser().parse(n3)).not.toThrow();
  });
});