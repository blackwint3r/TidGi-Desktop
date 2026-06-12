import type { Graph } from './index';
import {
  createDerivedAssertion,
  createExplicitAssertion,
  type Assertion,
} from './assertions';
import { inferWithEye } from './eyeReasoner';

export async function inferAssertions(baseGraph: Graph, _legacyRuleTitles: string[] = [], _workspaceId?: string): Promise<Assertion[]> {
  const result = await inferWithEye(baseGraph);
  const ruleTitles = result.rules.map((rule) => rule.title);

  return result.inferredTriples.map((triple) => createDerivedAssertion(triple, ruleTitles));
}

export function explicitAssertions(graph: Graph): Assertion[] {
  return graph.triples.map(createExplicitAssertion);
}