/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { IndexStorageSettings, IStorageClient } from '@kbn/storage-adapter';
import { StorageIndexAdapter, types } from '@kbn/storage-adapter';
import type { NamespaceType } from '../../common/http_api/namespaces';

export const namespaceIndexName = '.contextengine-namespaces';

const storageSettings = {
  name: namespaceIndexName,
  schema: {
    properties: {
      name: types.keyword({}),
      description: types.text({}),
      date_created: types.date({}),
      date_modified: types.date({}),
      type: types.keyword({}),
      source: types.keyword({}),
      metadata: types.flattened({}),
    },
  },
} satisfies IndexStorageSettings;

export interface NamespaceDocument {
  name: string;
  description?: string;
  date_created: string;
  date_modified: string;
  type: NamespaceType;
  source: string;
  metadata?: Record<string, unknown>;
}

export type NamespaceStorageSettings = typeof storageSettings;

export type NamespaceStorageClient = IStorageClient<NamespaceStorageSettings, NamespaceDocument>;

export const createNamespaceStorageClient = ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): NamespaceStorageClient => {
  const adapter = new StorageIndexAdapter<NamespaceStorageSettings, NamespaceDocument>(
    esClient,
    logger,
    storageSettings
  );
  return adapter.getClient();
};
