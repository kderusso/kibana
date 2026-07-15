/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { isResponseError } from '@kbn/es-errors';
import { MAX_AI_INDICES } from '../../common/constants';
import type {
  AiIndexHttpItem,
  AiIndexProperties,
  AiIndexType,
} from '../../common/http_api/ai_indices';
import { InvalidAiIndexSourceError, AiIndexConflictError, AiIndexNotFoundError } from './errors';
import type { AiIndexDocument, AiIndexStorageClient } from './storage';
import { createAiIndexStorageClient } from './storage';

/**
 * AI index sources must follow the `.ai-index-` naming convention.
 */
const SOURCE_INDEX_PREFIX = '.ai-index-';

const toAiIndexItem = (id: string, document: AiIndexDocument): AiIndexHttpItem => ({
  id,
  name: document.name,
  ...(document.description !== undefined && { description: document.description }),
  type: document.type,
  source: document.source,
  date_created: document.date_created,
  date_modified: document.date_modified,
});

/**
 * Manages the AI index registry stored in the hidden
 * `.contextengine-ai-indices` system index. Reads and writes go through the
 * internal user; access is enforced at the API layer.
 */
export class AiIndexService {
  private readonly esClient: ElasticsearchClient;
  private readonly storageClient: AiIndexStorageClient;

  constructor({ esClient, logger }: { esClient: ElasticsearchClient; logger: Logger }) {
    this.esClient = esClient;
    this.storageClient = createAiIndexStorageClient({ esClient, logger });
  }

  /**
   * Creates or fully replaces an AI index, preserving `date_created` on update.
   * Concurrent writes are guarded with optimistic concurrency control; a losing
   * writer gets a {@link AiIndexConflictError}.
   */
  async put(aiIndexId: string, properties: AiIndexProperties): Promise<'created' | 'updated'> {
    await this.assertValidSource(properties.source, properties.type);

    const existing = await this.findDocument(aiIndexId);
    const now = new Date().toISOString();
    const document: AiIndexDocument = {
      ...properties,
      date_created: existing?.document.date_created ?? now,
      date_modified: now,
    };

    try {
      if (existing) {
        await this.storageClient.index({
          id: aiIndexId,
          document,
          if_seq_no: existing.seqNo,
          if_primary_term: existing.primaryTerm,
        });
        return 'updated';
      }

      await this.storageClient.index({ id: aiIndexId, document, op_type: 'create' });
      return 'created';
    } catch (error) {
      if (isResponseError(error) && error.statusCode === 409) {
        throw new AiIndexConflictError(aiIndexId);
      }
      throw error;
    }
  }

  async get(aiIndexId: string): Promise<AiIndexHttpItem> {
    const existing = await this.findDocument(aiIndexId);
    if (!existing) {
      throw new AiIndexNotFoundError(aiIndexId);
    }
    return toAiIndexItem(aiIndexId, existing.document);
  }

  async list(): Promise<AiIndexHttpItem[]> {
    const response = await this.storageClient.search({
      size: MAX_AI_INDICES,
      track_total_hits: false,
      sort: [{ name: 'asc' }],
    });
    return response.hits.hits.map((hit) => toAiIndexItem(hit._id!, hit._source as AiIndexDocument));
  }

  /**
   * Deletes the AI index entry only; backing indices are left untouched.
   */
  async delete(aiIndexId: string): Promise<void> {
    const { result } = await this.storageClient.delete({ id: aiIndexId });
    if (result === 'not_found') {
      throw new AiIndexNotFoundError(aiIndexId);
    }
  }

  private async findDocument(aiIndexId: string): Promise<
    | {
        document: AiIndexDocument;
        seqNo?: number;
        primaryTerm?: number;
      }
    | undefined
  > {
    try {
      const response = await this.storageClient.get({ id: aiIndexId });
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
  private async assertValidSource(source: string, type: AiIndexType): Promise<void> {
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
      throw new InvalidAiIndexSourceError(
        `Source '${source}' must resolve to an existing data stream`
      );
    }

    const invalidPrefix = dataStreams.find(
      (dataStream) => !dataStream.name.startsWith(SOURCE_INDEX_PREFIX)
    );
    if (invalidPrefix) {
      throw new InvalidAiIndexSourceError(
        `Source '${source}' is not allowed: '${invalidPrefix.name}' must start with '${SOURCE_INDEX_PREFIX}'`
      );
    }

    const system = dataStreams.find((dataStream) => dataStream.system);
    if (system) {
      throw new InvalidAiIndexSourceError(
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
      throw new InvalidAiIndexSourceError(
        `Source '${source}' must match at least one existing index`
      );
    }

    const invalidPrefix = indices.find((index) => !index.name.startsWith(SOURCE_INDEX_PREFIX));
    if (invalidPrefix) {
      throw new InvalidAiIndexSourceError(
        `Source '${source}' is not allowed: '${invalidPrefix.name}' must start with '${SOURCE_INDEX_PREFIX}'`
      );
    }

    const system = indices.find((index) => index.attributes.includes('system'));
    if (system) {
      throw new InvalidAiIndexSourceError(
        `Source '${source}' is not allowed: '${system.name}' is a system index`
      );
    }
  }
}
