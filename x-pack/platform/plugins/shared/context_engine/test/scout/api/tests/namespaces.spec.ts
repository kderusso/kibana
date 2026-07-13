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

const NAMESPACE_ID = 'scout_test_namespace';
const NAMESPACE_PATH = `api/context_engine/namespace/${NAMESPACE_ID}`;
const SOURCE_DATA_STREAM = 'scout-test-context-engine-source';
const SOURCE_INDEX_TEMPLATE = 'scout-test-context-engine-template';
const CONTEXT_ENGINE_ENABLED_SETTING = 'contextEngine:enabled';

const API_HEADERS = {
  ...testData.COMMON_HEADERS,
  'elastic-api-version': '2023-10-31',
};

const namespaceBody = {
  name: 'scout_test_namespace',
  description: 'Namespace created by the Scout API test suite',
  type: 'data_stream',
  source: SOURCE_DATA_STREAM,
  metadata: { preferred_harnesses: ['scout'] },
};

// TODO: re-enable once the `.context-engine-*` index pattern is granted to the
// kibana_system reserved role in Elasticsearch. Until then the storage index
// cannot be written by the internal user and every storage-backed call 500s.
apiTest.describe.skip('context engine namespaces API', { tag: tags.stateful.classic }, () => {
  let adminApiCredentials: RoleApiCredentials;
  let viewerApiCredentials: RoleApiCredentials;

  apiTest.beforeAll(async ({ requestAuth, kbnClient, esClient }) => {
    adminApiCredentials = await requestAuth.getApiKey('admin');
    viewerApiCredentials = await requestAuth.getApiKey('viewer');
    await kbnClient.uiSettings.update({ [CONTEXT_ENGINE_ENABLED_SETTING]: true });
    await esClient.indices.putIndexTemplate({
      name: SOURCE_INDEX_TEMPLATE,
      index_patterns: [`${SOURCE_DATA_STREAM}*`],
      data_stream: {},
      priority: 500,
    });
    await esClient.indices.createDataStream({ name: SOURCE_DATA_STREAM });
  });

  apiTest.afterAll(async ({ apiClient, kbnClient, esClient }) => {
    await apiClient.delete(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    await esClient.indices.deleteDataStream({ name: SOURCE_DATA_STREAM }, { ignore: [404] });
    await esClient.indices.deleteIndexTemplate({ name: SOURCE_INDEX_TEMPLATE }, { ignore: [404] });
    await kbnClient.uiSettings.unset(CONTEXT_ENGINE_ENABLED_SETTING);
  });

  apiTest('creates a namespace attached to an existing source', async ({ apiClient }) => {
    const response = await apiClient.put(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: namespaceBody,
    });

    expect(response).toHaveStatusCode(201);
    expect(response.body).toStrictEqual({ status: 'created' });
  });

  apiTest('gets the namespace by id', async ({ apiClient }) => {
    const response = await apiClient.get(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body).toMatchObject({ id: NAMESPACE_ID, ...namespaceBody });
    expect(response.body.date_created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(response.body.date_modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  apiTest('lists the namespace', async ({ apiClient }) => {
    const response = await apiClient.get('api/context_engine/namespace', {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body.namespaces).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ id: NAMESPACE_ID })])
    );
  });

  apiTest('updates the namespace and preserves date_created', async ({ apiClient }) => {
    const createdResponse = await apiClient.get(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    const response = await apiClient.put(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: { ...namespaceBody, description: 'Updated description' },
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body).toStrictEqual({ status: 'updated' });

    const updatedResponse = await apiClient.get(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    expect(updatedResponse.body.description).toBe('Updated description');
    expect(updatedResponse.body.date_created).toBe(createdResponse.body.date_created);
  });

  apiTest('rejects a namespace whose source does not exist', async ({ apiClient }) => {
    const response = await apiClient.put(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: { ...namespaceBody, source: 'does-not-exist-*' },
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('rejects a system index as source', async ({ apiClient }) => {
    const response = await apiClient.put(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: { ...namespaceBody, source: '.kibana*' },
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('rejects a source that is not a data stream', async ({ apiClient, esClient }) => {
    const plainIndex = 'scout-test-context-engine-plain-index';
    await esClient.indices.create({ index: plainIndex });

    try {
      const response = await apiClient.put(NAMESPACE_PATH, {
        headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
        responseType: 'json',
        body: { ...namespaceBody, source: plainIndex },
      });

      expect(response).toHaveStatusCode(400);
    } finally {
      await esClient.indices.delete({ index: plainIndex }, { ignore: [404] });
    }
  });

  apiTest('rejects a request without the required type field', async ({ apiClient }) => {
    const { type, ...bodyWithoutType } = namespaceBody;

    const response = await apiClient.put(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: bodyWithoutType,
    });

    expect(response).toHaveStatusCode(400);
  });

  apiTest('forbids writes for a read-only user', async ({ apiClient }) => {
    const response = await apiClient.put(NAMESPACE_PATH, {
      headers: { ...viewerApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
      body: namespaceBody,
    });

    expect(response).toHaveStatusCode(403);
  });

  apiTest('allows reads for a read-only user', async ({ apiClient }) => {
    const response = await apiClient.get('api/context_engine/namespace', {
      headers: { ...viewerApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
  });

  apiTest('deletes the namespace', async ({ apiClient }) => {
    const response = await apiClient.delete(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });

    expect(response).toHaveStatusCode(200);
    expect(response.body).toStrictEqual({ acknowledged: true });
  });

  apiTest('returns 404 for a deleted namespace', async ({ apiClient }) => {
    const getResponse = await apiClient.get(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    expect(getResponse).toHaveStatusCode(404);

    const deleteResponse = await apiClient.delete(NAMESPACE_PATH, {
      headers: { ...adminApiCredentials.apiKeyHeader, ...API_HEADERS },
      responseType: 'json',
    });
    expect(deleteResponse).toHaveStatusCode(404);
  });
});
