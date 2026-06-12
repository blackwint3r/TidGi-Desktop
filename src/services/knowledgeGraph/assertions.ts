import {
  FIELD_TO_PROPERTY_URI,
  KB_BASE_URI,
  resourceIri,
  uriToTitle,
} from './vocabulary';
import type { Triple } from './index';

export type AssertionKind = 'explicit' | 'derived' | 'virtual';
export type ReadonlyPolicy = 'system-managed-field' | 'identity-local-name' | 'derived-rule' | 'virtual-system-state';

export type Provenance =
  | { type: 'tiddler-field'; title: string; field: string }
  | { type: 'readonly-policy'; policy: ReadonlyPolicy; field: string }
  | { type: 'rule'; title: string }
  | { type: 'system-state'; key: string };

export interface Assertion {
  triple: Triple;
  kind: AssertionKind;
  provenance: Provenance[];
  writable: boolean;
}

export type UpdateAction = 'write' | 'delete';

export type UpdateDecision =
  | {
      allowed: true;
      action: UpdateAction;
      reason: string;
      target: Triple;
      matchingAssertions: Assertion[];
    }
  | {
      allowed: false;
      action: UpdateAction;
      reason: string;
      target: Triple;
      matchingAssertions: Assertion[];
      alternatives: string[];
    };

export interface AssertionPattern {
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
}

export function tripleKey(triple: Triple): string {
  return JSON.stringify({
    subject: triple.subject,
    predicate: triple.predicate,
    object: triple.object,
    isLiteral: triple.isLiteral,
  });
}

export function triplesEqual(left: Triple, right: Triple): boolean {
  return tripleKey(left) === tripleKey(right);
}

export function matchesAssertionPattern(assertion: Assertion, pattern: AssertionPattern): boolean {
  const { triple } = assertion;
  if (pattern.subject !== null && pattern.subject !== undefined && triple.subject !== pattern.subject) return false;
  if (pattern.predicate !== null && pattern.predicate !== undefined && triple.predicate !== pattern.predicate) return false;
  if (pattern.object !== null && pattern.object !== undefined && triple.object !== pattern.object) return false;
  return true;
}

const READONLY_FIELD_POLICIES = new Map<string, ReadonlyPolicy>([
  [FIELD_TO_PROPERTY_URI.title, 'identity-local-name'],
  [`${KB_BASE_URI}localName`, 'identity-local-name'],
  [FIELD_TO_PROPERTY_URI.created, 'system-managed-field'],
  [FIELD_TO_PROPERTY_URI.modified, 'system-managed-field'],
  [FIELD_TO_PROPERTY_URI.revision, 'system-managed-field'],
]);

export function createExplicitAssertion(triple: Triple): Assertion {
  const readonlyPolicy = readonlyPolicyForTriple(triple);
  const provenance: Provenance[] = [explicitProvenanceForTriple(triple)];

  if (readonlyPolicy) {
    provenance.push({
      type: 'readonly-policy',
      policy: readonlyPolicy,
      field: fieldNameForPredicate(triple.predicate),
    });
  }

  return {
    triple,
    kind: 'explicit',
    provenance,
    writable: readonlyPolicy === null,
  };
}

export function createDerivedAssertion(triple: Triple, ruleTitles: string[]): Assertion {
  return {
    triple,
    kind: 'derived',
    provenance: [
      ...ruleTitles.map((title) => ({ type: 'rule' as const, title })),
      { type: 'readonly-policy', policy: 'derived-rule', field: fieldNameForPredicate(triple.predicate) },
    ],
    writable: false,
  };
}

export function createVirtualAssertion(triple: Triple): Assertion {
  return {
    triple,
    kind: 'virtual',
    provenance: [
      virtualProvenanceForTriple(triple),
      { type: 'readonly-policy', policy: 'virtual-system-state', field: fieldNameForPredicate(triple.predicate) },
    ],
    writable: false,
  };
}

