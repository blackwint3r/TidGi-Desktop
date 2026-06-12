/**
 * Ghost KB Vocabulary — hardcoded constants.
 * Not loaded from tiddler dynamically, to avoid circular dependency bugs.
 *
 * KB base URI: http://worldshell.online/ghost/kb/
 * All tiddler URIs resolve as: {KB_BASE_URI}{title}
 *
 * See: docs/vocabulary.md, docs/architecture.md, docs/ontology.md
 */

/** KB base URI — used as subject for system-state triples. */
export const KB_BASE_URI = 'http://worldshell.online/ghost/kb/';

/** Tiddler title → full URI. */
export function resourceIri(localName: string, baseUri = KB_BASE_URI): string {
  return `${baseUri}${encodeIriPathSegment(localName)}`;
}

/** Full URI → local resource name under a base URI. */
export function iriToLocalName(uri: string, baseUri = KB_BASE_URI): string | null {
  if (!uri.startsWith(baseUri)) return null;
  return decodeIriPathSegment(uri.slice(baseUri.length));
}

/** Tiddler title → full URI. */
export function tiddlerUri(title: string): string {
  return resourceIri(title);
}

/** Full URI → tiddler title (reverse of tiddlerUri). */
export function uriToTitle(uri: string): string | null {
  return iriToLocalName(uri);
}

function encodeIriPathSegment(value: string): string {
  return Array.from(value)
    .map((char) => shouldEscapeIriPathChar(char) ? encodeUtf8Bytes(char) : char)
    .join('');
}

function decodeIriPathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function shouldEscapeIriPathChar(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) return true;
  if (codePoint <= 0x20 || codePoint === 0x7f) return true;
  return '%<>"{}|\\^`/?#[]@'.includes(char);
}

function encodeUtf8Bytes(char: string): string {
  return Array.from(new TextEncoder().encode(char))
    .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
    .join('');
}

// ─── W3C Standard Vocabulary URIs ─────────────────────────────────────────────

export const RDF = {
  TYPE: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  PROPERTY: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#Property',
} as const;

export const RDFS = {
  DOMAIN: 'http://www.w3.org/2000/01/rdf-schema#domain',
  RANGE: 'http://www.w3.org/2000/01/rdf-schema#range',
  LABEL: 'http://www.w3.org/2000/01/rdf-schema#label',
  COMMENT: 'http://www.w3.org/2000/01/rdf-schema#comment',
  SUBCLASSOF: 'http://www.w3.org/2000/01/rdf-schema#subClassOf',
  SUBPROPERTYOF: 'http://www.w3.org/2000/01/rdf-schema#subPropertyOf',
} as const;

export const OWL = {
  CLASS: 'http://www.w3.org/2002/07/owl#Class',
  OBJECT_PROPERTY: 'http://www.w3.org/2002/07/owl#ObjectProperty',
  DATATYPE_PROPERTY: 'http://www.w3.org/2002/07/owl#DatatypeProperty',
} as const;

export const XSD = {
  STRING: 'http://www.w3.org/2001/XMLSchema#string',
  INTEGER: 'http://www.w3.org/2001/XMLSchema#integer',
  DATE_TIME: 'http://www.w3.org/2001/XMLSchema#dateTime',
} as const;

// ─── ghost: Property URIs ──────────────────────────────────────────────────────

/**
 * Maps TiddlyWiki field names to ghost: property URIs.
 * Keys are the raw field names used in TW; values are full URIs.
 */
export const FIELD_TO_PROPERTY_URI: Record<string, string> = {
  title: `${KB_BASE_URI}title`,
  text: `${KB_BASE_URI}content`,
  type: `${KB_BASE_URI}format`,
  created: `${KB_BASE_URI}created`,
  modified: `${KB_BASE_URI}modified`,
  creator: `${KB_BASE_URI}creator`,
  modifier: `${KB_BASE_URI}modifier`,
  tags: `${KB_BASE_URI}tags`,
  list: `${KB_BASE_URI}list`,
  revision: `${KB_BASE_URI}revision`,
  'draft.of': `${KB_BASE_URI}draftOf`,
  'draft.title': `${KB_BASE_URI}draftTitle`,
} as const;

/**
 * Fields that are owl:ObjectProperty (value is another tiddler URI, not literal).
 * ObjectProperty declaration triples are also stored in the KB.
 */
export const OBJECT_PROPERTIES = new Set<string>([
  'tags',
  'list',
  'draft.of',
]);

// ─── ghost: Classes ────────────────────────────────────────────────────────────

export const GHOST_CLASSES = {
  ENTRY: `${KB_BASE_URI}Entry`,
  GRAPH: `${KB_BASE_URI}Graph`,
  RULE: `${KB_BASE_URI}Rule`,
  TAG: `${KB_BASE_URI}Tag`,
  USER: `${KB_BASE_URI}User`,
} as const;

// ─── ghost: System Properties ──────────────────────────────────────────────────

/** These properties have KB_BASE_URI as subject (not entry URIs). */
export const SYSTEM_PROPERTIES = {
  CURRENT_WORKSPACE: `${KB_BASE_URI}current-workspace`,
  FOCUSED_TIDDLER: `${KB_BASE_URI}focused-tiddler`,
} as const;

