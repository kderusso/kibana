/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { DiagnosticResult, estypes } from '@elastic/elasticsearch';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { AiIndexService } from './service';
import { InvalidAiIndexSourceError, AiIndexConflictError, AiIndexNotFoundError } from './errors';
import type { AiIndexDocument, AiIndexStorageClient } from './storage';
import { createAiIndexStorageClient } from './storage';

jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  createAiIndexStorageClient: jest.fn(),
}));

const createAiIndexStorageClientMock = createAiIndexStorageClient as jest.Mock;

const createNotFoundError = () =>
  new errors.ResponseError({
    meta: {
      aborted: false,
      attempts: 1,
      connection: null,
      context: null,
      name: 'resource_not_found_exception',
      request: {} as unknown as DiagnosticResult['meta']['request'],
    },
    warnings: [],
    body: 'resource_not_found_exception',
    statusCode: 404,
  });

const createConflictError = () =>
  new errors.ResponseError({
    meta: {
      aborted: false,
      attempts: 1,
      connection: null,
      context: null,
      name: 'version_conflict_engine_exception',
      request: {} as unknown as DiagnosticResult['meta']['request'],
    },
    warnings: [],
    body: 'version_conflict_engine_exception',
    statusCode: 409,
  });

const buildDataStream = (
  overrides: Partial<estypes.IndicesDataStream> = {}
): estypes.IndicesDataStream =>
  ({
    name: '.ai-index-customer_support',
    hidden: false,
    system: false,
    ...overrides,
  } as estypes.IndicesDataStream);

const aiIndexDocument: AiIndexDocument = {
  name: 'customer_support',
  description: 'KIs representing previously answered, commonly asked questions',
  type: 'data_stream',
  source: '.ai-index-customer_support*',
  date_created: '2026-07-08T12:10:30.000Z',
  date_modified: '2026-07-08T12:10:30.000Z',
  metadata: { preferred_harnesses: ['langsmith'] },
};

