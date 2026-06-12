import { z } from 'zod';
import type { McpToolDefinition, ToolInput } from './types';

import {
  buildQueryGraph,
  writeTriple,
  updateSystemState,
  getSystemState,
  type Triple,
} from '../knowledgeGraph/index';
import {
  deleteWithPolicy,
  patchWithPolicy,
  queryAssertions,
  writeWithPolicy,
  type QueryAssertionsOptions,
} from '../knowledgeGraph/operations';
import { assertionsToRdfStarN3, type Assertion } from '../knowledgeGraph/assertions';
import { parseRdfStatements } from '../knowledgeGraph/rdfAdapter';
import { queryWithEye } from '../knowledgeGraph/eyeReasoner';
import {
  clearSelectedGraph,
  getCurrentKnowledgeGraph,
  listKnowledgeGraphs,
  resolveKnowledgeGraph,
  setCurrentKnowledgeGraph,
  type KnowledgeGraphMetadata,
} from '../knowledgeGraph/graphRegistry';
import {
  resolveNodeRef,
  resolvePropertyRef,
} from '../knowledgeGraph/refResolver';
import { tiddlerUri, KB_BASE_URI } from '../knowledgeGraph/vocabulary';

// ─── Tool Definitions ───────────────────────────────────────────────────────────

