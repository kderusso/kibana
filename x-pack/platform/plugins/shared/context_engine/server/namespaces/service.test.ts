/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { DiagnosticResult } from '@elastic/elasticsearch';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { NamespaceService } from './service';
import {
  InvalidNamespaceSourceError,
  NamespaceConflictError,
  NamespaceNotFoundError,
} from './errors';
import type { NamespaceDocument, NamespaceStorageClient } from './storage';
import { createNamespaceStorageClient } from './storage';

jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  createNamespaceStorageClient: jest.fn(),
}));

const createNamespaceStorageClientMock = createNamespaceStorageClient as jest.Mock;

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

const namespaceDocument: NamespaceDocument = {
  name: 'customer_support',
  description: 'KIs representing previously answered, commonly asked questions',
  type: 'data_stream',
  source: 'customer_support*',
  date_created: '2026-07-08T12:10:30.000Z',
  date_modified: '2026-07-08T12:10:30.000Z',
  metadata: { preferred_harnesses: ['langsmith'] },
};

describe('NamespaceService', () => {
  let esClient: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;
  let storageClient: jest.Mocked<
    Pick<NamespaceStorageClient, 'get' | 'index' | 'search' | 'delete'>
  >;
  let service: NamespaceService;

  beforeEach(() => {
    jest.clearAllMocks();
    esClient = elasticsearchServiceMock.createElasticsearchClient();
    esClient.indices.resolveIndex.mockResponse({
      indices: [],
      aliases: [],
      data_streams: [{ name: 'customer_support', backing_indices: [], timestamp_field: '@t' }],
    });

    storageClient = {
      get: jest.fn(),
      index: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
    };
    createNamespaceStorageClientMock.mockReturnValue(storageClient);

    service = new NamespaceService({
      esClient,
      logger: loggingSystemMock.createLogger(),
    });
  });

  describe('put', () => {
    const properties = {
      name: 'customer_support',
      description: 'KIs representing previously answered, commonly asked questions',
      type: 'data_stream' as const,
      source: 'customer_support*',
    };

    it('creates a namespace with op_type create when none exists', async () => {
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

    it('updates an existing namespace, preserving date_created and asserting seq_no', async () => {
      storageClient.get.mockResolvedValue({
        _id: 'customer_support',
        _index: '.contextengine-namespaces',
        found: true,
        _seq_no: 7,
        _primary_term: 2,
        _source: namespaceDocument,
      });

      await expect(service.put('customer_support', properties)).resolves.toBe('updated');

      const [indexArgs] = storageClient.index.mock.calls[0];
      expect(indexArgs.if_seq_no).toBe(7);
      expect(indexArgs.if_primary_term).toBe(2);
      expect(indexArgs.document?.date_created).toBe(namespaceDocument.date_created);
      expect(indexArgs.document?.date_modified).not.toBe(namespaceDocument.date_modified);
    });

    it('throws NamespaceConflictError when a concurrent create wins (409)', async () => {
      storageClient.get.mockRejectedValue(createNotFoundError());
      storageClient.index.mockRejectedValue(createConflictError());

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        NamespaceConflictError
      );
    });

    it('throws NamespaceConflictError when a concurrent update wins (409)', async () => {
      storageClient.get.mockResolvedValue({
        _id: 'customer_support',
        _index: '.contextengine-namespaces',
        found: true,
        _seq_no: 7,
        _primary_term: 2,
        _source: namespaceDocument,
      });
      storageClient.index.mockRejectedValue(createConflictError());

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        NamespaceConflictError
      );
    });

    it('rejects a dot-prefixed (system) source without checking existence', async () => {
      await expect(
        service.put('customer_support', { ...properties, source: '.kibana*' })
      ).rejects.toBeInstanceOf(InvalidNamespaceSourceError);

      expect(esClient.indices.resolveIndex).not.toHaveBeenCalled();
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('rejects a source that does not resolve to anything', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [],
        aliases: [],
        data_streams: [],
      });

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        InvalidNamespaceSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('rejects a concrete source that does not exist (404 from resolve)', async () => {
      esClient.indices.resolveIndex.mockRejectedValue(createNotFoundError());

      await expect(
        service.put('customer_support', { ...properties, source: 'customer_support' })
      ).rejects.toBeInstanceOf(InvalidNamespaceSourceError);
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    it('rejects a data_stream source that resolves only to an index', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [{ name: 'customer_support', attributes: [] }],
        aliases: [],
        data_streams: [],
      });

      await expect(service.put('customer_support', properties)).rejects.toBeInstanceOf(
        InvalidNamespaceSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });

    const indexPatternProperties = {
      ...properties,
      type: 'index_pattern' as const,
      source: 'logs-*',
    };

    it('creates an index_pattern namespace when the pattern matches an index', async () => {
      esClient.indices.resolveIndex.mockResponse({
        indices: [{ name: 'logs-app', attributes: [] }],
        aliases: [],
        data_streams: [],
      });
      storageClient.get.mockRejectedValue(createNotFoundError());

      await expect(service.put('logs', indexPatternProperties)).resolves.toBe('created');
      expect(storageClient.index).toHaveBeenCalled();
    });

    it('rejects an index_pattern source that resolves only to a data stream', async () => {
      // The default resolveIndex mock returns a data stream with no indices.
      await expect(service.put('logs', indexPatternProperties)).rejects.toBeInstanceOf(
        InvalidNamespaceSourceError
      );
      expect(storageClient.index).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns the namespace with its id', async () => {
      storageClient.get.mockResolvedValue({
        _id: 'customer_support',
        _index: '.contextengine-namespaces',
        found: true,
        _source: namespaceDocument,
      });

      await expect(service.get('customer_support')).resolves.toEqual({
        id: 'customer_support',
        ...namespaceDocument,
      });
    });

    it('throws NamespaceNotFoundError when the namespace does not exist', async () => {
      storageClient.get.mockRejectedValue(createNotFoundError());

      await expect(service.get('missing')).rejects.toBeInstanceOf(NamespaceNotFoundError);
    });

    it('rethrows unexpected errors', async () => {
      storageClient.get.mockRejectedValue(new Error('boom'));

      await expect(service.get('customer_support')).rejects.toThrow('boom');
    });
  });

  describe('list', () => {
    it('returns namespaces mapped from search hits', async () => {
      storageClient.search.mockResolvedValue({
        took: 1,
        timed_out: false,
        _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
        hits: {
          hits: [
            {
              _id: 'customer_support',
              _index: '.contextengine-namespaces',
              _source: namespaceDocument,
            },
          ],
        },
      } as unknown as Awaited<ReturnType<NamespaceStorageClient['search']>>);

      await expect(service.list()).resolves.toEqual([
        { id: 'customer_support', ...namespaceDocument },
      ]);

      expect(storageClient.search).toHaveBeenCalledWith(
        expect.objectContaining({ size: 100, sort: [{ name: 'asc' }] })
      );
    });
  });

  describe('delete', () => {
    it('resolves when the namespace is deleted', async () => {
      storageClient.delete.mockResolvedValue({ acknowledged: true, result: 'deleted' });

      await expect(service.delete('customer_support')).resolves.toBeUndefined();
      expect(storageClient.delete).toHaveBeenCalledWith({ id: 'customer_support' });
    });

    it('throws NamespaceNotFoundError when the namespace does not exist', async () => {
      storageClient.delete.mockResolvedValue({ acknowledged: true, result: 'not_found' });

      await expect(service.delete('missing')).rejects.toBeInstanceOf(NamespaceNotFoundError);
    });
  });
});
