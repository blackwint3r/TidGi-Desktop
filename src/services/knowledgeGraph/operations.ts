import {
  deleteTriple,
  injectSystemStateTriples,
  loadGraph,
  writeTriple,
  type Graph,
  type Triple,
} from './index';
import {
  assertionsToRdfStarN3,
  createVirtualAssertion,
  exactMatches,
  matchesAssertionPattern,
  tripleKey,
  type Assertion,
  type AssertionPattern,
  type UpdateDecision,
} from './assertions';
import { explicitAssertions, inferAssertions } from './reasoner';

export interface QueryAssertionsOptions extends AssertionPattern {
  includeSystemState?: boolean;
}

export interface QueryAssertionsResult {
  graph: string;
  assertions: Assertion[];
  rdfStar: string;
}

export interface KnowledgePatch {
  delete?: Triple[];
  insert?: Triple[];
}

export interface PatchOperationDecision {
  action: 'delete' | 'write';
  triple: Triple;
  decision: UpdateDecision;
}

export interface PatchWithPolicyResult {
  success: boolean;
  graph: string;
  operations: PatchOperationDecision[];
  error?: string;
}

export async function queryAssertions(workspaceId: string, options: QueryAssertionsOptions = {}): Promise<QueryAssertionsResult> {
  const baseGraph = await loadGraph(workspaceId);
  const explicit = explicitAssertions(baseGraph);
  const derived = await inferAssertions(baseGraph);
  const virtual = options.includeSystemState === false ? [] : virtualAssertions(baseGraph);

  const assertions = [...explicit, ...derived, ...virtual].filter((assertion) => matchesAssertionPattern(assertion, options));

  return { graph: workspaceId, assertions, rdfStar: assertionsToRdfStarN3(assertions) };
}

export async function proposeWrite(workspaceId: string, triple: Triple, options: QueryAssertionsOptions = {}): Promise<UpdateDecision> {
  const { assertions } = await queryAssertions(workspaceId, { ...options, includeSystemState: true });
  const matches = exactMatches(assertions, triple);
  const writableMatches = matches.filter((assertion) => assertion.writable);
  const blockedMatches = matches.filter((assertion) => !assertion.writable);

  if (blockedMatches.length > 0) {
    return rejectUpdate('write', triple, blockedMatches);
  }

  if (writableMatches.length > 0) {
    return {
      allowed: true,
      action: 'write',
      reason: '目标事实已经是可写显式事实，写入是幂等或可更新操作。',
      target: triple,
      matchingAssertions: writableMatches,
    };
  }

  return {
    allowed: true,
    action: 'write',
    reason: '目标事实当前不存在，可以作为显式事实写入。',
    target: triple,
    matchingAssertions: [],
  };
}

export async function proposeDelete(workspaceId: string, triple: Triple, options: QueryAssertionsOptions = {}): Promise<UpdateDecision> {
  const { assertions } = await queryAssertions(workspaceId, { ...options, includeSystemState: true });
  const matches = exactMatches(assertions, triple);
  const writableMatches = matches.filter((assertion) => assertion.writable);
  const blockedMatches = matches.filter((assertion) => !assertion.writable);

  if (blockedMatches.length > 0) {
    return rejectUpdate('delete', triple, blockedMatches);
  }

  if (writableMatches.length > 0) {
    return {
      allowed: true,
      action: 'delete',
      reason: '目标事实是可写显式事实，可以删除对应的 Tiddler 字段。',
      target: triple,
      matchingAssertions: writableMatches,
    };
  }

  return {
    allowed: true,
    action: 'delete',
    reason: '目标事实当前不存在，删除是空操作。',
    target: triple,
    matchingAssertions: [],
  };
}

export async function writeWithPolicy(workspaceId: string, triple: Triple, options: QueryAssertionsOptions = {}): Promise<{ success: boolean; decision: UpdateDecision; error?: string }> {
  const decision = await proposeWrite(workspaceId, triple, options);
  if (!decision.allowed) return { success: false, decision, error: decision.reason };

  const result = await writeTriple(triple, workspaceId);
  return { ...result, decision };
}

export async function deleteWithPolicy(workspaceId: string, triple: Triple, options: QueryAssertionsOptions = {}): Promise<{ success: boolean; decision: UpdateDecision; error?: string }> {
  const decision = await proposeDelete(workspaceId, triple, options);
  if (!decision.allowed) return { success: false, decision, error: decision.reason };

  const result = await deleteTriple(triple, workspaceId);
  return { ...result, decision };
}

export async function patchWithPolicy(workspaceId: string, patch: KnowledgePatch, options: QueryAssertionsOptions = {}): Promise<PatchWithPolicyResult> {
  const deleteTriples = patch.delete ?? [];
  const insertTriples = patch.insert ?? [];
  const operations: PatchOperationDecision[] = [];

  if (deleteTriples.length === 0 && insertTriples.length === 0) {
    return { success: false, graph: workspaceId, operations, error: 'Patch requires at least one delete or insert statement.' };
  }

  for (const triple of deleteTriples) {
    const decision = await proposeDelete(workspaceId, triple, options);
    operations.push({ action: 'delete', triple, decision });
  }

  for (const triple of insertTriples) {
    const decision = await proposeWrite(workspaceId, triple, options);
    operations.push({ action: 'write', triple, decision });
  }

  const rejected = operations.find((operation) => !operation.decision.allowed);
  if (rejected) {
    return { success: false, graph: workspaceId, operations, error: rejected.decision.reason };
  }

  for (const triple of deleteTriples) {
    const result = await deleteTriple(triple, workspaceId);
    if (!result.success) return { success: false, graph: workspaceId, operations, error: result.error ?? 'Patch delete failed.' };
  }

  for (const triple of insertTriples) {
    const result = await writeTriple(triple, workspaceId);
    if (!result.success) return { success: false, graph: workspaceId, operations, error: result.error ?? 'Patch insert failed.' };
  }

  return { success: true, graph: workspaceId, operations };
}

function virtualAssertions(baseGraph: Graph): Assertion[] {
  const explicitKeys = new Set(baseGraph.triples.map(tripleKey));
  const graphWithSystemState = injectSystemStateTriples(baseGraph);
  return graphWithSystemState.triples
    .filter((triple) => !explicitKeys.has(tripleKey(triple)))
    .map(createVirtualAssertion);
}

function rejectUpdate(action: 'write' | 'delete', target: Triple, matchingAssertions: Assertion[]): UpdateDecision {
  const descriptions = Array.from(new Set(matchingAssertions.flatMap(describeReadonlyAssertion))).join('、');
  return {
    allowed: false,
    action,
    reason: `目标事实受 ${descriptions} 保护，不能直接${action === 'write' ? '写入覆盖' : '删除'}。`,
    target,
    matchingAssertions,
    alternatives: [
      '修改产生该结论的基础事实。',
      '修改或停用产生该结论的规则。',
      '如果这是系统管理字段，改用对应的系统流程更新。',
    ],
  };
}

function describeReadonlyAssertion(assertion: Assertion): string[] {
  const readonlyPolicies = assertion.provenance
    .filter((provenance) => provenance.type === 'readonly-policy')
    .map((provenance) => provenance.policy);

  if (readonlyPolicies.length > 0) return readonlyPolicies;
  if (assertion.kind === 'derived') return ['derived-rule'];
  if (assertion.kind === 'virtual') return ['virtual-system-state'];
  return ['read-only policy'];
}