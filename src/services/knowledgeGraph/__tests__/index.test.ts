/**
 * KnowledgeGraph Unit Tests
 *
 * Tests the bidirectional TW ↔ RDF mapping layer.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTiddlersAsJson: vi.fn(),
  getTiddler: vi.fn(),
  addTiddler: vi.fn(),
}));

vi.mock('@services/wiki/wikiOperations/sender/sendWikiOperationsToBrowser', () => ({
  getSendWikiOperationsToBrowser: vi.fn(() => ({
    'get-tiddlers-as-json': mocks.getTiddlersAsJson,
    'wiki-get-tiddler': mocks.getTiddler,
    'wiki-add-tiddler': mocks.addTiddler,
  })),
}));

import {
  KB_BASE_URI,
  tiddlerUri,
  uriToTitle,
  twDateToISO,
  FIELD_TO_PROPERTY_URI,
  OBJECT_PROPERTIES,
  GHOST_CLASSES,
  RDF,
  OWL,
  HIDDEN_FIELDS,
} from '../vocabulary';

import {
  tiddlerToTriples,
  tripleToTiddlerUpdate,
  queryTriples,
  loadGraph,
  writeTriple,
  type Triple,
  type Graph,
} from '../index';

beforeEach(() => {
  mocks.getTiddlersAsJson.mockReset();
  mocks.getTiddler.mockReset();
  mocks.addTiddler.mockReset();
});

// ─── URI Helpers ───────────────────────────────────────────────────────────────

describe('vocabulary helpers', () => {
  describe('tiddlerUri', () => {
    it('builds URI from title', () => {
      expect(tiddlerUri('My Note')).toBe(`${KB_BASE_URI}My%20Note`);
      expect(tiddlerUri('Hello World')).toBe(`${KB_BASE_URI}Hello%20World`);
    });

    it('preserves Unicode and escapes syntax-unsafe characters only', () => {
      expect(tiddlerUri('买自行车')).toBe(`${KB_BASE_URI}买自行车`);
      expect(tiddlerUri('GHOST Knowledge Base')).toBe(`${KB_BASE_URI}GHOST%20Knowledge%20Base`);
      expect(tiddlerUri('Test/Sub')).toBe(`${KB_BASE_URI}Test%2FSub`);
      expect(tiddlerUri('Note#1')).toBe(`${KB_BASE_URI}Note%231`);
      expect(tiddlerUri('A & B')).toBe(`${KB_BASE_URI}A%20&%20B`);
    });
  });

  describe('uriToTitle', () => {
    it('extracts title from URI', () => {
      expect(uriToTitle(`${KB_BASE_URI}My%20Note`)).toBe('My Note');
      expect(uriToTitle(`${KB_BASE_URI}Hello%20World`)).toBe('Hello World');
    });

    it('decodes special characters', () => {
      expect(uriToTitle(`${KB_BASE_URI}Test%2FSub`)).toBe('Test/Sub');
      expect(uriToTitle(`${KB_BASE_URI}Note%231`)).toBe('Note#1');
    });

    it('returns null for non-ghost URIs', () => {
      expect(uriToTitle('http://example.com/test')).toBeNull();
      expect(uriToTitle('http://www.w3.org/1999/02/22-rdf-syntax-ns#type')).toBeNull();
    });

    it('round-trips correctly', () => {
      const titles = ['Simple Note', 'Note With Spaces', 'Note/Subpath', 'Unicode → 日本語'];
      for (const title of titles) {
        expect(uriToTitle(tiddlerUri(title))).toBe(title);
      }
    });
  });

  describe('twDateToISO', () => {
    it('converts valid TW date strings', () => {
      expect(twDateToISO('20160204225047450')).toBe('2016-02-04T22:50:47.450Z');
      expect(twDateToISO('20231215120000000')).toBe('2023-12-15T12:00:00.000Z');
    });

    it('handles dates without milliseconds', () => {
      expect(twDateToISO('20160204225047000')).toBe('2016-02-04T22:50:47.000Z');
    });

    it('returns null for invalid strings', () => {
      expect(twDateToISO('')).toBeNull();
      expect(twDateToISO('invalid')).toBeNull();
      expect(twDateToISO('2023')).toBeNull(); // too short
      expect(twDateToISO('not-a-date')).toBeNull();
    });
  });

  describe('HIDDEN_FIELDS', () => {
    it('contains system fields', () => {
      expect(HIDDEN_FIELDS.has('field:start')).toBe(true);
      expect(HIDDEN_FIELDS.has('field:end')).toBe(true);
      expect(HIDDEN_FIELDS.has('module-type')).toBe(true);
      expect(HIDDEN_FIELDS.has('plugin-type')).toBe(true);
    });

    it('does NOT contain normal fields', () => {
      expect(HIDDEN_FIELDS.has('title')).toBe(false);
      expect(HIDDEN_FIELDS.has('text')).toBe(false);
      expect(HIDDEN_FIELDS.has('tags')).toBe(false);
      expect(HIDDEN_FIELDS.has('created')).toBe(false);
    });
  });

  describe('OBJECT_PROPERTIES', () => {
    it('contains fields that reference other tiddlers', () => {
      expect(OBJECT_PROPERTIES.has('tags')).toBe(true);
      expect(OBJECT_PROPERTIES.has('list')).toBe(true);
      expect(OBJECT_PROPERTIES.has('draft.of')).toBe(true);
    });

    it('does NOT contain datatype fields', () => {
      expect(OBJECT_PROPERTIES.has('title')).toBe(false);
      expect(OBJECT_PROPERTIES.has('text')).toBe(false);
      expect(OBJECT_PROPERTIES.has('created')).toBe(false);
    });
  });
});

// ─── TW → RDF Mapping ─────────────────────────────────────────────────────────

describe('tiddlerToTriples', () => {
  const graphId = 'test-workspace';

  it('maps a simple tiddler to triples', () => {
    const fields = {
      title: 'My Note' as const,
      text: 'Hello world' as const,
      type: 'text/vnd.tiddlywiki' as const,
    };

    const triples = tiddlerToTriples(fields, graphId);

    // Should have: title, text, type, and rdf:type
    expect(triples.length).toBeGreaterThanOrEqual(3);

    // Check rdf:type
    const typeTriple = triples.find(t => t.predicate === RDF.TYPE);
    expect(typeTriple).toBeDefined();
    expect(typeTriple?.object).toBe(GHOST_CLASSES.ENTRY);
    expect(typeTriple?.isLiteral).toBe(false);
  });

  it('excludes system tiddlers', () => {
    const fields = {
      title: '$/System/Tiddler' as const,
      text: 'Should be excluded' as const,
      type: 'text/vnd.tiddlywiki' as const,
    };

    const triples = tiddlerToTriples(fields, graphId);
    expect(triples).toHaveLength(0);
  });

  it('excludes hidden fields', () => {
    const fields = {
      title: 'Test' as const,
      text: 'Content' as const,
      type: 'text/vnd.tiddlywiki' as const,
      'module-type': 'command' as const,
      'field:start': '' as const,
    };

    const triples = tiddlerToTriples(fields, graphId);
    const predicates = triples.map(t => t.predicate);

    expect(predicates.some(p => p.endsWith('module-type'))).toBe(false);
    expect(predicates.some(p => p.endsWith('field:start'))).toBe(false);
  });

  it('maps tags as ObjectProperty (tiddler URIs)', () => {
    const fields = {
      title: 'Tagged Note' as const,
      text: 'Content' as const,
      type: 'text/vnd.tiddlywiki' as const,
      tags: ['Project A', 'Urgent'],
    };

    const triples = tiddlerToTriples(fields, graphId);
    const tagTriples = triples.filter(t => t.predicate.endsWith('/tags'));

    expect(tagTriples.length).toBe(2);
    expect(tagTriples.every(t => t.isLiteral === false)).toBe(true);
    expect(tagTriples[0].object).toContain('Project%20A');
    expect(tagTriples[1].object).toContain('Urgent');
  });

  it('maps text as DatatypeProperty (literal)', () => {
    const fields = {
      title: 'Content Note' as const,
      text: 'The body content here',
      type: 'text/vnd.tiddlywiki' as const,
    };

    const triples = tiddlerToTriples(fields, graphId);
    const textTriple = triples.find(t => t.predicate.endsWith('/content'));

    expect(textTriple).toBeDefined();
    expect(textTriple?.isLiteral).toBe(true);
    expect(textTriple?.object).toBe('The body content here');
  });

  it('maps custom field values to resources when same-title tiddlers exist', () => {
    const fields = {
      title: 'Decision' as const,
      assignee: 'Agent' as const,
      reviewer: 'Missing User' as const,
    };

    const triples = tiddlerToTriples(fields, graphId, { knownTitles: new Set(['Decision', 'Agent']) });
    const assigneeTriple = triples.find(t => t.predicate === `${KB_BASE_URI}assignee`);
    const reviewerTriple = triples.find(t => t.predicate === `${KB_BASE_URI}reviewer`);

    expect(assigneeTriple).toMatchObject({
      object: tiddlerUri('Agent'),
      isLiteral: false,
    });
    expect(reviewerTriple).toMatchObject({
      object: 'Missing User',
      isLiteral: true,
    });
  });

  it('keeps built-in datatype fields literal even when values match tiddler titles', () => {
    const fields = {
      title: 'Literal Note' as const,
      text: 'Agent' as const,
      type: 'Agent' as const,
      'draft.title': 'Agent' as const,
    };

    const triples = tiddlerToTriples(fields, graphId, { knownTitles: new Set(['Literal Note', 'Agent']) });

    expect(triples.find(t => t.predicate === FIELD_TO_PROPERTY_URI.title)).toMatchObject({
      object: 'Literal Note',
      isLiteral: true,
    });
    expect(triples.find(t => t.predicate === FIELD_TO_PROPERTY_URI.text)).toMatchObject({
      object: 'Agent',
      isLiteral: true,
    });
    expect(triples.find(t => t.predicate === FIELD_TO_PROPERTY_URI.type)).toMatchObject({
      object: 'Agent',
      isLiteral: true,
    });
    expect(triples.find(t => t.predicate === FIELD_TO_PROPERTY_URI['draft.title'])).toMatchObject({
      object: 'Agent',
      isLiteral: true,
    });
  });

  it('maps creator as a resource only when an Agent tiddler exists', () => {
    const fields = {
      title: 'Generated Note' as const,
      creator: 'Agent' as const,
    };

    const withoutAgent = tiddlerToTriples(fields, graphId, { knownTitles: new Set(['Generated Note']) });
    const withAgent = tiddlerToTriples(fields, graphId, { knownTitles: new Set(['Generated Note', 'Agent']) });

    expect(withoutAgent.find(t => t.predicate === FIELD_TO_PROPERTY_URI.creator)).toMatchObject({
      object: 'Agent',
      isLiteral: true,
    });
    expect(withAgent.find(t => t.predicate === FIELD_TO_PROPERTY_URI.creator)).toMatchObject({
      object: tiddlerUri('Agent'),
      isLiteral: false,
    });
  });

  it('maps mixed custom array values according to existing tiddler titles', () => {
    const fields = {
      title: 'Mixed Links' as const,
      related: ['Known Resource', 'loose value'],
    };

    const triples = tiddlerToTriples(fields, graphId, { knownTitles: new Set(['Mixed Links', 'Known Resource']) });
    const relatedTriples = triples.filter(t => t.predicate === `${KB_BASE_URI}related`);

    expect(relatedTriples).toEqual(expect.arrayContaining([
      expect.objectContaining({ object: tiddlerUri('Known Resource'), isLiteral: false }),
      expect.objectContaining({ object: 'loose value', isLiteral: true }),
    ]));
  });

  it('maps timestamps with dateTime datatype', () => {
    const fields = {
      title: 'Dated Note' as const,
      text: 'Content' as const,
      type: 'text/vnd.tiddlywiki' as const,
      created: '20160204225047450' as const,
      modified: '20160301000000000' as const,
    };

    const triples = tiddlerToTriples(fields, graphId);
    const createdTriple = triples.find(t => t.predicate.endsWith('/created'));
    const modifiedTriple = triples.find(t => t.predicate.endsWith('/modified'));

    expect(createdTriple?.datatype).toBe('http://www.w3.org/2001/XMLSchema#dateTime');
    expect(modifiedTriple?.datatype).toBe('http://www.w3.org/2001/XMLSchema#dateTime');
    expect(createdTriple?.object).toBe('2016-02-04T22:50:47.450Z');
  });

  it('sets knowledge-type based on custom field', () => {
    const fields = {
      title: 'A Rule' as const,
      text: 'Rule content' as const,
      type: 'text/vnd.tiddlywiki' as const,
      'knowledge-type': 'Rule' as const,
    };

    const triples = tiddlerToTriples(fields, graphId);
    const typeTriple = triples.find(t => t.predicate === RDF.TYPE);

    expect(typeTriple?.object).toBe(GHOST_CLASSES.RULE);
  });

  it('sets knowledge-type with matching case', () => {
    const fields = {
      title: 'A Rule' as const,
      text: 'Rule content' as const,
      type: 'text/vnd.tiddlywiki' as const,
      'knowledge-type': 'RULE' as const, // uppercase to match GHOST_CLASSES key
    };

    const triples = tiddlerToTriples(fields, graphId);
    const typeTriple = triples.find(t => t.predicate === RDF.TYPE);

    expect(typeTriple?.object).toBe(GHOST_CLASSES.RULE);
  });

  it('handles empty and null values', () => {
    const fields = {
      title: 'Empty Note' as const,
      text: '' as const,
      type: '' as const,
      tags: [] as string[],
    };

    const triples = tiddlerToTriples(fields, graphId);
    // Always has at least the rdf:type triple
    expect(triples.length).toBeGreaterThanOrEqual(1);
    // Should have rdf:type triple
    const typeTriple = triples.find(t => t.predicate === RDF.TYPE);
    expect(typeTriple).toBeDefined();
  });
});

// ─── RDF → TW Mapping ─────────────────────────────────────────────────────────

describe('tripleToTiddlerUpdate', () => {
  it('reverse maps every declared TW field predicate through the shared mapping table', () => {
    const knownObjectProperties = new Set(
      Array.from(OBJECT_PROPERTIES).map((fieldName) => FIELD_TO_PROPERTY_URI[fieldName]),
    );

    for (const [fieldName, predicate] of Object.entries(FIELD_TO_PROPERTY_URI)) {
      const isObjectProperty = OBJECT_PROPERTIES.has(fieldName);
      const object = isObjectProperty ? `${KB_BASE_URI}Target%20Resource` : `value:${fieldName}`;
      const update = tripleToTiddlerUpdate({
        subject: `${KB_BASE_URI}Mapped%20Note`,
        predicate,
        object,
        isLiteral: !isObjectProperty,
      }, knownObjectProperties);

      expect(update, fieldName).not.toBeNull();
      expect(update?.title, fieldName).toBe('Mapped Note');
      expect(update?.fields[fieldName], fieldName).toBe(isObjectProperty ? 'Target Resource' : `value:${fieldName}`);
    }
  });

  it('reverse maps every Ghost class URI to the canonical knowledge-type value', () => {
    for (const [knowledgeType, classUri] of Object.entries(GHOST_CLASSES)) {
      const update = tripleToTiddlerUpdate({
        subject: `${KB_BASE_URI}Typed%20Note`,
        predicate: RDF.TYPE,
        object: classUri,
        isLiteral: false,
      }, new Set());

      expect(update, knowledgeType).not.toBeNull();
      expect(update?.fields['knowledge-type'], knowledgeType).toBe(knowledgeType);
    }
  });

  it('rejects rdf:type values outside the Ghost class vocabulary', () => {
    const update = tripleToTiddlerUpdate({
      subject: `${KB_BASE_URI}Typed%20Note`,
      predicate: RDF.TYPE,
      object: 'http://example.com/ExternalClass',
      isLiteral: false,
    }, new Set());

    expect(update).toBeNull();
  });

  it('reverse maps local resource objects to short field values for custom predicates', () => {
    const update = tripleToTiddlerUpdate({
      subject: `${KB_BASE_URI}Decision`,
      predicate: `${KB_BASE_URI}assignee`,
      object: tiddlerUri('Agent'),
      isLiteral: false,
    }, new Set());

    expect(update).not.toBeNull();
    expect(update?.fields.assignee).toBe('Agent');
  });

  it('preserves external resource objects when they cannot be shortened', () => {
    const update = tripleToTiddlerUpdate({
      subject: `${KB_BASE_URI}Decision`,
      predicate: `${KB_BASE_URI}externalRef`,
      object: 'http://example.com/resource',
      isLiteral: false,
    }, new Set());

    expect(update).not.toBeNull();
    expect(update?.fields.externalRef).toBe('http://example.com/resource');
  });

  it('maps simple predicate to field name', () => {
    const triple: Triple = {
      subject: `${KB_BASE_URI}TestNote`,
      predicate: `${KB_BASE_URI}text`,
      object: 'Some content',
      isLiteral: true,
    };

    const update = tripleToTiddlerUpdate(triple, new Set());
    expect(update).not.toBeNull();
    expect(update?.title).toBe('TestNote');
    expect(update?.fields.text).toBe('Some content');
  });

  it('maps draft.of predicate to draft.of field name', () => {
    const triple: Triple = {
      subject: `${KB_BASE_URI}Draft%20of%20Original`,
      predicate: `${KB_BASE_URI}draftOf`,
      object: `${KB_BASE_URI}Original`,
      isLiteral: false,
    };

    const update = tripleToTiddlerUpdate(triple, new Set([`${KB_BASE_URI}draftOf`]));
    expect(update).not.toBeNull();
    expect(update?.title).toBe('Draft of Original');
    expect(update?.fields['draft.of']).toBe('Original');
  });

  it('returns null for non-ghost URI subjects', () => {
    const triple: Triple = {
      subject: 'http://external.com/test',
      predicate: `${KB_BASE_URI}text`,
      object: 'Content',
      isLiteral: true,
    };

    const update = tripleToTiddlerUpdate(triple, new Set());
    expect(update).toBeNull();
  });

  it('handles rdf:type as knowledge-type', () => {
    const triple: Triple = {
      subject: `${KB_BASE_URI}MyRule`,
      predicate: RDF.TYPE,
      object: GHOST_CLASSES.RULE,
      isLiteral: false,
    };

    const update = tripleToTiddlerUpdate(triple, new Set());
    expect(update).not.toBeNull();
    expect(update?.fields['knowledge-type']).toBe('RULE');
  });

  it('maps kb:content back to the TW text field', () => {
    const triple: Triple = {
      subject: `${KB_BASE_URI}MyRule`,
      predicate: FIELD_TO_PROPERTY_URI.text,
      object: '@prefix kb: <http://worldshell.online/ghost/kb/> .',
      isLiteral: true,
    };

    const update = tripleToTiddlerUpdate(triple, new Set());
    expect(update).not.toBeNull();
    expect(update?.fields.text).toBe('@prefix kb: <http://worldshell.online/ghost/kb/> .');
  });

  it('writes rdf:type and kb:content without dropping existing fields from runtime Tiddler objects', async () => {
    mocks.getTiddler
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        fields: {
          title: 'MyRule',
          text: '',
          'knowledge-type': 'RULE',
          custom: 'kept',
        },
      });

    await expect(writeTriple({
      subject: `${KB_BASE_URI}MyRule`,
      predicate: RDF.TYPE,
      object: GHOST_CLASSES.RULE,
      isLiteral: false,
    }, 'test-workspace')).resolves.toEqual({ success: true });

    await expect(writeTriple({
      subject: `${KB_BASE_URI}MyRule`,
      predicate: FIELD_TO_PROPERTY_URI.text,
      object: '@prefix kb: <http://worldshell.online/ghost/kb/> .',
      isLiteral: true,
    }, 'test-workspace')).resolves.toEqual({ success: true });

    expect(mocks.addTiddler).toHaveBeenNthCalledWith(
      1,
      'MyRule',
      '',
      { creator: 'Agent', 'knowledge-type': 'RULE' },
      { withDate: true },
    );
    expect(mocks.addTiddler).toHaveBeenNthCalledWith(
      2,
      'MyRule',
      '@prefix kb: <http://worldshell.online/ghost/kb/> .',
      { type: 'text/markdown', 'knowledge-type': 'RULE', custom: 'kept' },
      { withDate: true },
    );
  });

  it('writes built-in ObjectProperty values as local tiddler titles without declarations', async () => {
    mocks.getTiddler.mockResolvedValueOnce(undefined);

    await expect(writeTriple({
      subject: `${KB_BASE_URI}Tagged%20Note`,
      predicate: FIELD_TO_PROPERTY_URI.tags,
      object: `${KB_BASE_URI}日志`,
      isLiteral: false,
    }, 'test-workspace')).resolves.toEqual({ success: true });

    expect(mocks.addTiddler).toHaveBeenCalledWith(
      'Tagged Note',
      '',
      { creator: 'Agent', tags: '日志' },
      { withDate: true },
    );
  });

  it('continues to support bare field objects returned by tests or server-side senders', async () => {
    mocks.getTiddler.mockResolvedValueOnce({
      title: 'BareFieldsRule',
      text: 'old text',
      'knowledge-type': 'RULE',
      custom: 'kept',
    });

    await expect(writeTriple({
      subject: `${KB_BASE_URI}BareFieldsRule`,
      predicate: FIELD_TO_PROPERTY_URI.text,
      object: 'new text',
      isLiteral: true,
    }, 'test-workspace')).resolves.toEqual({ success: true });

    expect(mocks.addTiddler).toHaveBeenCalledWith(
      'BareFieldsRule',
      'new text',
      { type: 'text/markdown', 'knowledge-type': 'RULE', custom: 'kept' },
      { withDate: true },
    );
  });

  it('defaults new content tiddlers to markdown with Agent creator', async () => {
    mocks.getTiddler.mockResolvedValueOnce(undefined);

    await expect(writeTriple({
      subject: `${KB_BASE_URI}Generated%20Note`,
      predicate: FIELD_TO_PROPERTY_URI.text,
      object: '# Generated',
      isLiteral: true,
    }, 'test-workspace')).resolves.toEqual({ success: true });

    expect(mocks.addTiddler).toHaveBeenCalledWith(
      'Generated Note',
      '# Generated',
      { type: 'text/markdown', creator: 'Agent' },
      { withDate: true },
    );
  });

  it('does not overwrite existing creator when updating content', async () => {
    mocks.getTiddler.mockResolvedValueOnce({
      fields: {
        title: 'ExistingAuthorNote',
        text: 'old text',
        type: 'text/vnd.tiddlywiki',
        creator: 'Human',
      },
    });

    await expect(writeTriple({
      subject: `${KB_BASE_URI}ExistingAuthorNote`,
      predicate: FIELD_TO_PROPERTY_URI.text,
      object: 'new text',
      isLiteral: true,
    }, 'test-workspace')).resolves.toEqual({ success: true });

    expect(mocks.addTiddler).toHaveBeenCalledWith(
      'ExistingAuthorNote',
      'new text',
      { type: 'text/vnd.tiddlywiki', creator: 'Human' },
      { withDate: true },
    );
  });

  it('preserves an explicit existing content format when updating text', async () => {
    mocks.getTiddler.mockResolvedValueOnce({
      fields: {
        title: 'ExistingFormatNote',
        text: 'old text',
        type: 'text/vnd.tiddlywiki',
      },
    });

    await expect(writeTriple({
      subject: `${KB_BASE_URI}ExistingFormatNote`,
      predicate: FIELD_TO_PROPERTY_URI.text,
      object: 'new text',
      isLiteral: true,
    }, 'test-workspace')).resolves.toEqual({ success: true });

    expect(mocks.addTiddler).toHaveBeenCalledWith(
      'ExistingFormatNote',
      'new text',
      { type: 'text/vnd.tiddlywiki' },
      { withDate: true },
    );
  });

  it('treats unknown predicates as external', () => {
    const triple: Triple = {
      subject: `${KB_BASE_URI}Note`,
      predicate: 'http://example.com/customProperty',
      object: 'value',
      isLiteral: true,
    };

    const update = tripleToTiddlerUpdate(triple, new Set());
    expect(update).not.toBeNull();
    expect(update?.fields['http://example.com/customProperty']).toBe('value');
  });
});

// ─── Graph Loading ─────────────────────────────────────────────────────────────

describe('loadGraph', () => {
  it('loads non-system tiddlers from the active wiki sender', async () => {
    mocks.getTiddlersAsJson.mockResolvedValueOnce([
      {
        title: 'Only Entry',
        text: 'Visible content',
        type: 'text/vnd.tiddlywiki',
      },
    ]);

    const graph = await loadGraph('test-workspace');

    expect(mocks.getTiddlersAsJson).toHaveBeenCalledWith('[!is[system]]');
    expect(graph.id).toBe('test-workspace');
    expect(graph.triples.length).toBeGreaterThan(0);
    expect(graph.triples.some((triple) => triple.subject === tiddlerUri('Only Entry'))).toBe(true);
    expect(graph.document?.format).toBe('N3');
    expect(graph.document?.quads).toHaveLength(graph.triples.length);
    expect(graph.document?.store.size).toBe(graph.triples.length);
    expect(graph.document?.text).toContain('Only%20Entry');
  });
});

// ─── Query ───────────────────────────────────────────────────────────────────

describe('queryTriples', () => {
  const graph: Graph = {
    id: 'test',
    triples: [
      { subject: `${KB_BASE_URI}A`, predicate: `${KB_BASE_URI}tags`, object: `${KB_BASE_URI}Tag1`, isLiteral: false },
      { subject: `${KB_BASE_URI}A`, predicate: `${KB_BASE_URI}text`, object: 'Content A', isLiteral: true },
      { subject: `${KB_BASE_URI}B`, predicate: `${KB_BASE_URI}tags`, object: `${KB_BASE_URI}Tag1`, isLiteral: false },
      { subject: `${KB_BASE_URI}B`, predicate: `${KB_BASE_URI}text`, object: 'Content B', isLiteral: true },
      { subject: `${KB_BASE_URI}C`, predicate: `${KB_BASE_URI}tags`, object: `${KB_BASE_URI}Tag2`, isLiteral: false },
    ],
  };

  it('matches all triples when pattern is empty', () => {
    const results = queryTriples(graph, {});
    expect(results).toHaveLength(5);
  });

  it('filters by subject', () => {
    const results = queryTriples(graph, { subject: `${KB_BASE_URI}A` });
    expect(results).toHaveLength(2);
    expect(results.every(t => t.subject === `${KB_BASE_URI}A`)).toBe(true);
  });

  it('filters by predicate', () => {
    const results = queryTriples(graph, { predicate: `${KB_BASE_URI}text` });
    expect(results).toHaveLength(2);
    expect(results.every(t => t.predicate === `${KB_BASE_URI}text`)).toBe(true);
  });

  it('filters by object', () => {
    const results = queryTriples(graph, { object: `${KB_BASE_URI}Tag1` });
    expect(results).toHaveLength(2);
    expect(results.every(t => t.object === `${KB_BASE_URI}Tag1`)).toBe(true);
  });

  it('filters by multiple criteria', () => {
    const results = queryTriples(graph, {
      subject: `${KB_BASE_URI}A`,
      predicate: `${KB_BASE_URI}tags`,
    });
    expect(results).toHaveLength(1);
    expect(results[0].object).toBe(`${KB_BASE_URI}Tag1`);
  });

  it('uses null as wildcard', () => {
    const results = queryTriples(graph, { predicate: null });
    expect(results).toHaveLength(5);
  });
});