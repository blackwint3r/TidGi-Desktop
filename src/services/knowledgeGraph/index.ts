/**
 * Knowledge Graph Layer — bidirectional TW ↔ RDF mapping.
 *
 * This service:
 * - Maps TiddlyWiki entries to RDF triples (TW → KB)
 * - Maps RDF triples back to TiddlyWiki entries (KB → TW)
 * - Handles ObjectProperty ambiguity via KB declarations
 * - Injects system-state triples dynamically
 * - Supports N3 rule inference
 *
 * Does NOT load vocabulary from tiddler dynamically — vocabulary is hardcoded
 * in `vocabulary.ts` to avoid circular dependency bugs.
 */

import type { ITiddlerFields } from 'tiddlywiki';

import { logger } from '@services/libs/log';
import { WikiChannel } from '@/constants/channels';
import { getSendWikiOperationsToBrowser } from '@services/wiki/wikiOperations/sender/sendWikiOperationsToBrowser';

import {
  KB_BASE_URI,
  resourceIri,
  tiddlerUri,
  uriToTitle,
  FIELD_TO_PROPERTY_URI,
  OBJECT_PROPERTIES,
  GHOST_CLASSES,
  SYSTEM_PROPERTIES,
  HIDDEN_FIELDS,
  SYSTEM_PREFIXES,
  twDateToISO,
  RDF,
  OWL,
} from './vocabulary';
import type { RdfGraphDocument } from './rdfAdapter';
import { createRdfGraphDocument } from './rdfAdapter';

// ─── Triple Types ──────────────────────────────────────────────────────────────

export interface Triple {
  subject: string;
  predicate: string;
  object: string; // URI or literal
  /** True if object is an RDF literal (not a URI). */
  isLiteral: boolean;
  /** Optional language tag for string literals. */
  lang?: string;
  /** Optional datatype URI for typed literals. */
  datatype?: string;
}

export interface Graph {
  id: string;
  triples: Triple[];
  document?: RdfGraphDocument;
}

export interface KnowledgeGraphTiddlerFields extends Omit<ITiddlerFields, 'created' | 'modified'> {
  title?: string;
  text?: string;
  type?: string;
  created?: string | Date;
  modified?: string | Date;
  [fieldName: string]: unknown;
}

// ─── Query Types ──────────────────────────────────────────────────────────────

export interface QueryOptions {
  /** Graph ID (workspace ID). Defaults to active workspace. */
  graph?: string;
  /** Tiddler titles to include in query scope. */
  subjects?: string[];
  /** Named graphs to union. */
  graphs?: string[];
  /** Whether to include system-state triples (default: true). */
  includeSystemState?: boolean;
}

// ─── Mapping Helpers ───────────────────────────────────────────────────────────

/** Convert a TW date string to ISO 8601. */
function formatDate(twDate: string | null | undefined): string {
  return twDateToISO(twDate ?? '') ?? twDate ?? '';
}

/** Check if a tiddler title is a system tiddler (to be excluded). */
function isSystemTiddler(title: string): boolean {
  return SYSTEM_PREFIXES.some((p) => title.startsWith(p));
}

/** Check if a field name is hidden from the KB. */
function isHiddenField(field: string): boolean {
  return HIDDEN_FIELDS.has(field);
}

function knowledgeTypeToClassUri(knowledgeType: string | undefined): string {
  if (!knowledgeType) return GHOST_CLASSES.ENTRY;

  const classByKey = (GHOST_CLASSES as Record<string, string>)[knowledgeType];
  if (classByKey) return classByKey;

  const classByLocalName = Object.values(GHOST_CLASSES).find((classUri) => uriToTitle(classUri) === knowledgeType);
  return classByLocalName ?? GHOST_CLASSES.ENTRY;
}

function classUriToKnowledgeType(classUri: string): string | null {
  const entry = Object.entries(GHOST_CLASSES).find(([, uri]) => uri === classUri);
  return entry?.[0] ?? null;
}

function fieldNameFromPredicate(predicate: string): string {
  if (predicate === RDF.TYPE) return 'knowledge-type';

  const mappedField = Object.entries(FIELD_TO_PROPERTY_URI).find(([, uri]) => uri === predicate)?.[0];
  if (mappedField) return mappedField;

  if (predicate.startsWith(KB_BASE_URI)) {
    return uriToTitle(predicate) ?? predicate.slice(KB_BASE_URI.length);
  }

  return predicate;
}

