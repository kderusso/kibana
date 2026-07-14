/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { IndexStorageSettings, IStorageClient } from '@kbn/storage-adapter';
import { StorageIndexAdapter, types } from '@kbn/storage-adapter';
import type { AiIndexType } from '../../common/http_api/ai_indices';

export const aiIndicesIndexName = '.contextengine-ai-indices';

const storageSettings = {
  name: aiIndicesIndexName,
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

export interface AiIndexDocument {
  name: string;
  description?: string;
  date_created: string;
  date_modified: string;
  type: AiIndexType;
  source: string;
  metadata?: Record<string, unknown>;
}

export type AiIndexStorageSettings = typeof storageSettings;

export type AiIndexStorageClient = IStorageClient<AiIndexStorageSettings, AiIndexDocument>;

export const createAiIndexStorageClient = ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): AiIndexStorageClient => {
  const adapter = new StorageIndexAdapter<AiIndexStorageSettings, AiIndexDocument>(
    esClient,
    logger,
    storageSettings
  );
  return adapter.getClient();
};
