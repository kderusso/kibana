/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { Logger } from '@kbn/logging';
import type { MappingField } from '../utils/mappings';
import { performMatchSearch } from './perform_match_search';

jest.mock('../utils/esql/execute_esql', () => ({
  executeEsql: jest.fn().mockResolvedValue({ columns: [], values: [] }),
}));

const { executeEsql } = jest.requireMock('../utils/esql/execute_esql');

const createSearchHit = (id: string, index: string, score: number) => ({
  _id: id,
  _index: index,
  _score: score,
});

const createMockEsClient = (response: unknown = { hits: { hits: [] } }) =>
  ({
    search: jest.fn().mockResolvedValue(response),
  } as unknown as ElasticsearchClient);

const createMockLogger = () =>
  ({
    debug: jest.fn(),
  } as unknown as Logger);

const textField = (path: string): MappingField => ({ path, type: 'text', meta: {} });
const keywordField = (path: string): MappingField => ({ path, type: 'keyword', meta: {} });

beforeEach(() => {
  jest.clearAllMocks();
  executeEsql.mockResolvedValue({ columns: [], values: [] });
});

describe('performMatchSearch', () => {
  describe('CCS targets (bool/should per-field match)', () => {
    it('uses a bool/should with one match clause per field', async () => {
      const esClient = createMockEsClient();
      const logger = createMockLogger();

      await performMatchSearch({
        term: 'test query',
        index: 'remote_cluster:my-index',
        fields: [textField('title'), textField('body')],
        size: 10,
        esClient,
        logger,
      });

      const searchCall = (esClient.search as jest.Mock).mock.calls[0][0];
      expect(searchCall.query.bool.should).toEqual([
        { match: { title: 'test query' } },
        { match: { body: 'test query' } },
      ]);
      expect(searchCall.query.bool.minimum_should_match).toBe(1);
    });

    it('does not use multi_match even when all fields are regular text', async () => {
      const esClient = createMockEsClient();
      const logger = createMockLogger();

      await performMatchSearch({
        term: 'test query',
        index: 'remote_cluster:my-index',
        fields: [textField('title'), keywordField('status')],
        size: 10,
        esClient,
        logger,
      });

      const searchCall = (esClient.search as jest.Mock).mock.calls[0][0];
      expect(searchCall.query.multi_match).toBeUndefined();
      expect(searchCall.query.bool).toBeDefined();
    });

    it('does not include highlight config (snippets come from ES|QL)', async () => {
      const esClient = createMockEsClient();
      const logger = createMockLogger();

      await performMatchSearch({
        term: 'test query',
        index: 'remote_cluster:my-index',
        fields: [textField('title'), textField('body')],
        size: 10,
        esClient,
        logger,
      });

      const searchCall = (esClient.search as jest.Mock).mock.calls[0][0];
      expect(searchCall.highlight).toBeUndefined();
      expect(searchCall._source).toBe(false);
    });
  });

  describe('local targets (RRF path)', () => {
    it('uses the RRF retriever with all fields and no highlight config', async () => {
      const esClient = createMockEsClient();
      const logger = createMockLogger();

      await performMatchSearch({
        term: 'test query',
        index: 'my-local-index',
        fields: [textField('title'), textField('body')],
        size: 10,
        esClient,
        logger,
      });

      const searchCall = (esClient.search as jest.Mock).mock.calls[0][0];
      expect(searchCall.retriever.rrf.fields).toEqual(['title', 'body']);
      expect(searchCall.highlight).toBeUndefined();
      expect(searchCall._source).toBe(false);
    });

    it('over-fetches by 3x for the MMR candidate pool', async () => {
      const esClient = createMockEsClient();
      const logger = createMockLogger();

      await performMatchSearch({
        term: 'test query',
        index: 'my-local-index',
        fields: [textField('title')],
        size: 10,
        esClient,
        logger,
      });

      const searchCall = (esClient.search as jest.Mock).mock.calls[0][0];
      expect(searchCall.size).toBe(30);
    });
  });

  describe('ES|QL TOP_SNIPPETS integration', () => {
    it('calls executeEsql with TOP_SNIPPETS for each text field', async () => {
      const esClient = createMockEsClient({
        hits: {
          hits: [createSearchHit('doc1', 'my-index', 1.0)],
        },
      });
      const logger = createMockLogger();

      await performMatchSearch({
        term: 'test query',
        index: 'my-index',
        fields: [textField('title'), textField('body')],
        size: 10,
        esClient,
        logger,
      });

      expect(executeEsql).toHaveBeenCalledTimes(1);
      const { query, params } = executeEsql.mock.calls[0][0];
      expect(query).toContain('TOP_SNIPPETS(`title`');
      expect(query).toContain('TOP_SNIPPETS(`body`');
      expect(query).toContain('METADATA _id');
      expect(query).toContain('"doc1"');
      expect(params).toEqual([{ term: 'test query' }]);
    });

    it('skips ES|QL call when search returns no hits', async () => {
      const esClient = createMockEsClient({ hits: { hits: [] } });
      const logger = createMockLogger();

      const { results } = await performMatchSearch({
        term: 'test query',
        index: 'my-index',
        fields: [textField('title')],
        size: 10,
        esClient,
        logger,
      });

      expect(executeEsql).not.toHaveBeenCalled();
      expect(results).toEqual([]);
    });

    it('maps TOP_SNIPPETS results into highlights', async () => {
      const esClient = createMockEsClient({
        hits: {
          hits: [createSearchHit('doc1', 'my-index', 1.0)],
        },
      });
      const logger = createMockLogger();

      executeEsql.mockResolvedValue({
        columns: [{ name: '_id' }, { name: 'snippet_0' }],
        values: [['doc1', ['snippet about cats', 'snippet about dogs']]],
      });

      const { results } = await performMatchSearch({
        term: 'test query',
        index: 'my-index',
        fields: [textField('title')],
        size: 10,
        esClient,
        logger,
      });

      expect(results[0].highlights).toEqual(['snippet about cats', 'snippet about dogs']);
    });
  });

  describe('MMR diversification', () => {
    it('returns at most the requested size after re-ranking', async () => {
      const hits = Array.from({ length: 9 }, (_, i) =>
        createSearchHit(`doc${i}`, 'my-index', 10 - i)
      );
      const esClient = createMockEsClient({ hits: { hits } });
      const logger = createMockLogger();

      const { results } = await performMatchSearch({
        term: 'test query',
        index: 'my-index',
        fields: [textField('title')],
        size: 3,
        esClient,
        logger,
      });

      expect(results).toHaveLength(3);
    });

    it('promotes diverse results over redundant ones', async () => {
      const hits = [
        createSearchHit('doc_a', 'my-index', 10),
        createSearchHit('doc_b', 'my-index', 9),
        createSearchHit('doc_c', 'my-index', 8),
      ];
      const esClient = createMockEsClient({ hits: { hits } });
      const logger = createMockLogger();

      // doc_a and doc_b have near-identical snippets; doc_c is very different
      executeEsql.mockResolvedValue({
        columns: [{ name: '_id' }, { name: 'snippet_0' }],
        values: [
          ['doc_a', ['the quick brown fox jumps over the lazy dog']],
          ['doc_b', ['the quick brown fox jumps over the lazy cat']],
          ['doc_c', ['elasticsearch distributed search engine cluster nodes']],
        ],
      });

      const { results } = await performMatchSearch({
        term: 'test query',
        index: 'my-index',
        fields: [textField('title')],
        size: 2,
        esClient,
        logger,
      });

      // doc_a wins first (highest score), then doc_c should beat doc_b
      // because doc_b's snippet is nearly identical to doc_a's
      expect(results[0].id).toBe('doc_a');
      expect(results[1].id).toBe('doc_c');
    });
  });

  describe('response size guardrail', () => {
    it('throws a human-readable error when the response exceeds the max size', async () => {
      const esClient = {
        search: jest
          .fn()
          .mockRejectedValue(new errors.RequestAbortedError('Response content length exceeded')),
      } as unknown as ElasticsearchClient;
      const logger = createMockLogger();

      await expect(
        performMatchSearch({
          term: 'test query',
          index: 'my-local-index',
          fields: [textField('title')],
          size: 10,
          esClient,
          logger,
        })
      ).rejects.toThrow('Search response exceeded the maximum allowed size of 20MB.');
    });

    it('rethrows non-size errors unchanged', async () => {
      const originalError = new Error('some other ES error');
      const esClient = {
        search: jest.fn().mockRejectedValue(originalError),
      } as unknown as ElasticsearchClient;
      const logger = createMockLogger();

      await expect(
        performMatchSearch({
          term: 'test query',
          index: 'my-local-index',
          fields: [textField('title')],
          size: 10,
          esClient,
          logger,
        })
      ).rejects.toThrow(originalError);
    });
  });
});