function isObjectPropertyForWrite(predicate: string, knownObjectProperties: Set<string>): boolean {
  const fieldName = fieldNameFromPredicate(predicate);
  return OBJECT_PROPERTIES.has(fieldName) || knownObjectProperties.has(predicate);
}

function fieldValueFromTriple(triple: Triple, knownObjectProperties: Set<string>): string | null {
  if (triple.predicate === RDF.TYPE) {
    return classUriToKnowledgeType(triple.object);
  }

  const localObjectTitle = uriToTitle(triple.object);
  if (!triple.isLiteral && localObjectTitle) {
    return localObjectTitle;
  }

  if (isObjectPropertyForWrite(triple.predicate, knownObjectProperties)) {
    return localObjectTitle;
  }

  return triple.object;
}

function existingTiddlerFields(existing: unknown): KnowledgeGraphTiddlerFields | undefined {
  if (!existing || typeof existing !== 'object') return undefined;

  const maybeTiddler = existing as { fields?: unknown };
  if (maybeTiddler.fields && typeof maybeTiddler.fields === 'object') {
    return maybeTiddler.fields as KnowledgeGraphTiddlerFields;
  }

  return existing as KnowledgeGraphTiddlerFields;
}

function splitTiddlerTextAndMeta(fields: KnowledgeGraphTiddlerFields | undefined): {
  text: string;
  meta: Partial<ITiddlerFields>;
} {
  const { title: _title, text, ...meta } = fields ?? {};
  return {
    text: typeof text === 'string' ? text : '',
    meta: meta as Partial<ITiddlerFields>,
  };
}

interface TiddlerToTriplesContext {
  knownTitles?: Set<string>;
}

const AUTO_RESOURCE_BUILTIN_FIELDS = new Set(['creator', 'modifier']);

function fieldValueLooksLikeResource(
  fieldName: string,
  isBuiltin: boolean,
  value: string,
  context: TiddlerToTriplesContext | undefined,
): boolean {
  const canAutoResource = !isBuiltin || AUTO_RESOURCE_BUILTIN_FIELDS.has(fieldName);
  return canAutoResource && (context?.knownTitles?.has(value) ?? false);
}

function stringFieldValueToTriple(
  subjectUri: string,
  propertyUri: string,
  fieldName: string,
  rawValue: string,
  isBuiltin: boolean,
  isObjectProperty: boolean,
  context: TiddlerToTriplesContext | undefined,
): Triple {
  if (isObjectProperty || fieldValueLooksLikeResource(fieldName, isBuiltin, rawValue, context)) {
    return {
      subject: subjectUri,
      predicate: propertyUri,
      object: tiddlerUri(rawValue),
      isLiteral: false,
    };
  }

  let datatype: string | undefined;
  let objectValue = rawValue;
  if (fieldName === 'created' || fieldName === 'modified') {
    datatype = 'http://www.w3.org/2001/XMLSchema#dateTime';
    objectValue = formatDate(rawValue);
  } else if (fieldName === 'revision') {
    datatype = 'http://www.w3.org/2001/XMLSchema#integer';
  }

  return {
    subject: subjectUri,
    predicate: propertyUri,
    object: objectValue,
    isLiteral: true,
    datatype,
  };
}

// ─── TW → RDF Mapping ─────────────────────────────────────────────────────────

/**
 * Convert a single TiddlyWiki entry to RDF triples.
 * @param fields Tiddler fields from TW
 * @param graphId The graph (workspace) this tiddler belongs to
 */
