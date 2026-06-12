import { describe, expect, it, vi } from 'vitest';
import { DataFactory } from 'n3';
import type { Graph, Triple } from '../index';
import { FIELD_TO_PROPERTY_URI, GHOST_CLASSES, KB_BASE_URI, RDF } from '../vocabulary';

const n3reasoner = vi.fn();

vi.mock('eyereasoner', () => ({
  n3reasoner,
}));

vi.mock('@services/libs/log', () => ({
  logger: {
    warn: vi.fn(),
  },
}));

const baseTriple: Triple = {
  subject: `${KB_BASE_URI}Socrates`,
  predicate: RDF.TYPE,
  object: `${KB_BASE_URI}Human`,
  isLiteral: false,
};

const enabledRuleContent = `
@prefix : <http://worldshell.online/ghost/kb/>.
{ ?S a :Human } => { ?S a :Mortal }.
`;

const ruleTriples: Triple[] = [
  {
    subject: `${KB_BASE_URI}Rule%3AHumanMortal`,
    predicate: RDF.TYPE,
    object: GHOST_CLASSES.RULE,
    isLiteral: false,
  },
  {
    subject: `${KB_BASE_URI}Rule%3AHumanMortal`,
    predicate: FIELD_TO_PROPERTY_URI.text,
    object: enabledRuleContent,
    isLiteral: true,
  },
];

const disabledRuleTriples: Triple[] = [
  {
    subject: `${KB_BASE_URI}Rule%3ADisabled`,
    predicate: RDF.TYPE,
    object: GHOST_CLASSES.RULE,
    isLiteral: false,
  },
  {
    subject: `${KB_BASE_URI}Rule%3ADisabled`,
    predicate: FIELD_TO_PROPERTY_URI.text,
    object: '{ ?S a :Human } => { ?S a :Ignored }.',
    isLiteral: true,
  },
  {
    subject: `${KB_BASE_URI}Rule%3ADisabled`,
    predicate: `${KB_BASE_URI}状态`,
    object: '禁用',
    isLiteral: true,
  },
];

function graph(triples: Triple[]): Graph {
  return { id: 'workspace', triples };
}

describe('eyeReasoner', () => {
  it('extracts enabled Rule nodes from graph content and skips disabled rules', async () => {
    const { extractEnabledEyeRules } = await import('../eyeReasoner');
    const rules = extractEnabledEyeRules(graph([baseTriple, ...ruleTriples, ...disabledRuleTriples]));

    expect(rules).toEqual([
      {
        title: 'Rule:HumanMortal',
        subject: `${KB_BASE_URI}Rule%3AHumanMortal`,
        text: enabledRuleContent.trim(),
      },
    ]);
  });

  it('calls eyereasoner with graph data plus enabled rules and returns only new triples', async () => {
    const derivedQuad = DataFactory.quad(
      DataFactory.namedNode(`${KB_BASE_URI}Socrates`),
      DataFactory.namedNode(RDF.TYPE),
      DataFactory.namedNode(`${KB_BASE_URI}Mortal`),
    );
    n3reasoner.mockResolvedValueOnce([derivedQuad]);

    const { inferWithEye } = await import('../eyeReasoner');
    const result = await inferWithEye(graph([baseTriple, ...ruleTriples]));

    expect(n3reasoner).toHaveBeenCalledWith(
      [expect.stringContaining('<http://worldshell.online/ghost/kb/Socrates>'), enabledRuleContent.trim()],
      undefined,
      { output: 'derivations', outputType: 'quads' },
    );
    expect(result.rules.map((rule) => rule.title)).toEqual(['Rule:HumanMortal']);
    expect(result.inferredTriples).toEqual([
      {
        subject: `${KB_BASE_URI}Socrates`,
        predicate: RDF.TYPE,
        object: `${KB_BASE_URI}Mortal`,
        isLiteral: false,
      },
    ]);
  });

  it('returns base graph when EYE fails', async () => {
    n3reasoner.mockRejectedValueOnce(new Error('wasm failed'));

    const { inferWithEye } = await import('../eyeReasoner');
    const input = graph([baseTriple, ...ruleTriples]);
    const result = await inferWithEye(input);

    expect(result.graph).toBe(input);
    expect(result.inferredTriples).toEqual([]);
    expect(result.rules.map((rule) => rule.title)).toEqual(['Rule:HumanMortal']);
  });
});