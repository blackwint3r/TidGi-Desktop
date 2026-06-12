import { DataFactory, Parser, Store, Writer, type Quad } from 'n3';
import type { Graph, Triple } from './index';

export type RdfSerializationFormat = 'N-Triples' | 'Turtle' | 'N3';

export interface RdfGraphOptions {
  graphUri?: string;
  subgraphUri?: string;
  sourceUri?: string;
  created?: string;
}

export interface SerializeRdfOptions extends RdfGraphOptions {
  format?: RdfSerializationFormat;
  prefixes?: Record<string, string>;
}

export interface RdfGraphDocument {
  quads: Quad[];
  store: Store;
  text: string;
  formula: string;
  format: RdfSerializationFormat;
}

const { defaultGraph, literal, namedNode, quad } = DataFactory;

export function tripleToQuad(triple: Triple, options: RdfGraphOptions = {}): Quad {
  return quad(
    namedNode(triple.subject),
    namedNode(triple.predicate),
    triple.isLiteral ? literalNodeForTriple(triple) : namedNode(triple.object),
    options.graphUri ? namedNode(options.graphUri) : defaultGraph(),
  );
}

export function quadToTriple(input: Quad): Triple {
  const object = input.object;

  if (object.termType === 'Literal') {
    return {
      subject: input.subject.value,
      predicate: input.predicate.value,
      object: object.value,
      isLiteral: true,
      ...(object.language ? { lang: object.language } : {}),
      ...(!object.language && object.datatype?.value ? { datatype: object.datatype.value } : {}),
    };
  }

  return {
    subject: input.subject.value,
    predicate: input.predicate.value,
    object: object.value,
    isLiteral: false,
  };
}

export function triplesToQuads(triples: Triple[], options: RdfGraphOptions = {}): Quad[] {
  return triples.map((triple) => tripleToQuad(triple, options));
}

export function quadsToTriples(quads: Quad[]): Triple[] {
  return quads.map(quadToTriple);
}

export function graphToStore(graph: Graph, options: RdfGraphOptions = {}): Store {
  return new Store(triplesToQuads(graph.triples, options));
}

export function storeToQuads(store: Store): Quad[] {
  return store.getQuads(null, null, null, null);
}

export function storeToTriples(store: Store): Triple[] {
  return quadsToTriples(storeToQuads(store));
}

export async function serializeQuads(quads: Quad[], options: SerializeRdfOptions = {}): Promise<string> {
  const writer = new Writer({
    format: options.format ?? 'N-Triples',
    prefixes: options.prefixes,
  });
  writer.addQuads(quads);
  return new Promise((resolve, reject) => {
    writer.end((error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

export async function createRdfGraphDocument(graph: Graph, options: SerializeRdfOptions = {}): Promise<RdfGraphDocument> {
  const format = options.format ?? 'N3';
  const quads = triplesToQuads(graph.triples, options);
  return {
    quads,
    store: new Store(quads),
    text: await serializeQuads(quads, { ...options, format }),
    formula: await serializeGraphFormula(graph, { ...options, format: 'N3' }),
    format,
  };
}

export async function serializeGraphFormula(graph: Graph, options: SerializeRdfOptions = {}): Promise<string> {
  const prefixes = {
    kb: 'http://worldshell.online/ghost/kb/',
    log: 'http://www.w3.org/2000/10/swap/log#',
    xsd: 'http://www.w3.org/2001/XMLSchema#',
    ...options.prefixes,
  };
  const facts = await serializeQuads(triplesToQuads(graph.triples), { format: 'N-Triples' });
  const graphRef = iriToN3(options.subgraphUri ?? options.graphUri ?? `http://worldshell.online/ghost/kb/subgraph/${graph.id}`);
  const sourceRef = iriToN3(options.sourceUri ?? 'http://worldshell.online/ghost/kb/TiddlyWiki');
  const created = options.created ?? new Date(0).toISOString();

  return [
    ...Object.entries(prefixes).map(([prefix, uri]) => `@prefix ${prefix}: <${uri}> .`),
    '',
    `${graphRef}`,
    `  kb:created ${JSON.stringify(created)}^^xsd:dateTime ;`,
    `  kb:source ${sourceRef} ;`,
    `  log:includes {`,
    indentFormulaFacts(facts),
    `  } .`,
  ].join('\n');
}

export function parseRdfStatements(input: string, options: { format?: 'Turtle' | 'N3' } = {}): Triple[] {
  const quads = new Parser({ format: options.format === 'Turtle' ? 'text/turtle' : 'text/n3' }).parse(input);
  const triples: Triple[] = [];

  for (const inputQuad of quads) {
    if (inputQuad.graph.termType !== 'DefaultGraph') {
      throw new Error('Only default-graph statements are supported in KB patches.');
    }
    if (inputQuad.subject.termType !== 'NamedNode') {
      throw new Error('Only named-node subjects are supported in KB patches.');
    }
    if (inputQuad.predicate.termType !== 'NamedNode') {
      throw new Error('Only named-node predicates are supported in KB patches.');
    }
    if (inputQuad.object.termType !== 'NamedNode' && inputQuad.object.termType !== 'Literal') {
      throw new Error('Only named-node or literal objects are supported in KB patches.');
    }

    triples.push(quadToTriple(inputQuad));
  }

  return triples;
}

export async function serializeGraph(graph: Graph, options: SerializeRdfOptions = {}): Promise<string> {
  return serializeQuads(triplesToQuads(graph.triples, options), options);
}

function literalNodeForTriple(triple: Triple) {
  if (triple.lang) return literal(triple.object, triple.lang);
  if (triple.datatype) return literal(triple.object, namedNode(triple.datatype));
  return literal(triple.object);
}

function indentFormulaFacts(facts: string): string {
  const trimmed = facts.trim();
  if (!trimmed) return '  ';
  return trimmed.split('\n').map((line) => `    ${line}`).join('\n');
}

function iriToN3(uri: string): string {
  return `<${uri}>`;
}