export function tiddlerToTriples(
  fields: KnowledgeGraphTiddlerFields,
  _graphId: string,
  context?: TiddlerToTriplesContext,
): Triple[] {
  const title = fields.title as string;
  if (!title || isSystemTiddler(title)) return [];

  const triples: Triple[] = [];
  const subjectUri = tiddlerUri(title);

  for (const [fieldName, rawValue] of Object.entries(fields)) {
    if (isHiddenField(fieldName)) continue;

    // Get the ghost: property URI for this field
    const propertyUri = FIELD_TO_PROPERTY_URI[fieldName] ?? resourceIri(fieldName);
    const isBuiltin = fieldName in FIELD_TO_PROPERTY_URI;

    // Determine if this is an ObjectProperty
    // For built-in fields: check OBJECT_PROPERTIES set
    // For custom fields: treat as DatatypeProperty (future: check KB declaration)
    const isObjectProperty = isBuiltin && OBJECT_PROPERTIES.has(fieldName);

    if (rawValue === undefined || rawValue === null || rawValue === '') continue;

    if (Array.isArray(rawValue)) {
      // Multi-value fields (tags, list)
      if (isObjectProperty) {
        for (const item of rawValue) {
          if (typeof item !== 'string' || item === '') continue;
          triples.push(stringFieldValueToTriple(
            subjectUri,
            propertyUri,
            fieldName,
            item,
            isBuiltin,
            isObjectProperty,
            context,
          ));
        }
      } else {
        const stringItems = rawValue.filter((v) => typeof v === 'string' && v !== '');
        for (const item of stringItems) {
          triples.push(stringFieldValueToTriple(
            subjectUri,
            propertyUri,
            fieldName,
            item,
            isBuiltin,
            isObjectProperty,
            context,
          ));
        }
      }
    } else if (typeof rawValue === 'string') {
      if (rawValue === '') continue;
      triples.push(stringFieldValueToTriple(
        subjectUri,
        propertyUri,
        fieldName,
        rawValue,
        isBuiltin,
        isObjectProperty,
        context,
      ));
    }
  }

  // Always add rdf:type = ghost:Entry (or specific subclass if knowledge-type is set)
  const rdfType = knowledgeTypeToClassUri(fields['knowledge-type'] as string | undefined);

  triples.push({
    subject: subjectUri,
    predicate: RDF.TYPE,
    object: rdfType,
    isLiteral: false,
  });

  return triples;
}

// ─── KB → TW Mapping (Write) ───────────────────────────────────────────────────

export interface TiddlerUpdate {
  /** Tiddler title (from URI last segment). */
  title: string;
  /** Fields to set/update. */
  fields: Partial<ITiddlerFields>;
  /** Fields to delete (remove from tiddler). */
  deleteFields?: string[];
}

/**
 * Map a single RDF triple to a TiddlyWiki field update.
 * Handles ObjectProperty ambiguity by checking KB declarations.
 *
 * @param triple The RDF triple to write
 * @param knownObjectProperties Set of predicate URIs known to be ObjectProperty
 */
export function tripleToTiddlerUpdate(
  triple: Triple,
  knownObjectProperties: Set<string>,
): TiddlerUpdate | null {
  // Resolve subject URI → tiddler title
  const title = uriToTitle(triple.subject);
  if (!title) return null;

  const fieldName = fieldNameFromPredicate(triple.predicate);
  const fieldValue = fieldValueFromTriple(triple, knownObjectProperties);
  if (fieldValue === null) return null;

  return {
    title,
    fields: { [fieldName]: fieldValue },
  };
}

// ─── KB State ──────────────────────────────────────────────────────────────────

export interface KbState {
  /** Map of graph ID → tiddler count */
  graphs: Map<string, Set<string>>;
  /** ObjectProperty declarations (loaded from KB) */
  objectPropertyDeclarations: Set<string>;
  /** Current active workspace */
  activeWorkspace?: string;
  /** Current focused tiddler */
  focusedTiddler?: string;
}

let kbState: KbState = {
  graphs: new Map(),
  objectPropertyDeclarations: new Set(),
};

export function resetKbState(): void {
  kbState = {
    graphs: new Map(),
    objectPropertyDeclarations: new Set(),
  };
}

// ─── Graph Operations ───────────────────────────────────────────────────────────

/**
 * Load all entries from a wiki workspace into the KB graph.
 */
