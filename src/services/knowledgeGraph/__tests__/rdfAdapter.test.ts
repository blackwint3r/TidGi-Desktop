import { Parser } from 'n3';
import { describe, expect, it } from 'vitest';
import type { Graph, Triple } from '../index';
import {
  createRdfGraphDocument,
  graphToStore,
  quadToTriple,
  quadsToTriples,
  serializeGraph,
  serializeGraphFormula,
  serializeQuads,
  storeToTriples,
  tripleToQuad,
  triplesToQuads,
} from '../rdfAdapter';

const uriTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/A',
  predicate: 'http://worldshell.online/ghost/kb/tags',
  object: 'http://worldshell.online/ghost/kb/Project',
  isLiteral: false,
};

const typedLiteralTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/A',
  predicate: 'http://worldshell.online/ghost/kb/revision',
  object: '42',
  isLiteral: true,
  datatype: 'http://www.w3.org/2001/XMLSchema#integer',
};

const langLiteralTriple: Triple = {
  subject: 'http://worldshell.online/ghost/kb/A',
  predicate: 'http://www.w3.org/2000/01/rdf-schema#label',
  object: 'Ghost',
  isLiteral: true,
  lang: 'en',
};

describe('rdfAdapter', () => {
  it('round-trips URI triples through RDFJS quads', () => {
    const quad = tripleToQuad(uriTriple, { graphUri: 'http://worldshell.online/ghost/kb/Test%20Graph' });

    expect(quad.subject.value).toBe(uriTriple.subject);
    expect(quad.predicate.value).toBe(uriTriple.predicate);
    expect(quad.object.value).toBe(uriTriple.object);
    expect(quad.object.termType).toBe('NamedNode');
    expect(quad.graph.value).toBe('http://worldshell.online/ghost/kb/Test%20Graph');
    expect(quadToTriple(quad)).toEqual(uriTriple);
  });

  it('preserves literal datatype and language tags', () => {
    const typed = quadToTriple(tripleToQuad(typedLiteralTriple));
    const lang = quadToTriple(tripleToQuad(langLiteralTriple));

    expect(typed).toEqual(typedLiteralTriple);
    expect(lang).toEqual(langLiteralTriple);
  });

  it('converts graph triples to store and back', () => {
    const graph: Graph = { id: 'workspace', triples: [uriTriple, typedLiteralTriple, langLiteralTriple] };
    const store = graphToStore(graph);

    expect(store.size).toBe(3);
    expect(storeToTriples(store)).toEqual(expect.arrayContaining(graph.triples));
    expect(quadsToTriples(triplesToQuads(graph.triples))).toEqual(graph.triples);
  });

  it('serializes graph-level metadata as N3 formula with log:includes', async () => {
    const graph: Graph = { id: 'workspace', triples: [uriTriple] };
    const formula = await serializeGraphFormula(graph, {
      subgraphUri: 'http://worldshell.online/ghost/kb/subgraph/workspace/current',
      sourceUri: 'http://worldshell.online/ghost/kb/TiddlyWiki',
      created: '2026-03-15T00:00:00.000Z',
    });

    expect(formula).toContain('@prefix log: <http://www.w3.org/2000/10/swap/log#> .');
    expect(formula).toContain('<http://worldshell.online/ghost/kb/subgraph/workspace/current>');
    expect(formula).toContain('kb:created "2026-03-15T00:00:00.000Z"^^xsd:dateTime');
    expect(formula).toContain('kb:source <http://worldshell.online/ghost/kb/TiddlyWiki>');
    expect(formula).toContain('log:includes {');
    expect(formula).toContain('<http://worldshell.online/ghost/kb/A> <http://worldshell.online/ghost/kb/tags> <http://worldshell.online/ghost/kb/Project> .');
    expect(() => new Parser({ format: 'text/n3' }).parse(formula)).not.toThrow();
  });

  it('creates graph documents with fact text, query index, and formula text', async () => {
    const graph: Graph = { id: 'workspace', triples: [uriTriple] };
    const document = await createRdfGraphDocument(graph, {
      format: 'N3',
      prefixes: { kb: 'http://worldshell.online/ghost/kb/' },
    });

    expect(document.quads).toHaveLength(1);
    expect(document.store.size).toBe(1);
    expect(document.text).toContain('kb:A');
    expect(document.formula).toContain('log:includes {');
    expect(() => new Parser({ format: 'text/n3' }).parse(document.formula)).not.toThrow();
  });
});