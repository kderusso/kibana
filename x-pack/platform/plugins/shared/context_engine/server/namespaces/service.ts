/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { isResponseError } from '@kbn/es-errors';
import { MAX_NAMESPACES } from '../../common/constants';
import type {
  NamespaceHttpItem,
  NamespaceProperties,
  NamespaceType,
} from '../../common/http_api/namespaces';
import {
  InvalidNamespaceSourceError,
  NamespaceConflictError,
  NamespaceNotFoundError,
} from './errors';
import type { NamespaceDocument, NamespaceStorageClient } from './storage';
import { createNamespaceStorageClient } from './storage';

const toNamespaceItem = (id: string, document: NamespaceDocument): NamespaceHttpItem => ({
  id,
  name: document.name,
  ...(document.description !== undefined && { description: document.description }),
  type: document.type,
  source: document.source,
  date_created: document.date_created,
  date_modified: document.date_modified,
  ...(document.metadata !== undefined && { metadata: document.metadata }),
});

/**
 * Manages the namespace registry stored in the hidden
 * `.contextengine-namespaces` system index. Reads and writes go through the
 * internal user; access is enforced at the API layer.
 */
export class NamespaceService {
  private readonly esClient: ElasticsearchClient;
  private readonly storageClient: NamespaceStorageClient;

  constructor({ esClient, logger }: { esClient: ElasticsearchClient; logger: Logger }) {
    this.esClient = esClient;
    this.storageClient = createNamespaceStorageClient({ esClient, logger });
  }

  /**
   * Creates or fully replaces a namespace, preserving `date_created` on update.
   * Concurrent writes are guarded with optimistic concurrency control; a losing
   * writer gets a {@link NamespaceConflictError}.
   */
  async put(namespaceId: string, properties: NamespaceProperties): Promise<'created' | 'updated'> {
    await this.assertValidSource(properties.source, properties.type);

    const existing = await this.findDocument(namespaceId);
    const now = new Date().toISOString();
    const document: NamespaceDocument = {
      ...properties,
      date_created: existing?.document.date_created ?? now,
      date_modified: now,
    };

    try {
      if (existing) {
        await this.storageClient.index({
          id: namespaceId,
          document,
          if_seq_no: existing.seqNo,
          if_primary_term: existing.primaryTerm,
        });
        return 'updated';
      }

      await this.storageClient.index({ id: namespaceId, document, op_type: 'create' });
      return 'created';
    } catch (error) {
      if (isResponseError(error) && error.statusCode === 409) {
        throw new NamespaceConflictError(namespaceId);
      }
      throw error;
    }
  }

  async get(namespaceId: string): Promise<NamespaceHttpItem> {
    const existing = await this.findDocument(namespaceId);
    if (!existing) {
      throw new NamespaceNotFoundError(namespaceId);
    }
    return toNamespaceItem(namespaceId, existing.document);
  }

  async list(): Promise<NamespaceHttpItem[]> {
    const response = await this.storageClient.search({
      size: MAX_NAMESPACES,
      track_total_hits: false,
      sort: [{ name: 'asc' }],
    });
    return response.hits.hits.map((hit) =>
      toNamespaceItem(hit._id!, hit._source as NamespaceDocument)
    );
  }

  /**
   * Deletes the namespace entry only; backing indices are left untouched.
   */
  async delete(namespaceId: string): Promise<void> {
    const { result } = await this.storageClient.delete({ id: namespaceId });
    if (result === 'not_found') {
      throw new NamespaceNotFoundError(namespaceId);
    }
  }

  private async findDocument(namespaceId: string): Promise<
    | {
        document: NamespaceDocument;
        seqNo?: number;
        primaryTerm?: number;
      }
    | undefined
  > {
    try {
      const response = await this.storageClient.get({ id: namespaceId });
      if (!response.found || !response._source) {
        return undefined;
      }
      return {
        document: response._source,
        seqNo: response._seq_no,
        primaryTerm: response._primary_term,
      };
    } catch (error) {
      if (isResponseError(error) && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The source must exist and match the declared `type`. Only `system` sources
   * are rejected (via the flag ES reports); `hidden` is allowed, since many
   * legitimate customer indices are hidden.
   */
  private async assertValidSource(source: string, type: NamespaceType): Promise<void> {
    if (type === 'data_stream') {
      await this.assertValidDataStreamSource(source);
    } else {
      await this.assertValidIndexPatternSource(source);
    }
  }

  private async assertValidDataStreamSource(source: string): Promise<void> {
    let dataStreams: estypes.IndicesDataStream[] = [];
    try {
      const response = await this.esClient.indices.getDataStream({
        name: source,
        expand_wildcards: 'all',
      });
      dataStreams = response.data_streams;
    } catch (error) {
      if (!(isResponseError(error) && error.statusCode === 404)) {
        throw error;
      }
    }

    if (dataStreams.length === 0) {
      throw new InvalidNamespaceSourceError(
        `Source '${source}' must resolve to an existing data stream`
      );
    }

    const system = dataStreams.find((dataStream) => dataStream.system);
    if (system) {
      throw new InvalidNamespaceSourceError(
        `Source '${source}' is not allowed: '${system.name}' is a system data stream`
      );
    }
  }

  private async assertValidIndexPatternSource(source: string): Promise<void> {
    let indices: estypes.IndicesResolveIndexResolveIndexItem[] = [];
    try {
      const resolved = await this.esClient.indices.resolveIndex({ name: source });
      indices = resolved.indices;
    } catch (error) {
      if (!(isResponseError(error) && error.statusCode === 404)) {
        throw error;
      }
    }

    if (indices.length === 0) {
      throw new InvalidNamespaceSourceError(
        `Source '${source}' must match at least one existing index`
      );
    }

    const system = indices.find((index) => index.attributes.includes('system'));
    if (system) {
      throw new InvalidNamespaceSourceError(
        `Source '${source}' is not allowed: '${system.name}' is a system index`
      );
    }
  }
}