export const KB_TOOLS: McpToolDefinition[] = [
  {
    name: 'kb_list_graphs',
    description: 'List all available knowledge graphs backed by TidGi wiki workspaces. Returns workspace id, graph URI, prefix, name, active state, and subwiki state.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'kb_get_current_graph',
    description: 'Get the current knowledge graph selected for MCP operations. Falls back to the TidGi active wiki workspace when no graph is explicitly selected.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'kb_set_current_graph',
    description: 'Set the current knowledge graph for subsequent MCP operations. Accepts workspace id, graph URI, or graph name.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace id, graph URI, or graph name.' },
        clear: { type: 'boolean', description: 'If true, clear explicit selection and fall back to active wiki workspace.' },
      },
    },
  },
  {
    name: 'kb_query_graph',
    description:
      'Query graph assertions and return N3/RDF-star text. References accept local names, kb: CURIEs, or full URIs. The returned text contains facts as RDF-star statements with writable/kind/provenance metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace id, graph URI, or graph name. Defaults to current graph.' },
        subject: { type: 'string', description: 'Subject node ref. Omit to match any.' },
        predicate: { type: 'string', description: 'Predicate/property ref. Omit to match any.' },
        object: { type: 'string', description: 'Object URI or literal. Omit to match any.' },
        objectIsLiteral: { type: 'boolean', description: 'If false, object is resolved as a node ref. Default: true.' },
        includeSystemState: { type: 'boolean', description: 'Include system-state assertions. Default: true.' },
        limit: { type: 'number', description: 'Maximum results. Default: 50.' },
        offset: { type: 'number', description: 'Skip first N results. Default: 0.' },
      },
    },
  },
  {
    name: 'kb_find_resources',
    description:
      'Find resources by property conditions and return N3/RDF-star text for the matched resource context.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace id, graph URI, or graph name. Defaults to current graph.' },
        where: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              predicate: { type: 'string', description: 'Predicate/property ref.' },
              object: { type: 'string', description: 'Object URI or literal. Omit to require predicate existence.' },
              objectIsLiteral: { type: 'boolean', description: 'If false, object is resolved as a node ref. Default: true.' },
            },
            required: ['predicate'],
          },
        },
        includeSystemState: { type: 'boolean', description: 'Include system-state assertions. Default: false.' },
        limit: { type: 'number', description: 'Maximum nodes. Default: 20.' },
        offset: { type: 'number', description: 'Skip first N nodes. Default: 0.' },
        sort: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              by: { type: 'string', description: 'Predicate/property ref, or localName.' },
              direction: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction. Default: asc.' },
            },
            required: ['by'],
          },
        },
      },
    },
  },
  {
    name: 'kb_eye_query',
    description:
      'Run an EYE --query style N3 query against the current knowledge graph and return N3 text. The query must be valid N3/Turtle and must explicitly declare every prefix it uses.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace id, graph URI, or graph name. Defaults to current graph.' },
        query: { type: 'string', description: 'Valid N3 query/rule text. Prefixes are not injected implicitly.' },
        includeSystemState: { type: 'boolean', description: 'Include system-state triples in the query facts. Default: false.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'kb_patch',
    description:
      'Apply an atomic RDF/Turtle patch. delete and insert are valid Turtle/N3 statement lists and must explicitly declare every prefix they use. All statements must pass policy before any change is applied.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace id, graph URI, or graph name. Defaults to current graph.' },
        delete: { type: 'string', description: 'Valid Turtle/N3 statement list to delete. Optional.' },
        insert: { type: 'string', description: 'Valid Turtle/N3 statement list to insert. Optional.' },
        format: { type: 'string', enum: ['N3', 'Turtle'], description: 'Input RDF syntax. Default: N3.' },
        mode: { type: 'string', enum: ['atomic'], description: 'Patch mode. Only atomic is currently supported.' },
      },
    },
  },
  {
    name: 'kb_write',
    description:
      'Write a single RDF triple to the knowledge base. The object can be a URI (for ObjectProperty) or a literal string. If the predicate is not declared as ObjectProperty in the KB, the object is stored as a string literal. You must first declare a predicate as ObjectProperty (via kb_add_declaration) before writing object references.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace ID. Defaults to active workspace.' },
        subject: { type: 'string', description: 'Subject URI (e.g. http://worldshell.online/ghost/kb/EntryName).' },
        predicate: { type: 'string', description: 'Predicate URI (e.g. http://worldshell.online/ghost/kb/author).' },
        object: { type: 'string', description: 'Object: URI for ObjectProperty, or literal string for DatatypeProperty.' },
        isLiteral: { type: 'boolean', description: 'If true, object is a literal (DatatypeProperty). If false, object is a URI (ObjectProperty). Default: auto-detect based on KB declarations.' },
      },
      required: ['subject', 'predicate', 'object'],
    },
  },
  {
    name: 'kb_delete',
    description:
      'Delete a triple from the knowledge base. The entry field will be set to empty (TiddlyWiki removes empty fields).',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace ID. Defaults to active workspace.' },
        subject: { type: 'string', description: 'Subject URI.' },
        predicate: { type: 'string', description: 'Predicate URI.' },
        object: { type: 'string', description: 'Object URI or literal.' },
      },
      required: ['subject', 'predicate'],
    },
  },
  {
    name: 'kb_list',
    description:
      'List all entry titles in a graph (workspace). Returns tiddler titles, optionally filtered by tag or knowledge-type.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace ID. Defaults to active workspace.' },
        tag: { type: 'string', description: 'Filter by tag (entry must have this tag).' },
        knowledgeType: { type: 'string', description: 'Filter by knowledge-type (Entry, Rule, Graph, Tag, User).' },
        limit: { type: 'number', description: 'Maximum results to return. Default: 100.' },
        offset: { type: 'number', description: 'Skip first N results. Default: 0.' },
      },
    },
  },
  {
    name: 'kb_get_resource',
    description:
      'Get one resource neighborhood as N3/RDF-star text. Includes outbound facts, inbound references, and statement metadata such as writable/kind/provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace id, graph URI, or graph name. Defaults to current graph.' },
        resource: { type: 'string', description: 'Resource ref to retrieve. Accepts local name, kb: CURIE, or full URI.' },
        includeSystemState: { type: 'boolean', description: 'Include system-state assertions. Default: false.' },
      },
      required: ['resource'],
    },
  },
  {
    name: 'kb_explain',
    description:
      'Explain matching knowledge assertions with provenance and writability. Rules are graph-owned and are not accepted as query parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace id, graph URI, or graph name. Defaults to current graph.' },
        subject: { type: 'string', description: 'Subject node ref. Omit to match any.' },
        predicate: { type: 'string', description: 'Predicate/property ref. Omit to match any.' },
        object: { type: 'string', description: 'Object URI or literal. Omit to match any.' },
        objectIsLiteral: { type: 'boolean', description: 'If false, object is resolved as a node ref. Default: true.' },
        includeSystemState: { type: 'boolean', description: 'Include system-state assertions. Default: true.' },
      },
    },
  },
  {
    name: 'kb_set_system_state',
    description:
      'Update system-state properties (current-workspace, focused-tiddler). These are virtual triples with the KB base URI as subject.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Set current-workspace to this workspace ID.' },
        tiddlerTitle: { type: 'string', description: 'Set focused-tiddler to this tiddler title.' },
      },
    },
  },
  {
    name: 'kb_add_declaration',
    description:
      'Declare a predicate as ObjectProperty or DatatypeProperty in the KB. This affects how kb_write interprets objects. ObjectProperty → object is a tiddler URI; DatatypeProperty → object is a literal.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string', description: 'Workspace ID. Defaults to active workspace.' },
        predicate: { type: 'string', description: 'Predicate URI to declare.' },
        propertyType: { type: 'string', enum: ['ObjectProperty', 'DatatypeProperty'], description: 'Property type declaration.' },
      },
      required: ['predicate', 'propertyType'],
    },
  },
];