export function exactMatches(assertions: Assertion[], target: Triple): Assertion[] {
  return assertions.filter((assertion) => triplesEqual(assertion.triple, target));
}

export function assertionsToRdfStarN3(assertions: Assertion[]): string {
  const body = assertions
    .map(assertionToRdfStarN3)
    .filter(Boolean)
    .join('\n\n');

  return [
    `@prefix kb: <${KB_BASE_URI}> .`,
    '',
    body,
  ].filter((part) => part !== '').join('\n');
}

export function assertionToRdfStarN3(assertion: Assertion): string {
  const statement = `<< ${termToN3(assertion.triple.subject, false)} ${termToN3(assertion.triple.predicate, false)} ${termToN3(assertion.triple.object, assertion.triple.isLiteral, assertion.triple)} >>`;
  const metadata = [
    `kb:writable ${assertion.writable ? 'true' : 'false'}`,
    `kb:assertionKind ${termToN3(assertionKindUri(assertion.kind), false)}`,
    ...assertion.provenance.flatMap(provenanceToN3),
  ];

  return `${statement}\n  ${metadata.join(' ;\n  ')} .`;
}

function assertionKindUri(kind: AssertionKind): string {
  return resourceIri(kind[0].toUpperCase() + kind.slice(1));
}

function provenanceToN3(provenance: Provenance): string[] {
  if (provenance.type === 'tiddler-field') {
    return [
      `kb:provenanceSource kb:TiddlyWiki`,
      `kb:provenanceTitle ${termToN3(provenance.title, true)}`,
      `kb:provenanceField ${termToN3(provenance.field, true)}`,
    ];
  }

  if (provenance.type === 'readonly-policy') {
    return [
      `kb:readonlyReason ${termToN3(resourceIri(provenance.policy), false)}`,
      `kb:provenanceField ${termToN3(provenance.field, true)}`,
    ];
  }

  if (provenance.type === 'rule') {
    return [`kb:derivedBy ${termToN3(resourceIri(provenance.title), false)}`];
  }

  return [
    `kb:provenanceSource kb:SystemState`,
    `kb:provenanceKey ${termToN3(provenance.key, true)}`,
  ];
}

function termToN3(value: string, isLiteral: boolean, triple?: Triple): string {
  if (!isLiteral) return iriToN3(value);

  const literalValue = JSON.stringify(value);
  if (triple?.lang) return `${literalValue}@${triple.lang}`;
  if (triple?.datatype) return `${literalValue}^^${iriToN3(triple.datatype)}`;
  return literalValue;
}

function iriToN3(uri: string): string {
  if (uri.startsWith(KB_BASE_URI)) {
    const localName = uri.slice(KB_BASE_URI.length);
    if (isSafePrefixedNameLocal(localName)) return `kb:${localName}`;
  }
  return `<${uri}>`;
}

function isSafePrefixedNameLocal(localName: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(localName);
}

function explicitProvenanceForTriple(triple: Triple): Provenance {
  const title = uriToTitle(triple.subject) ?? triple.subject;
  const field = fieldNameForPredicate(triple.predicate);
  return { type: 'tiddler-field', title, field };
}

function readonlyPolicyForTriple(triple: Triple): ReadonlyPolicy | null {
  return READONLY_FIELD_POLICIES.get(triple.predicate) ?? null;
}

function fieldNameForPredicate(predicate: string): string {
  if (!predicate.startsWith(KB_BASE_URI)) return predicate;

  const localName = predicate.slice(KB_BASE_URI.length);
  if (localName === 'content') return 'text';
  if (localName === 'format') return 'type';
  if (localName === 'draftOf') return 'draft.of';
  if (localName === 'draftTitle') return 'draft.title';
  return localName;
}

function virtualProvenanceForTriple(triple: Triple): Provenance {
  const key = fieldNameForPredicate(triple.predicate);
  return { type: 'system-state', key };
}