// ─── Standard ghost: Property Definitions ─────────────────────────────────────

/**
 * Property metadata used by the mapping layer.
 * For custom/user fields, fall back to DatatypeProperty.
 */
export interface PropertyDefinition {
  uri: string;
  propertyType: 'ObjectProperty' | 'DatatypeProperty';
  range: string;
  label: string;
  comment: string;
}

export const PROPERTY_DEFINITIONS: Record<string, PropertyDefinition> = {
  title: {
    uri: `${KB_BASE_URI}title`,
    propertyType: 'DatatypeProperty',
    range: XSD.STRING,
    label: 'Title',
    comment: 'Tiddler title, also the last segment of its URI',
  },
  content: {
    uri: `${KB_BASE_URI}content`,
    propertyType: 'DatatypeProperty',
    range: XSD.STRING,
    label: 'Content',
    comment: 'The body text of a tiddler',
  },
  format: {
    uri: `${KB_BASE_URI}format`,
    propertyType: 'DatatypeProperty',
    range: XSD.STRING,
    label: 'Content Format',
    comment: 'Content serialization format, e.g. text/vnd.tiddlywiki',
  },
  created: {
    uri: `${KB_BASE_URI}created`,
    propertyType: 'DatatypeProperty',
    range: XSD.DATE_TIME,
    label: 'Created',
    comment: 'Creation timestamp (TW format → ISO 8601)',
  },
  modified: {
    uri: `${KB_BASE_URI}modified`,
    propertyType: 'DatatypeProperty',
    range: XSD.DATE_TIME,
    label: 'Modified',
    comment: 'Last modification timestamp',
  },
  creator: {
    uri: `${KB_BASE_URI}creator`,
    propertyType: 'DatatypeProperty',
    range: XSD.STRING,
    label: 'Creator',
    comment: 'Username of the tiddler creator',
  },
  modifier: {
    uri: `${KB_BASE_URI}modifier`,
    propertyType: 'DatatypeProperty',
    range: XSD.STRING,
    label: 'Modifier',
    comment: 'Username of the last modifier',
  },
  tags: {
    uri: `${KB_BASE_URI}tags`,
    propertyType: 'ObjectProperty',
    range: GHOST_CLASSES.TAG,
    label: 'Tags',
    comment: 'Tags associated with the tiddler (object property → tag tiddler)',
  },
  list: {
    uri: `${KB_BASE_URI}list`,
    propertyType: 'ObjectProperty',
    range: GHOST_CLASSES.ENTRY,
    label: 'List',
    comment: 'Ordered list of tiddler references',
  },
  draftOf: {
    uri: `${KB_BASE_URI}draftOf`,
    propertyType: 'ObjectProperty',
    range: GHOST_CLASSES.ENTRY,
    label: 'Draft Of',
    comment: 'Points to the original tiddler this draft is editing',
  },
  draftTitle: {
    uri: `${KB_BASE_URI}draftTitle`,
    propertyType: 'DatatypeProperty',
    range: XSD.STRING,
    label: 'Draft Title',
    comment: 'Temporary title of a draft',
  },
  revision: {
    uri: `${KB_BASE_URI}revision`,
    propertyType: 'DatatypeProperty',
    range: XSD.INTEGER,
    label: 'Revision',
    comment: 'Revision count (TW revision field)',
  },
} as const;

// ─── Field Visibility ─────────────────────────────────────────────────────────

/**
 * Hardcoded list of TW system fields to hide from the KB layer.
 * All other fields (including custom ones) are visible by default.
 */
export const HIDDEN_FIELDS = new Set<string>([
  'field:start',
  'field:end',
  'plugin-type',
  'module-type',
  'plugin-priority',
  'dependents',
  'requires',
  'icon',
  'caption',
  'description',
  'documentation',
]);

/**
 * System tiddler prefixes — entries starting with these are excluded from KB.
 */
export const SYSTEM_PREFIXES: readonly string[] = ['$/'];

// ─── Type Conversions ──────────────────────────────────────────────────────────

/**
 * Convert TiddlyWiki date string (YYYYMMDDHHMMSSmmm) to ISO 8601.
 * Returns null if input is not a valid TW date string.
 */
export function twDateToISO(twDate: string): string | null {
  if (!twDate || typeof twDate !== 'string' || twDate.length < 14) return null;
  const m = twDate.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})?$/);
  if (!m) return null;
  const [, year, month, day, hour, minute, second, ms = '000'] = m;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`;
}

// ─── URI Helpers ───────────────────────────────────────────────────────────────

/** Returns true if the given URI is a ghost: property URI. */
export function isGhostProperty(uri: string): boolean {
  return uri.startsWith(KB_BASE_URI) && !uri.includes('#');
}

/** Returns true if the given URI is a standard vocabulary term (RDF/RDFS/OWL/XSD). */
export function isStandardVocabulary(uri: string): boolean {
  return (
    uri.startsWith('http://www.w3.org/1999/02/22-rdf-syntax-ns#') ||
    uri.startsWith('http://www.w3.org/2000/01/rdf-schema#') ||
    uri.startsWith('http://www.w3.org/2002/07/owl#') ||
    uri.startsWith('http://www.w3.org/2001/XMLSchema#')
  );
}