export async function loadGraph(workspaceId: string): Promise<Graph> {
  const sender = getSendWikiOperationsToBrowser(workspaceId);

  // Get all non-system tiddlers
  const tiddlers = await (sender[WikiChannel.getTiddlersAsJson] as unknown as (filter: string) => Promise<ITiddlerFields[] | undefined>)('[!is[system]]');

  if (!tiddlers || !Array.isArray(tiddlers)) {
    logger.warn('[KnowledgeGraph] loadGraph: no tiddlers returned', { workspaceId });
    return withRdfDocument({ id: workspaceId, triples: [] });
  }

  const allTriples: Triple[] = [];

  const knownTitles = new Set(
    tiddlers
      .map((t) => t.title)
      .filter((title): title is string => typeof title === 'string' && title !== ''),
  );

  // Load entries
  for (const fields of tiddlers) {
    const triples = tiddlerToTriples(fields, workspaceId, { knownTitles });
    allTriples.push(...triples);
  }

  // Scan for owl:ObjectProperty declarations
  const declarations = new Set<string>();
  for (const triple of allTriples) {
    if (
      triple.predicate === RDF.TYPE &&
      triple.object === OWL.OBJECT_PROPERTY
    ) {
      // Subject is a property URI — extract and add to declarations
      const propTitle = uriToTitle(triple.subject);
      if (propTitle) {
        const fieldName = propTitle.startsWith(KB_BASE_URI)
          ? propTitle.slice(KB_BASE_URI.length)
          : propTitle;
        declarations.add(resourceIri(fieldName));
      }
    }
  }

  // Update state
  const graphEntries = new Set(
    tiddlers.map((t) => t.title as string),
  );

  kbState.graphs.set(workspaceId, graphEntries);
  kbState.objectPropertyDeclarations = declarations;

  logger.info('[KnowledgeGraph] loaded graph', {
    workspaceId,
    entryCount: graphEntries.size,
    tripleCount: allTriples.length,
    objectPropertyDeclarations: declarations.size,
  });

  return withRdfDocument({ id: workspaceId, triples: allTriples });
}

async function withRdfDocument(graph: Graph): Promise<Graph> {
  return {
    ...graph,
    document: await createRdfGraphDocument(graph, {
      format: 'N3',
      prefixes: { kb: KB_BASE_URI },
    }),
  };
}

/**
 * Inject system-state triples into a graph.
 */
export function injectSystemStateTriples(graph: Graph): Graph {
  const triples = [...graph.triples];

  // current-workspace
  if (kbState.activeWorkspace) {
    triples.push({
      subject: KB_BASE_URI,
      predicate: SYSTEM_PROPERTIES.CURRENT_WORKSPACE,
      object: tiddlerUri(kbState.activeWorkspace),
      isLiteral: false,
    });
  }

  // focused-tiddler
  if (kbState.focusedTiddler) {
    triples.push({
      subject: KB_BASE_URI,
      predicate: SYSTEM_PROPERTIES.FOCUSED_TIDDLER,
      object: tiddlerUri(kbState.focusedTiddler),
      isLiteral: false,
    });
  }

  return { ...graph, triples };
}

// ─── Query (TW → RDF → Query Result) ──────────────────────────────────────────

/**
 * Simple triple pattern matching.
 * Supports `?s ?p ?o` wildcards (null in pattern means "match any").
 */
export function queryTriples(
  graph: Graph,
  pattern: { subject?: string | null; predicate?: string | null; object?: string | null },
): Triple[] {
  return graph.triples.filter((t) => {
    if (pattern.subject !== null && pattern.subject !== undefined && t.subject !== pattern.subject) return false;
    if (pattern.predicate !== null && pattern.predicate !== undefined && t.predicate !== pattern.predicate) return false;
    if (pattern.object !== null && pattern.object !== undefined && t.object !== pattern.object) return false;
    return true;
  });
}

/**
 * Build a graph from workspace entries and optionally apply inference.
 * This is the main entry point for MCP kb_query.
 */
export async function buildQueryGraph(
  workspaceId: string,
  options: QueryOptions = {},
): Promise<Graph> {
  // Load or refresh graph from TW
  let graph = await loadGraph(workspaceId);

  // Filter by subject list if provided
  if (options.subjects?.length) {
    const subjectUris = new Set(options.subjects.map((s) => tiddlerUri(s)));
    graph = {
      ...graph,
      triples: graph.triples.filter((t) => subjectUris.has(t.subject)),
    };
  }

  // Inject system-state triples
  if (options.includeSystemState !== false) {
    graph = injectSystemStateTriples(graph);
  }

  return withRdfDocument(graph);
}

