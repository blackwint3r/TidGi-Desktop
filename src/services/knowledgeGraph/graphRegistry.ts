import { container } from '@services/container';
import serviceIdentifier from '@services/serviceIdentifier';
import { isWikiWorkspace, type IWikiWorkspace, type IWorkspace, type IWorkspaceService } from '@services/workspaces/interface';
import { KB_BASE_URI, resourceIri } from './vocabulary';

export type GraphSelectionSource = 'argument' | 'selected' | 'active';

export interface KnowledgeGraphMetadata {
  workspaceId: string;
  name: string;
  graphUri: string;
  prefix: string;
  active: boolean;
  isSubWiki: boolean;
}

export interface ResolvedKnowledgeGraph extends KnowledgeGraphMetadata {
  source: GraphSelectionSource;
}

let selectedGraphRef: string | undefined;

export function graphUriForName(name: string, prefix = KB_BASE_URI): string {
  return resourceIri(name, prefix);
}

export function clearSelectedGraph(): void {
  selectedGraphRef = undefined;
}

export async function listKnowledgeGraphs(): Promise<KnowledgeGraphMetadata[]> {
  const workspaceService = getWorkspaceService();
  const workspaces = await workspaceService.getWorkspacesAsList();
  return workspaces.filter(isWikiWorkspace).map(workspaceToGraphMetadata);
}

export async function getCurrentKnowledgeGraph(): Promise<ResolvedKnowledgeGraph> {
  if (selectedGraphRef) return resolveKnowledgeGraph(selectedGraphRef, 'selected');
  return resolveActiveKnowledgeGraph();
}

export async function setCurrentKnowledgeGraph(ref: string): Promise<ResolvedKnowledgeGraph> {
  const resolved = await resolveKnowledgeGraph(ref, 'argument');
  selectedGraphRef = resolved.workspaceId;
  return { ...resolved, source: 'selected' };
}

export async function resolveKnowledgeGraph(ref?: string, source: GraphSelectionSource = 'argument'): Promise<ResolvedKnowledgeGraph> {
  if (!ref) return getCurrentKnowledgeGraph();

  const graphs = await listKnowledgeGraphs();
  const graph = graphs.find(candidate => matchesGraphRef(candidate, ref));
  if (!graph) throw new Error(`Knowledge graph not found: ${ref}`);
  return { ...graph, source };
}

async function resolveActiveKnowledgeGraph(): Promise<ResolvedKnowledgeGraph> {
  const workspaceService = getWorkspaceService();
  const active = await workspaceService.getActiveWorkspace();
  if (!active || !isWikiWorkspace(active)) throw new Error('No active wiki workspace found.');
  return { ...workspaceToGraphMetadata(active), source: 'active' };
}

function matchesGraphRef(graph: KnowledgeGraphMetadata, ref: string): boolean {
  return graph.workspaceId === ref || graph.name === ref || graph.graphUri === ref;
}

function workspaceToGraphMetadata(workspace: IWikiWorkspace): KnowledgeGraphMetadata {
  return {
    workspaceId: workspace.id,
    name: workspace.name,
    graphUri: graphUriForName(workspace.name),
    prefix: KB_BASE_URI,
    active: workspace.active,
    isSubWiki: workspace.isSubWiki,
  };
}

function getWorkspaceService(): IWorkspaceService {
  return container.get<IWorkspaceService>(serviceIdentifier.Workspace);
}

export function isKnowledgeGraphWorkspace(workspace: IWorkspace): workspace is IWikiWorkspace {
  return isWikiWorkspace(workspace);
}