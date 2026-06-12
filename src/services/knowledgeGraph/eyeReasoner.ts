import { logger } from '@services/libs/log';
import { FIELD_TO_PROPERTY_URI, GHOST_CLASSES, KB_BASE_URI, RDF, uriToTitle } from './vocabulary';
import { quadsToTriples, serializeGraph } from './rdfAdapter';
import { tripleKey } from './assertions';
import type { Graph, Triple } from './index';

export interface EyeRule {
  title: string;
  subject: string;
  text: string;
}

export interface EyeReasoningResult {
  graph: Graph;
  inferredTriples: Triple[];
  rules: EyeRule[];
}

export interface EyeReasoningOptions {
  rules?: EyeRule[];
}

export interface EyeQueryOptions {
  includeSystemState?: boolean;
}

const RULE_CONTENT_PREDICATE = FIELD_TO_PROPERTY_URI.text;
const STATUS_PREDICATE = `${KB_BASE_URI}状态`;
const DISABLED_STATUS_VALUES = new Set(['禁用', 'disabled']);

export function extractEnabledEyeRules(graph: Graph): EyeRule[] {
  const triplesBySubject = new Map<string, Triple[]>();
  for (const triple of graph.triples) {
    const existing = triplesBySubject.get(triple.subject) ?? [];
    existing.push(triple);
    triplesBySubject.set(triple.subject, existing);
  }

  const rules: EyeRule[] = [];
  for (const [subject, triples] of triplesBySubject) {
    if (!isRuleNode(triples) || isDisabledRule(triples)) continue;

    const text = triples.find((triple) => triple.predicate === RULE_CONTENT_PREDICATE && triple.isLiteral)?.object?.trim();
    if (!text) continue;

    rules.push({
      title: uriToTitle(subject) ?? subject,
      subject,
      text,
    });
  }

  return rules;
}

export async function inferWithEye(graph: Graph, options: EyeReasoningOptions = {}): Promise<EyeReasoningResult> {
  const rules = options.rules ?? extractEnabledEyeRules(graph);
  if (rules.length === 0) return { graph, inferredTriples: [], rules };

  try {
    const [{ n3reasoner }, data] = await Promise.all([
      import('eyereasoner'),
      serializeGraph(graph, { format: 'N-Triples' }),
    ]);

    const output = await n3reasoner([data, ...rules.map((rule) => rule.text)], undefined, {
      output: 'derivations',
      outputType: 'quads',
    });

    const explicitKeys = new Set(graph.triples.map(tripleKey));
    const seen = new Set<string>();
    const inferredTriples = quadsToTriples(output as Parameters<typeof quadsToTriples>[0])
      .filter((triple) => !explicitKeys.has(tripleKey(triple)))
      .filter((triple) => {
        const key = tripleKey(triple);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return {
      graph: { ...graph, triples: [...graph.triples, ...inferredTriples] },
      inferredTriples,
      rules,
    };
  } catch (error) {
    logger.warn('[KnowledgeGraph] EYE reasoning failed; returning explicit graph only', { error });
    return { graph, inferredTriples: [], rules };
  }
}

export async function queryWithEye(graph: Graph, query: string): Promise<string> {
  const [{ n3reasoner }, data] = await Promise.all([
    import('eyereasoner'),
    serializeGraph(graph, { format: 'N-Triples' }),
  ]);

  return n3reasoner(data, query, { outputType: 'string' }) as Promise<string>;
}

function isRuleNode(triples: Triple[]): boolean {
  return triples.some((triple) => triple.predicate === RDF.TYPE && triple.object === GHOST_CLASSES.RULE && !triple.isLiteral);
}

function isDisabledRule(triples: Triple[]): boolean {
  return triples.some((triple) => {
    if (triple.predicate !== STATUS_PREDICATE || !triple.isLiteral) return false;
    return DISABLED_STATUS_VALUES.has(triple.object.trim().toLowerCase());
  });
}