// ─── Zod Schemas for MCP registration ──────────────────────────────────────────
// These are the Zod schemas that McpServer.registerTool() requires.
// They mirror KB_TOOLS but in Zod format.

export const KB_TOOL_SCHEMAS = {
  kb_list_graphs: z.object({}),
  kb_get_current_graph: z.object({}),
  kb_set_current_graph: z.object({
    graph: z.string().optional(),
    clear: z.boolean().optional(),
  }),
  kb_query_graph: z.object({
    graph: z.string().optional(),
    subject: z.string().optional(),
    predicate: z.string().optional(),
    object: z.string().optional(),
    objectIsLiteral: z.boolean().optional(),
    includeSystemState: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }).strict(),
  kb_find_resources: z.object({
    graph: z.string().optional(),
    where: z.array(z.object({
      predicate: z.string(),
      object: z.string().optional(),
      objectIsLiteral: z.boolean().optional(),
    }).strict()).optional(),
    includeSystemState: z.boolean().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
    sort: z.array(z.object({
      by: z.string(),
      direction: z.enum(['asc', 'desc']).optional(),
    }).strict()).optional(),
  }).strict(),
  kb_eye_query: z.object({
    graph: z.string().optional(),
    query: z.string(),
    includeSystemState: z.boolean().optional(),
  }).strict(),
  kb_patch: z.object({
    graph: z.string().optional(),
    delete: z.string().optional(),
    insert: z.string().optional(),
    format: z.enum(['N3', 'Turtle']).optional(),
    mode: z.literal('atomic').optional(),
  }).strict(),
  kb_write: z.object({
    graph: z.string().optional(),
    subject: z.string(),
    predicate: z.string(),
    object: z.string(),
    isLiteral: z.boolean().optional(),
  }),
  kb_delete: z.object({
    graph: z.string().optional(),
    subject: z.string(),
    predicate: z.string(),
    object: z.string().optional(),
  }),
  kb_list: z.object({
    graph: z.string().optional(),
    tag: z.string().optional(),
    knowledgeType: z.string().optional(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  kb_get_resource: z.object({
    graph: z.string().optional(),
    resource: z.string(),
    includeSystemState: z.boolean().optional(),
  }).strict(),
  kb_explain: z.object({
    graph: z.string().optional(),
    subject: z.string().optional(),
    predicate: z.string().optional(),
    object: z.string().optional(),
    objectIsLiteral: z.boolean().optional(),
    includeSystemState: z.boolean().optional(),
  }).strict(),
  kb_set_system_state: z.object({
    workspaceId: z.string().optional(),
    tiddlerTitle: z.string().optional(),
  }),
  kb_add_declaration: z.object({
    graph: z.string().optional(),
    predicate: z.string(),
    propertyType: z.enum(['ObjectProperty', 'DatatypeProperty']),
  }),
} as const;

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function resolveGraph(graph: string | undefined) {
  return resolveKnowledgeGraph(graph);
}

interface TripleQueryInput {
  graph?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  objectIsLiteral?: boolean;
  includeSystemState?: boolean;
  limit?: number;
  offset?: number;
}

interface NodeQueryConditionInput {
  predicate: string;
  object?: string;
  objectIsLiteral?: boolean;
}

interface ResolvedNodeQueryCondition {
  predicate: string;
  object?: string;
}

interface NodeQueryInput {
  graph?: string;
  where?: NodeQueryConditionInput[];
  includeSystemState?: boolean;
  limit?: number;
  offset?: number;
  sort?: Array<{ by: string; direction?: 'asc' | 'desc' }>;
}

interface EyeQueryInput {
  graph?: string;
  query: string;
  includeSystemState?: boolean;
}

interface PatchInput {
  graph?: string;
  delete?: string;
  insert?: string;
  format?: 'N3' | 'Turtle';
  mode?: 'atomic';
}

function findResourceUris(
  assertions: Assertion[],
  conditions: ResolvedNodeQueryCondition[],
  graph: KnowledgeGraphMetadata,
  sort: Array<{ by: string; direction?: 'asc' | 'desc' }>,
): string[] {
  const subjectAssertions = new Map<string, Assertion[]>();

  for (const assertion of assertions) {
    if (!subjectAssertions.has(assertion.triple.subject)) subjectAssertions.set(assertion.triple.subject, []);
    subjectAssertions.get(assertion.triple.subject)?.push(assertion);
  }

  const resourceUris = Array.from(subjectAssertions.entries())
    .filter(([, resourceAssertions]) => conditions.length === 0 || matchedAssertions(resourceAssertions, conditions).every((matches) => matches.length > 0))
    .map(([uri]) => uri);

  resourceUris.sort((left, right) => compareResourceUris(left, right, subjectAssertions, graph, sort));
  return resourceUris;
}

function resolveTripleQueryInput(
  graph: KnowledgeGraphMetadata,
  input: Omit<TripleQueryInput, 'graph' | 'limit' | 'offset'>,
): QueryAssertionsOptions {
  return {
    subject: input.subject ? resolveNodeRef(input.subject, graph).uri : undefined,
    predicate: input.predicate ? resolvePropertyRef(input.predicate, graph).uri : undefined,
    object: input.object ? resolveObjectRef(input.object, input.objectIsLiteral, graph) : undefined,
    includeSystemState: input.includeSystemState,
  };
}

function resolveNodeCondition(condition: NodeQueryConditionInput, graph: KnowledgeGraphMetadata): ResolvedNodeQueryCondition {
  return {
    predicate: resolvePropertyRef(condition.predicate, graph).uri,
    object: condition.object ? resolveObjectRef(condition.object, condition.objectIsLiteral, graph) : undefined,
  };
}

function resolveObjectRef(object: string, objectIsLiteral: boolean | undefined, graph: KnowledgeGraphMetadata): string {
  return objectIsLiteral === false ? resolveNodeRef(object, graph).uri : object;
}

function paginate<T>(items: T[], limitInput: number | undefined, offsetInput: number | undefined, defaultLimit: number): { items: T[]; limit: number; offset: number } {
  const limit = normalizeNonNegativeInteger(limitInput, defaultLimit);
  const offset = normalizeNonNegativeInteger(offsetInput, 0);
  return { items: items.slice(offset, offset + limit), limit, offset };
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function matchedAssertions(assertions: Assertion[], conditions: ResolvedNodeQueryCondition[]): Assertion[][] {
  return conditions.map((condition) => assertions.filter((assertion) => {
    const { triple } = assertion;
    if (triple.predicate !== condition.predicate) return false;
    if (condition.object !== undefined && triple.object !== condition.object) return false;
    return true;
  }));
}

function compareResourceUris(
  leftUri: string,
  rightUri: string,
  subjectAssertions: Map<string, Assertion[]>,
  graph: KnowledgeGraphMetadata,
  sort: Array<{ by: string; direction?: 'asc' | 'desc' }>,
): number {
  const sorters = sort.length > 0 ? sort : [{ by: 'localName' }];

  for (const sorter of sorters) {
    const direction = sorter.direction === 'desc' ? -1 : 1;
    const leftValue = resourceSortValue(leftUri, subjectAssertions.get(leftUri) ?? [], sorter.by, graph);
    const rightValue = resourceSortValue(rightUri, subjectAssertions.get(rightUri) ?? [], sorter.by, graph);
    const result = leftValue.localeCompare(rightValue);
    if (result !== 0) return result * direction;
  }

  return 0;
}

function resourceSortValue(uri: string, assertions: Assertion[], by: string, graph: KnowledgeGraphMetadata): string {
  if (by === 'localName') return uri.startsWith(graph.prefix) ? uri.slice(graph.prefix.length) : uri;
  const predicate = resolvePropertyRef(by, graph).uri;
  return assertions.find((assertion) => assertion.triple.predicate === predicate)?.triple.object ?? '';
}

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export async function callKbTool(name: string, input: ToolInput): Promise<unknown> {
  switch (name) {
    case 'kb_list_graphs': {
      const graphs = await listKnowledgeGraphs();
      const current = await getCurrentKnowledgeGraph();
      return { current, graphs };
    }

    case 'kb_get_current_graph': {
      return getCurrentKnowledgeGraph();
    }

    case 'kb_set_current_graph': {
      const { graph, clear } = input as { graph?: string; clear?: boolean };
      if (clear) {
        clearSelectedGraph();
        return getCurrentKnowledgeGraph();
      }
      if (!graph) throw new Error('graph is required unless clear is true.');
      return setCurrentKnowledgeGraph(graph);
    }

    case 'kb_query_graph': {
      const { graph, subject, predicate, object, objectIsLiteral = true, includeSystemState = true, limit, offset } = input as TripleQueryInput;

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const queryOptions = resolveTripleQueryInput(resolvedGraph, {
        subject,
        predicate,
        object,
        objectIsLiteral,
        includeSystemState,
      });
      const { assertions } = await queryAssertions(workspaceId, queryOptions);
      const page = paginate(assertions, limit, offset, 50);

      return assertionsToRdfStarN3(page.items);
    }

    case 'kb_find_resources': {
      const { graph, where = [], includeSystemState = false, limit, offset, sort = [] } = input as NodeQueryInput;
      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const { assertions } = await queryAssertions(workspaceId, { includeSystemState });
      const conditions = where.map((condition) => resolveNodeCondition(condition, resolvedGraph));
      const resources = findResourceUris(assertions, conditions, resolvedGraph, sort);
      const page = paginate(resources, limit, offset, 20);
      const resourceUris = new Set(page.items);
      const resourceAssertions = assertions.filter((assertion) => (
        resourceUris.has(assertion.triple.subject) || resourceUris.has(assertion.triple.object)
      ));

      return assertionsToRdfStarN3(resourceAssertions);
    }

    case 'kb_eye_query': {
      const { graph, query, includeSystemState = false } = input as unknown as EyeQueryInput;
      if (!query) throw new Error('query is required.');

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const queryGraph = await buildQueryGraph(workspaceId, { includeSystemState });
      return queryWithEye(queryGraph, query);
    }

    case 'kb_patch': {
      const { graph, delete: deleteText, insert, format = 'N3', mode = 'atomic' } = input as PatchInput;
      if (mode !== 'atomic') throw new Error('Only atomic patch mode is supported.');
      if (!deleteText && !insert) throw new Error('delete or insert is required.');

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const result = await patchWithPolicy(workspaceId, {
        delete: deleteText ? parseRdfStatements(deleteText, { format }) : [],
        insert: insert ? parseRdfStatements(insert, { format }) : [],
      });

      return {
        success: result.success,
        graph: result.graph,
        error: result.error,
        operations: result.operations.map((operation) => ({
          action: operation.action,
          triple: operation.triple,
          allowed: operation.decision.allowed,
          reason: operation.decision.reason,
        })),
      };
    }

    case 'kb_write': {
      const { graph, subject, predicate, object, isLiteral } = input as {
        graph?: string;
        subject: string;
        predicate: string;
        object: string;
        isLiteral?: boolean;
      };

      if (!subject || !predicate || !object) {
        throw new Error('subject, predicate, and object are required.');
      }

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const resolvedSubject = resolveNodeRef(subject, resolvedGraph).uri;
      const resolvedPredicate = resolvePropertyRef(predicate, resolvedGraph).uri;
      const resolvedObject = isLiteral === false ? resolveNodeRef(object, resolvedGraph).uri : object;

      // Build the triple
      const triple: Triple = {
        subject: resolvedSubject,
        predicate: resolvedPredicate,
        object: resolvedObject,
        isLiteral: isLiteral === true ? true : false,
      };

      const result = await writeWithPolicy(workspaceId, triple);

      if (!result.success) {
        return {
          success: false,
          workspaceId,
          subject: resolvedSubject,
          predicate: resolvedPredicate,
          object: resolvedObject,
          decision: result.decision,
          error: result.error ?? 'Write rejected by knowledge operation policy',
        };
      }

      return { success: true, workspaceId, subject: resolvedSubject, predicate: resolvedPredicate, object: resolvedObject, decision: result.decision };
    }

    case 'kb_delete': {
      const { graph, subject, predicate, object } = input as {
        graph?: string;
        subject: string;
        predicate: string;
        object?: string;
      };

      if (!subject || !predicate) {
        throw new Error('subject and predicate are required.');
      }

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const resolvedSubject = resolveNodeRef(subject, resolvedGraph).uri;
      const resolvedPredicate = resolvePropertyRef(predicate, resolvedGraph).uri;
      const resolvedObject = object ? resolveNodeRef(object, resolvedGraph).uri : '';

      const triple: Triple = {
        subject: resolvedSubject,
        predicate: resolvedPredicate,
        object: resolvedObject,
        isLiteral: false,
      };

      const result = await deleteWithPolicy(workspaceId, triple);
      if (!result.success) {
        return {
          success: false,
          workspaceId,
          subject: resolvedSubject,
          predicate: resolvedPredicate,
          decision: result.decision,
          error: result.error ?? 'Delete rejected by knowledge operation policy',
        };
      }

      return { success: true, workspaceId, subject: resolvedSubject, predicate: resolvedPredicate, decision: result.decision };
    }

    case 'kb_list': {
      const { graph, tag, knowledgeType, limit = 100, offset = 0 } = input as {
        graph?: string;
        tag?: string;
        knowledgeType?: string;
        limit?: number;
        offset?: number;
      };

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;

      // Load the graph
      const fullGraph = await buildQueryGraph(workspaceId, {
        includeSystemState: false,
      });

      // Get all entry titles (subjects that start with KB_BASE_URI)
      const entryTitles = new Set<string>();
      for (const triple of fullGraph.triples) {
        if (triple.subject.startsWith(KB_BASE_URI)) {
          // Extract title from URI
          const title = triple.subject.slice(KB_BASE_URI.length);
          if (title && !title.includes('/')) {
            entryTitles.add(decodeURIComponent(title));
          }
        }
      }

      // Filter by tag if provided
      let filtered = Array.from(entryTitles);
      if (tag) {
        const tagUri = tiddlerUri(tag);
        filtered = filtered.filter((title) => {
          const titleUri = tiddlerUri(title);
          return fullGraph.triples.some(
            (t) => t.subject === titleUri && t.predicate.endsWith('/tags') && t.object === tagUri,
          );
        });
      }

      // Filter by knowledge-type if provided
      if (knowledgeType) {
        const typeUri = `${KB_BASE_URI}${knowledgeType}`;
        filtered = filtered.filter((title) => {
          const titleUri = tiddlerUri(title);
          return fullGraph.triples.some(
            (t) => t.subject === titleUri && t.predicate === 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type' && t.object === typeUri,
          );
        });
      }

      // Sort and paginate
      filtered.sort();
      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);

      return {
        graph: workspaceId,
        total,
        offset,
        limit,
        entries: page,
      };
    }

    case 'kb_get_resource': {
      const { graph, resource, includeSystemState = false } = input as { graph?: string; resource: string; includeSystemState?: boolean };
      if (!resource) throw new Error('resource is required.');

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const resolvedResource = resolveNodeRef(resource, resolvedGraph);
      const { assertions } = await queryAssertions(workspaceId, { includeSystemState });
      const outbound = assertions.filter((assertion) => assertion.triple.subject === resolvedResource.uri);
      const inbound = assertions.filter((assertion) => assertion.triple.object === resolvedResource.uri);

      return assertionsToRdfStarN3([...outbound, ...inbound]);
    }

    case 'kb_explain': {
      const { graph, subject, predicate, object, objectIsLiteral = true, includeSystemState = true } = input as TripleQueryInput;

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const queryOptions = resolveTripleQueryInput(resolvedGraph, {
        subject,
        predicate,
        object,
        objectIsLiteral,
        includeSystemState,
      });
      const { assertions } = await queryAssertions(workspaceId, queryOptions);

      return assertionsToRdfStarN3(assertions);
    }

    case 'kb_set_system_state': {
      const { workspaceId, tiddlerTitle } = input as {
        workspaceId?: string;
        tiddlerTitle?: string;
      };

      updateSystemState(workspaceId, tiddlerTitle);
      return { success: true, ...getSystemState() };
    }

    case 'kb_add_declaration': {
      const { graph, predicate, propertyType } = input as {
        graph?: string;
        predicate: string;
        propertyType: 'ObjectProperty' | 'DatatypeProperty';
      };

      if (!predicate || !propertyType) {
        throw new Error('predicate and propertyType are required.');
      }

      if (propertyType !== 'ObjectProperty' && propertyType !== 'DatatypeProperty') {
        throw new Error('propertyType must be ObjectProperty or DatatypeProperty.');
      }

      const resolvedGraph = await resolveGraph(graph);
      const workspaceId = resolvedGraph.workspaceId;
      const resolvedPredicate = resolvePropertyRef(predicate, resolvedGraph).uri;

      // Write the declaration triple
      const typeTriple: Triple = {
        subject: resolvedPredicate,
        predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        object:
          propertyType === 'ObjectProperty'
            ? 'http://www.w3.org/2002/07/owl#ObjectProperty'
            : 'http://www.w3.org/2002/07/owl#DatatypeProperty',
        isLiteral: false,
      };

      const result = await writeTriple(typeTriple, workspaceId);
      if (!result.success) throw new Error(result.error ?? 'Declaration write failed');

      return { success: true, predicate: resolvedPredicate, propertyType, graph: workspaceId };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
