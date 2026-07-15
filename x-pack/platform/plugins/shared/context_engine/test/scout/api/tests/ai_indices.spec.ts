/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RoleApiCredentials } from '@kbn/scout';
import { tags } from '@kbn/scout';
import { expect } from '@kbn/scout/api';
import { apiTest, testData } from '../fixtures';

const AI_INDEX_ID = 'scout_test_ai_index';
const AI_INDEX_PATH = `api/context_engine/ai_index/${AI_INDEX_ID}`;
const DEST_DATA_STREAM = '.ai-index-scout-test-dest';
const DEST_INDEX_TEMPLATE = 'scout-test-context-engine-template';
const CONTEXT_ENGINE_ENABLED_SETTING = 'contextEngine:enabled';

const API_HEADERS = {
  ...testData.COMMON_HEADERS,
  'elastic-api-version': '2023-10-31',
};

const aiIndexBody = {
  name: 'scout_test_ai_index',
  description: 'AI index created by the Scout API test suite',
  type: 'data_stream',
  dest: { index: DEST_DATA_STREAM },
};

apiTest.describe('context engine AI indices API', { tag: tags.stateful.classic }, () => {
  let adminApiCredentials: RoleApiCredentials;
  let viewerApiCredentials: RoleApiCredentials;

  apiTest.beforeAll(async ({ requestAuth, kbnClient, esClient }) => {
    adminApiCredentials = await requestAuth.getApiKey('admin');
    viewerApiCredentials = await requestAuth.getApiKey('viewer');
    await kbnClient.uiSettings.update({ [CONTEXT_ENGINE_ENABLED_SETTING]: true });
    await esClient.indices.putIndexTemplate({
      name: DEST_INDEX_TEMPLATE,
      index_patterns: [`${DEST_DATA_STREAM}*`],
      data_stream: {},
      priority: 500,
    });
    await esClient.indices.createDataStream({ name: DEST_DATA_STREAM });
  });

  apiTest.afterAll(async ({ apiClient, kbnClient, esClient }) => {
    await apiClient.delete(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    await esClient.indices.deleteDataStream({ name: DEST_DATA_STREAM }, { ignore: [404] });
    await esClient.indices.deleteIndexTemplate({ name: DEST_INDEX_TEMPLATE }, { ignore: [404] });
    await kbnClient.uiSettings.unset(CONTEXT_ENGINE_ENABLED_SETTING);
  });

  apiTest('creates an AI index attached to an existing dest', async ({ apiClient }) => {
    const response = await apiClient.put(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: aiIndexBody,
    });

    expect(response).toHaveStatusCode(201);
    expect(response.body).toStrictEqual({ status: 'created' });
  });

  apiTest('gets the AI index by id', async ({ apiClient }) => {
    const response = await apiClient.get(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body).toMatchObject({ id: AI_INDEX_ID, ...aiIndexBody });
    expect(response.body.date_created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(response.body.date_modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  apiTest('lists the AI index', async ({ apiClient }) => {
    const response = await apiClient.get('api/context_engine/ai_index', {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body.ai_indices).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ id: AI_INDEX_ID })])
    );
  });

  apiTest('updates the AI index and preserves date_created', async ({ apiClient }) => {
    const createdResponse = await apiClient.get(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    const response = await apiClient.put(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: { ...aiIndexBody, description: 'Updated description' },
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body).toStrictEqual({ status: 'updated' });

    const updatedResponse = await apiClient.get(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    expect(updatedResponse.body.description).toBe('Updated description');
    expect(updatedResponse.body.date_created).toBe(createdResponse.body.date_created);
  });

  apiTest('rejects an AI index whose dest does not exist', async ({ apiClient }) => {
    const response = await apiClient.put(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: { ...aiIndexBody, dest: { index: 'does-not-exist-*' } },
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('creates and reads an index_pattern AI index', async ({ apiClient, esClient }) => {
    const indexPatternAiIndexId = 'scout_test_index_pattern_ai_index';
    const indexPatternPath = `api/context_engine/ai_index/${indexPatternAiIndexId}`;
    const destIndex = '.ai-index-scout-test-index';
    await esClient.indices.create({ index: destIndex });

    try {
      const createResponse = await apiClient.put(indexPatternPath, {
        headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
        responseType: 'json',
        body: {
          name: indexPatternAiIndexId,
          type: 'index_pattern',
          dest: { index: `${destIndex}*` },
        },
      });
      expect(createResponse).toHaveStatusCode(201);
      expect(createResponse.body).toStrictEqual({ status: 'created' });

      const getResponse = await apiClient.get(indexPatternPath, {
        headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
        responseType: 'json',
      });
      expect(getResponse).toHaveStatusCode(200);
      expect(getResponse.body).toMatchObject({
        id: indexPatternAiIndexId,
        type: 'index_pattern',
        dest: { index: `${destIndex}*` },
      });
    } finally {
      await apiClient.delete(indexPatternPath, {
        headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
        responseType: 'json',
      });
      await esClient.indices.delete({ index: destIndex }, { ignore: [404] });
    }
  });

  apiTest('rejects a system index as an index_pattern dest', async ({ apiClient }) => {
    const response = await apiClient.put(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: { ...aiIndexBody, type: 'index_pattern', dest: { index: '.kibana*' } },
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('rejects a dest that is not a data stream', async ({ apiClient, esClient }) => {
    const plainIndex = '.ai-index-scout-test-plain-index';
    await esClient.indices.create({ index: plainIndex });

    try {
      const response = await apiClient.put(AI_INDEX_PATH, {
        headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
        responseType: 'json',
        body: { ...aiIndexBody, dest: { index: plainIndex } },
      });

      expect(response).toHaveStatusCode(400);
    } finally {
      await esClient.indices.delete({ index: plainIndex }, { ignore: [404] });
    }
  });

  apiTest('rejects a request without the required type field', async ({ apiClient }) => {
    const { type, ...bodyWithoutType } = aiIndexBody;

    const response = await apiClient.put(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: bodyWithoutType,
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('forbids writes for a read-only user', async ({ apiClient }) => {
    const response = await apiClient.put(AI_INDEX_PATH, {
      headers: { ...viewerApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: aiIndexBody,
    });

    expect(response).toHaveStatusCode(403);
  });

  apiTest('allows reads for a read-only user', async ({ apiClient }) => {
    const response = await apiClient.get('api/context_engine/ai_index', {
      headers: { ...viewerApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
  });

  apiTest('deletes the AI index', async ({ apiClient }) => {
    const response = await apiClient.delete(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body).toStrictEqual({ acknowledged: true });
  });

  apiTest('returns 404 for a deleted AI index', async ({ apiClient }) => {
    const getResponse = await apiClient.get(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    expect(getResponse).toHaveStatusCode(404);

    const deleteResponse = await apiClient.delete(AI_INDEX_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    expect(deleteResponse).toHaveStatusCode(404);
  });
});
