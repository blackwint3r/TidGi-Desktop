import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IWorkspaceService } from '@services/workspaces/interface';

const workspaceService = {
  getActiveWorkspace: vi.fn(),
  getWorkspacesAsList: vi.fn(),
};

vi.mock('@services/container', () => ({
  container: {
    get: vi.fn(() => workspaceService),
  },
}));

function wikiWorkspace(overrides: Record<string, unknown>) {
  return {
    id: 'workspace-a',
    name: 'Ghost Knowledge Base',
    active: false,
    isSubWiki: false,
    wikiFolderLocation: '/tmp/wiki',
    ...overrides,
  };
}

describe('graphRegistry', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const registry = await import('../graphRegistry');
    registry.clearSelectedGraph();
  });

  it('lists wiki workspaces as knowledge graphs', async () => {
    workspaceService.getWorkspacesAsList.mockResolvedValue([
      wikiWorkspace({ id: 'workspace-a', name: 'Ghost Knowledge Base', active: true }),
      { id: 'agent-page', name: 'Agent', active: false },
    ]);

    const { listKnowledgeGraphs } = await import('../graphRegistry');
    const graphs = await listKnowledgeGraphs();

    expect(graphs).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-a',
        name: 'Ghost Knowledge Base',
        graphUri: 'http://worldshell.online/ghost/kb/Ghost%20Knowledge%20Base',
        prefix: 'http://worldshell.online/ghost/kb/',
        active: true,
        isSubWiki: false,
      }),
    ]);
  });

  it('uses the active wiki workspace when no graph is selected', async () => {
    workspaceService.getActiveWorkspace.mockResolvedValue(
      wikiWorkspace({ id: 'workspace-active', name: 'Active Wiki', active: true }),
    );

    const { getCurrentKnowledgeGraph } = await import('../graphRegistry');
    const graph = await getCurrentKnowledgeGraph();

    expect(graph).toEqual(expect.objectContaining({
      workspaceId: 'workspace-active',
      name: 'Active Wiki',
      source: 'active',
    }));
  });

  it('resolves and persists selected graph by name', async () => {
    workspaceService.getWorkspacesAsList.mockResolvedValue([
      wikiWorkspace({ id: 'workspace-a', name: 'Alpha', active: true }),
      wikiWorkspace({ id: 'workspace-b', name: 'Beta', active: false }),
    ]);

    const { getCurrentKnowledgeGraph, setCurrentKnowledgeGraph } = await import('../graphRegistry');
    const selected = await setCurrentKnowledgeGraph('Beta');
    const current = await getCurrentKnowledgeGraph();

    expect(selected).toEqual(expect.objectContaining({ workspaceId: 'workspace-b', source: 'selected' }));
    expect(current).toEqual(expect.objectContaining({ workspaceId: 'workspace-b', source: 'selected' }));
    expect(workspaceService.getActiveWorkspace).not.toHaveBeenCalled();
  });

  it('resolves graphs by workspace id or graph uri', async () => {
    workspaceService.getWorkspacesAsList.mockResolvedValue([
      wikiWorkspace({ id: 'workspace-a', name: 'Alpha', active: true }),
    ]);

    const { resolveKnowledgeGraph } = await import('../graphRegistry');
    await expect(resolveKnowledgeGraph('workspace-a')).resolves.toEqual(expect.objectContaining({ name: 'Alpha' }));
    await expect(resolveKnowledgeGraph('http://worldshell.online/ghost/kb/Alpha')).resolves.toEqual(
      expect.objectContaining({ workspaceId: 'workspace-a' }),
    );
  });
});

void (workspaceService satisfies Pick<IWorkspaceService, 'getActiveWorkspace' | 'getWorkspacesAsList'>);