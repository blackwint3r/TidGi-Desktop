import type { KnowledgeGraphMetadata, ResolvedKnowledgeGraph } from './graphRegistry';
import { resolveKnowledgeGraph } from './graphRegistry';
import { iriToLocalName, resourceIri } from './vocabulary';

const URI_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const KB_CURIE_PREFIX = 'kb:';

export type RefKind = 'node' | 'property' | 'graph';

export interface ResolvedRef {
  input: string;
  uri: string;
  localName: string | null;
  kind: RefKind;
}

export async function resolveGraphRef(ref?: string): Promise<ResolvedKnowledgeGraph> {
  return resolveKnowledgeGraph(ref);
}

export function resolveNodeRef(ref: string, graph: KnowledgeGraphMetadata): ResolvedRef {
  return resolveGraphScopedRef(ref, graph, 'node');
}

export function resolvePropertyRef(ref: string, graph: KnowledgeGraphMetadata): ResolvedRef {
  return resolveGraphScopedRef(ref, graph, 'property');
}

export function localNameFromUri(uri: string, graph: KnowledgeGraphMetadata): string | null {
  return iriToLocalName(uri, graph.prefix);
}

export function isAbsoluteUri(ref: string): boolean {
  return URI_PATTERN.test(ref) && !ref.startsWith(KB_CURIE_PREFIX);
}

function resolveGraphScopedRef(ref: string, graph: KnowledgeGraphMetadata, kind: Exclude<RefKind, 'graph'>): ResolvedRef {
  const uri = expandGraphScopedRef(ref, graph);
  return {
    input: ref,
    uri,
    localName: localNameFromUri(uri, graph),
    kind,
  };
}

function expandGraphScopedRef(ref: string, graph: KnowledgeGraphMetadata): string {
  if (isAbsoluteUri(ref)) return ref;
  const localName = ref.startsWith(KB_CURIE_PREFIX) ? ref.slice(KB_CURIE_PREFIX.length) : ref;
  return resourceIri(localName, graph.prefix);
}