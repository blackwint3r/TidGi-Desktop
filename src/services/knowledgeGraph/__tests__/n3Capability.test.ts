import { describe, expect, it } from 'vitest';
import { n3reasoner } from 'eyereasoner';
import { Parser, Writer } from 'n3';

function serializeN3(input: string): Promise<string> {
  const quads = new Parser({ format: 'text/n3' }).parse(input);
  const writer = new Writer({
    format: 'N3',
    prefixes: {
      kb: 'http://worldshell.online/ghost/kb/',
      log: 'http://www.w3.org/2000/10/swap/log#',
    },
  });
  writer.addQuads(quads);
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

describe('N3/RDF-star capability spike', () => {
  it('parses RDF-star statement metadata through N3.js', async () => {
    const input = `
@prefix kb: <http://worldshell.online/ghost/kb/> .
<< kb:Alice kb:hasDisease kb:Covid19 >> kb:writable false .
`;
    const quads = new Parser({ format: 'text/n3' }).parse(input);

    expect(quads).toHaveLength(2);
    expect(quads[0].predicate.value).toBe('http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies');
    expect(quads[0].object.termType).toBe('Quad');
    expect(quads[1].predicate.value).toBe('http://worldshell.online/ghost/kb/writable');

    const serialized = await serializeN3(input);
    expect(serialized).toContain('kb:writable false');
  });

  it('parses N3 formula subgraphs through log:includes', async () => {
    const input = `
@prefix kb: <http://worldshell.online/ghost/kb/> .
@prefix log: <http://www.w3.org/2000/10/swap/log#> .
kb:subgraph1 kb:created "now" ; log:includes { kb:Alice kb:hasDisease kb:Covid19 } .
`;
    const quads = new Parser({ format: 'text/n3' }).parse(input);

    expect(quads.map((quad) => quad.predicate.value)).toEqual(expect.arrayContaining([
      'http://worldshell.online/ghost/kb/created',
      'http://www.w3.org/2000/10/swap/log#includes',
    ]));
    expect(quads.some((quad) => quad.graph.termType === 'BlankNode')).toBe(true);

    const serialized = await serializeN3(input);
    expect(serialized).toContain('log:includes');
    expect(serialized).toContain('kb:Alice kb:hasDisease kb:Covid19');
  });

  it('keeps RDF-star statement metadata through EYE reasoning', async () => {
    const input = `
@prefix kb: <http://worldshell.online/ghost/kb/> .
<< kb:Alice kb:hasDisease kb:Covid19 >> kb:writable false .
`;

    const result = await n3reasoner(input, undefined, {
      output: 'deductive_closure',
      outputType: 'string',
    });

    expect(result).toContain('<< kb:Alice kb:hasDisease kb:Covid19 >> kb:writable false');
  });

  it('keeps log:includes formula subgraphs through EYE reasoning', async () => {
    const input = `
@prefix kb: <http://worldshell.online/ghost/kb/> .
@prefix log: <http://www.w3.org/2000/10/swap/log#> .
kb:subgraph1 kb:created "now" ; log:includes { kb:Alice kb:hasDisease kb:Covid19 } .
`;

    const result = await n3reasoner(input, undefined, {
      output: 'deductive_closure',
      outputType: 'string',
    });

    expect(result).toContain('kb:subgraph1 log:includes');
    expect(result).toContain('kb:Alice kb:hasDisease kb:Covid19');
  });
});