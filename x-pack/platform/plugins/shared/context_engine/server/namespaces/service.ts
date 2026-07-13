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
import { InvalidNamespaceSourceError, NamespaceNotFoundError } from './errors';
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
 * `.contextengine-namespaces` system index. All reads and writes go
 * through the internal user; namespace permissions are enforced at the API
 * layer and are entirely separate from index permissions on backing sources.
 */
export class NamespaceService {
  private readonly esClient: ElasticsearchClient;
  private readonly storageClient: NamespaceStorageClient;

  constructor({ esClient, logger }: { esClient: ElasticsearchClient; logger: Logger }) {
    this.esClient = esClient;
    this.storageClient = createNamespaceStorageClient({ esClient, logger });
  }

  /**
   * Creates or fully replaces a namespace. `date_created` is preserved on
   * update; `date_modified` is always set to the current time.
   */
  async put(namespaceId: string, properties: NamespaceProperties): Promise<'created' | 'updated'> {
    const resolved = await this.assertSourceExists(properties.source);
    this.assertSourceMatchesType(properties.source, properties.type, resolved);

    const existing = await this.findDocument(namespaceId);
    const now = new Date().toISOString();
    const document: NamespaceDocument = {
      ...properties,
      date_created: existing?.date_created ?? now,
      date_modified: now,
    };

    await this.storageClient.index({ id: namespaceId, document });
    return existing ? 'updated' : 'created';
  }

  async get(namespaceId: string): Promise<NamespaceHttpItem> {
    const document = await this.findDocument(namespaceId);
    if (!document) {
      throw new NamespaceNotFoundError(namespaceId);
    }
    return toNamespaceItem(namespaceId, document);
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

  private async findDocument(namespaceId: string): Promise<NamespaceDocument | undefined> {
    try {
      const response = await this.storageClient.get({ id: namespaceId });
      return response._source ?? undefined;
    } catch (error) {
      if (isResponseError(error) && error.statusCode === 404) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The source must resolve to at least one existing index or data stream.
   * Namespaces are attached to user data only — system and hidden indices
   * (dot-prefixed) are not allowed. Returns the resolve response so callers can
   * inspect the matched source types.
   */
  private async assertSourceExists(source: string): Promise<estypes.IndicesResolveIndexResponse> {
    if (source.startsWith('.')) {
      throw new InvalidNamespaceSourceError(
        `Source '${source}' is not allowed: system indices cannot be attached to a namespace`
      );
    }

    try {
      const resolved = await this.esClient.indices.resolveIndex({ name: source });
      const exists = resolved.indices.length > 0 || resolved.data_streams.length > 0;
      if (exists) {
        return resolved;
      }
    } catch (error) {
      if (!(isResponseError(error) && error.statusCode === 404)) {
        throw error;
      }
    }

    throw new InvalidNamespaceSourceError(
      `Source '${source}' does not match any existing index pattern or data stream`
    );
  }

  /**
   * The resolved source must match the declared `type`: `data_stream` requires
   * a data stream, `index_pattern` requires the pattern (e.g. `foo`, `foo,bar`,
   * `foo*`) to match at least one existing index.
   */
  private assertSourceMatchesType(
    source: string,
    type: NamespaceType,
    resolved: estypes.IndicesResolveIndexResponse
  ): void {
    if (type === 'data_stream' && resolved.data_streams.length === 0) {
      throw new InvalidNamespaceSourceError(
        `Source '${source}' must resolve to an existing data stream`
      );
    }

    if (type === 'index_pattern' && resolved.indices.length === 0) {
      throw new InvalidNamespaceSourceError(
        `Source '${source}' must match at least one existing index`
      );
    }
  }
}