// ─── Write Operations ─────────────────────────────────────────────────────────

/**
 * Write a triple to TiddlyWiki.
 * Handles ObjectProperty by checking known declarations first,
 * then falls back to DatatypeProperty (string value).
 */
export async function writeTriple(
  triple: Triple,
  workspaceId: string,
): Promise<{ success: boolean; error?: string }> {
  const title = uriToTitle(triple.subject);
  if (!title) {
    return { success: false, error: `Invalid subject URI: ${triple.subject}` };
  }

  const fieldName = fieldNameFromPredicate(triple.predicate);
  const fieldValue = fieldValueFromTriple(triple, kbState.objectPropertyDeclarations);
  if (fieldValue === null) {
    return { success: false, error: `Cannot map triple to TiddlyWiki field: ${triple.predicate} ${triple.object}` };
  }

  try {
    const sender = getSendWikiOperationsToBrowser(workspaceId);

    const existing = existingTiddlerFields(await sender[WikiChannel.getTiddler](title));
    const { text: existingText, meta: existingMeta } = splitTiddlerTextAndMeta(existing);
    const defaultMeta: Partial<ITiddlerFields> = existing
      ? {}
      : { creator: 'Agent' };
    const nextText = fieldName === 'text' ? fieldValue : existingText;
    const fieldsToUpdate: Partial<ITiddlerFields> = fieldName === 'text'
      ? { type: 'text/markdown', ...defaultMeta, ...existingMeta }
      : { ...defaultMeta, ...existingMeta, [fieldName]: fieldValue };

    await sender[WikiChannel.addTiddler](title, nextText, fieldsToUpdate, { withDate: true });

    logger.info('[KnowledgeGraph] wrote triple', { title, fieldName, fieldValue });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[KnowledgeGraph] write failed', { error: message });
    return { success: false, error: message };
  }
}

/**
 * Delete a triple from TiddlyWiki.
 * For DatatypeProperty: set field to empty string (TW will treat as deleted).
 * For ObjectProperty: clear the field.
 */
export async function deleteTriple(
  triple: Triple,
  workspaceId: string,
): Promise<{ success: boolean; error?: string }> {
  const title = uriToTitle(triple.subject);
  if (!title) return { success: false, error: `Invalid subject URI: ${triple.subject}` };

  const fieldName = fieldNameFromPredicate(triple.predicate);

  try {
    const sender = getSendWikiOperationsToBrowser(workspaceId);
    const existing = existingTiddlerFields(await sender[WikiChannel.getTiddler](title));
    if (!existing) return { success: true }; // Already gone

    const { text: existingText, meta: existingMeta } = splitTiddlerTextAndMeta(existing);
    const nextText = fieldName === 'text' ? '' : existingText;
    const fieldsToDelete: Partial<ITiddlerFields> = fieldName === 'text'
      ? existingMeta
      : { ...existingMeta, [fieldName]: '' };
    await sender[WikiChannel.addTiddler](title, nextText, fieldsToDelete, { withDate: true });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message };
  }
}

// ─── System State ──────────────────────────────────────────────────────────────

export function updateSystemState(workspaceId: string | undefined, tiddlerTitle: string | undefined): void {
  kbState.activeWorkspace = workspaceId;
  kbState.focusedTiddler = tiddlerTitle;
}

export function getSystemState(): Pick<KbState, 'activeWorkspace' | 'focusedTiddler'> {
  return {
    activeWorkspace: kbState.activeWorkspace,
    focusedTiddler: kbState.focusedTiddler,
  };
}

// ─── ObjectProperty Declarations ───────────────────────────────────────────────

/**
 * Check if a predicate is declared as ObjectProperty in the KB.
 */
export function isObjectPropertyPredicate(predicateUri: string): boolean {
  return kbState.objectPropertyDeclarations.has(predicateUri);
}

/**
 * Update ObjectProperty declarations from a set of triples.
 */
export function updateObjectPropertyDeclarations(triples: Triple[]): void {
  for (const triple of triples) {
    if (triple.predicate === RDF.TYPE && triple.object === OWL.OBJECT_PROPERTY) {
      kbState.objectPropertyDeclarations.add(triple.subject);
    }
  }
}