describe('AiIndexService', () => {
  let esClient: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;
  let storageClient: jest.Mocked<Pick<AiIndexStorageClient, 'get' | 'index' | 'search' | 'delete'>>;
  let service: AiIndexService;

  beforeEach(() => {
    jest.clearAllMocks();
    esClient = elasticsearchServiceMock.createElasticsearchClient();
    // Default: a data_stream source resolves to a visible, user data stream.
    esClient.indices.getDataStream.mockResponse({
      data_streams: [buildDataStream()],
    });
    // Default: an index_pattern source resolves to a visible, user index.
    esClient.indices.resolveIndex.mockResponse({
      indices: [{ name: '.ai-index-logs-app', attributes: ['open'] }],
      aliases: [],
      data_streams: [],
    });

    storageClient = {
      get: jest.fn(),
      index: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
    };
    createAiIndexStorageClientMock.mockReturnValue(storageClient);

    service = new AiIndexService({
      esClient,
      logger: loggingSystemMock.createLogger(),
    });
  });

  describe('put', () => {
    const properties = {
      name: 'customer_support',
      description: 'KIs representing previously answered, commonly asked questions',
      type: 'data_stream' as const,
      source: '.ai-index-customer_support*',
    };

    it('creates an AI index with op_type create when none exists', async () => {
      storageClient.get.mockRejectedValue(createNotFoundError());

      await expect(service.put('customer_support', properties)).resolves.toBe('created');

      expect(storageClient.index).toHaveBeenCalledWith({
        id: 'customer_support',
        op_type: 'create',
        document: expect.objectContaining({
          ...properties,
          date_created: expect.any(String),
          date_modified: expect.any(String),
        }),
      });
    });

    it('updates an existing AI index, preserving date_created and asserting seq_no', async () => {
      storageClient.get.mockResolvedValue({
        _id: 'customer_support',
        _index: '.contextengine-ai-indices',
        found: true,
        _seq_no: 7,
        _primary_term: 2,
        _source: aiIndexDocument,
      });

      await expect(service.put('customer_support', properties)).resolves.toBe('updated');

      const [indexArgs] = storageClient.index.mock.calls[0];
      expect(indexArgs.if_seq_no).toBe(7);
      expect(indexArgs.if_primary_term).toBe(2);
      expect(indexArgs.document?.date_created).toBe(aiIndexDocument.date_created);
      expect(indexArgs.document?.date_modified).not.toBe(aiIndexDocument.date_modified);
    });

    it('throws AiIndexConflictError when a concurrent create wins (409)', async () => {
      storageClient.get.mockRejectedValue(createNotFoundError());
      storageClient.index.mockRejectedValue(createConflictError());

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        AiIndexConflictError
      );
    });

    it('throws AiIndexConflictError when a concurrent update wins (409)', async () => {
      storageClient.get.mockResolvedValue({
        _id: 'customer_support',
        _index: '.contextengine-ai-indices',
        found: true,
        _seq_no: 7,
        _primary_term: 2,
        _source: aiIndexDocument,
      });
      storageClient.index.mockRejectedValue(createConflictError());

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        AiIndexConflictError
      );
    });

    it('rejects a data_stream source that does not resolve to a data stream', async () => {
      esClient.indices.getDataStream.mockResponse({ data_streams: [] });

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        InvalidAiIndexSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('rejects a data_stream source that does not exist (404 from get data stream)', async () => {
      esClient.indices.getDataStream.mockRejectedValue(createNotFoundError());

      await expect(
        service.put('customer_support', { ...properties, source: '.ai-index-customer_support' })
      ).rejects.toBeInstanceOf(InvalidAiIndexSourceError);
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('rejects a system data stream source', async () => {
      esClient.indices.getDataStream.mockResponse({
        data_streams: [buildDataStream({ system: true })],
      });

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        InvalidAiIndexSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('allows a hidden but non-system data stream source', async () => {
      esClient.indices.getDataStream.mockResponse({
        data_streams: [buildDataStream({ hidden: true, system: false })],
      });
      storageClient.get.mockRejectedValue(createNotFoundError());

      await expect(service.put('customer_support', properties)).resolves.toBe('created');
      expect(storageClient.index).toHaveBeenCalled();
    });

    it('rejects a data_stream source not prefixed with .ai-index-', async () => {
      esClient.indices.getDataStream.mockResponse({
        data_streams: [buildDataStream({ name: 'customer_support' })],
      });

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        InvalidAiIndexSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    const indexPatternProperties = {
      ...properties,
      type: 'index_pattern' as const,
      source: '.ai-index-logs-*',
    };

    it('creates an index_pattern AI index when the pattern matches an index', async () => {
      storageClient.get.mockRejectedValue(createNotFoundError());

      await expect(service.put('logs', indexPatternProperties)).resolves.toBe('created');
      expect(storageClient.index).toHaveBeenCalled();
    });

    it('rejects an index_pattern source that matches no index', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [],
        aliases: [],
        data_streams: [{ name: 'logs', backing_indices: [], timestamp_field: '@t' }],
      });

      await expect(service.put('logs', indexPatternProperties)).rejects.toBeInstanceOf(
        InvalidAiIndexSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('rejects a system index source', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [{ name: '.ai-index-security', attributes: ['open', 'hidden', 'system'] }],
        aliases: [],
        data_streams: [],
      });

      await expect(service.put('logs', indexPatternProperties)).rejects.toBeInstanceOf(
        InvalidAiIndexSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('allows a hidden but non-system index source', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [{ name: '.ai-index-idx-sml-data', attributes: ['open', 'hidden'] }],
        aliases: [],
        data_streams: [],
      });
      storageClient.get.mockRejectedValue(createNotFoundError());

      await expect(service.put('logs', indexPatternProperties)).resolves.toBe('created');
      expect(storageClient.index).toHaveBeenCalled();
    });

    it('rejects a mixed expression that includes a system index', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [
          { name: '.ai-index-logs-app', attributes: ['open'] },
          { name: '.ai-index-kibana', attributes: ['open', 'hidden', 'system'] },
        ],
        aliases: [],
        data_streams: [],
      });

      await expect(
        service.put('logs', {
          ...indexPatternProperties,
          source: '.ai-index-logs-*,.ai-index-kibana*',
        })
      ).rejects.toBeInstanceOf(InvalidAiIndexSourceError);
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('rejects an index_pattern source not prefixed with .ai-index-', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [{ name: 'logs-app', attributes: ['open'] }],
        aliases: [],
        data_streams: [],
      });

      await expect(service.put('logs', indexPatternProperties)).rejects.toBeInstanceOf(
        InvalidAiIndexSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns the AI index with its id', async () => {
      storageClient.get.mockResolvedValue({
        _id: 'customer_support',
        _index: '.contextengine-ai-indices',
        found: true,
        _source: aiIndexDocument,
      });

      await expect(service.get('customer_support')).resolves.toEqual({
        id: 'customer_support',
        ...aiIndexDocument,
      });
    });

    it('throws AiIndexNotFoundError when the AI index does not exist', async () => {
      storageClient.get.mockRejectedValue(createNotFoundError());

      await expect(service.get('missing')).rejects.toBeInstanceOf(AiIndexNotFoundError);
    });

    it('rethrows unexpected errors', async () => {
      storageClient.get.mockRejectedValue(new Error('boom'));

      await expect(service.get('customer_support')).rejects.toThrow('boom');
    });
  });

  describe('list', () => {
    it('returns AI indices mapped from search hits', async () => {
      storageClient.search.mockResolvedValue({
        took: 1,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          hits: [
            {
              _id: 'customer_support',
              _index: '.contextengine-ai-indices',
              _source: aiIndexDocument,
            },
          ],
        },
      } as unknown as Awaited<ReturnType<AiIndexStorageClient['search']>>);

      await expect(service.list()).resolves.toEqual([
        { id: 'customer_support', ...aiIndexDocument },
      ]);

      expect(storageClient.search).toHaveBeenCalledWith(
        expect.objectContaining({ size: 100, sort: [{ name: 'asc' }] })
      );
    });
  });

  describe('delete', () => {
    it('resolves when the AI index is deleted', async () => {
      storageClient.delete.mockResolvedValue({ acknowledged: true, result: 'deleted' });

      await expect(service.delete('customer_support')).resolves.toBeUndefined();
      expect(storageClient.delete).toHaveBeenCalledWith({ id: 'customer_support' });
    });

    it('throws AiIndexNotFoundError when the AI index does not exist', async () => {
      storageClient.delete.mockResolvedValue({ acknowledged: true, result: 'not_found' });

      await expect(service.delete('missing')).rejects.toBeInstanceOf(AiIndexNotFoundError);
    });
  });
});
