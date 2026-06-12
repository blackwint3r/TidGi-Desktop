import { WikiChannel } from '@/constants/channels';
import { container } from '@services/container';
import serviceIdentifier from '@services/serviceIdentifier';
import type { IWikiService } from '@services/wiki/interface';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeWikiSearch } from '../wikiSearch';

describe('executeWikiSearch filter behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to excluding system tiddlers and applies limit', async () => {
    const wikiService = container.get<IWikiService>(serviceIdentifier.Wiki);

    vi.spyOn(wikiService, 'wikiOperationInServer').mockImplementation(
      (async (...args: unknown[]) => {
        const channel = args[0] as WikiChannel;
        const opArgs = args[2] as string[] | undefined;
        if (channel === WikiChannel.runFilter) {
          return ['$:/boot/boot.css', 'Note A', 'Note B'];
        }
        if (channel === WikiChannel.getTiddlersAsJson && opArgs && opArgs.length > 0) {
          return [{ title: opArgs[0], text: `Content of ${opArgs[0]}` }];
        }
        return [];
      }) as IWikiService['wikiOperationInServer'],
    );

    const result = await executeWikiSearch({
      workspaceName: 'Test Wiki 1',
      searchType: 'filter',
      filter: '[all[tiddlers]]',
      limit: 1,
      threshold: 0.7,
    });

    expect(result.success).toBe(true);
    expect(result.data).toContain('Note A');
    expect(result.data).not.toContain('Note B');
    expect(result.data).not.toContain('$:/boot/boot.css');
    expect(result.metadata).toMatchObject({
      resultCount: 1,
      totalMatchedBeforeLimit: 2,
      excludedSystemTiddlers: 1,
      limit: 1,
    });
  });
});
