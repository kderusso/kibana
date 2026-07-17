/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import {
  installAiIndexTemplates,
  AI_INDEX_MAPPINGS_COMPONENT,
  AI_INDEX_IDX_SETTINGS_COMPONENT,
  AI_INDEX_DS_SETTINGS_COMPONENT,
  AI_INDEX_IDX_TEMPLATE,
  AI_INDEX_DS_TEMPLATE,
  AI_INDEX_IDX_PATTERN,
  AI_INDEX_DS_PATTERN,
} from './templates';

describe('installAiIndexTemplates', () => {
  const esClient = elasticsearchServiceMock.createElasticsearchClient();
  const logger = loggingSystemMock.createLogger();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getComponent = (name: string) =>
    esClient.cluster.putComponentTemplate.mock.calls
      .map(([request]) => request)
      .find((request) => request.name === name);

  const getIndexTemplate = (name: string) =>
    esClient.indices.putIndexTemplate.mock.calls
      .map(([request]) => request)
      .find((request) => request.name === name);

  it('installs the three shared component templates', async () => {
    await installAiIndexTemplates({ esClient, logger });

    expect(esClient.cluster.putComponentTemplate).toHaveBeenCalledTimes(3);

    const mappings = getComponent(AI_INDEX_MAPPINGS_COMPONENT);
    expect(mappings?.template.mappings?.properties).toMatchObject({
      '@timestamp': { type: 'date' },
      type: { type: 'keyword' },
      title: { type: 'text', fields: { semantic: { type: 'semantic_text' } } },
      description: { type: 'text', fields: { semantic: { type: 'semantic_text' } } },
      content: { type: 'text', fields: { semantic: { type: 'semantic_text' } } },
      tags: { type: 'keyword' },
      attributes: { type: 'flattened' },
      references: { type: 'object', properties: { uri: { type: 'keyword' } } },
    });

    expect(getComponent(AI_INDEX_IDX_SETTINGS_COMPONENT)?.template.settings).toEqual({
      'index.codec': 'best_compression',
      'index.mapping.exclude_source_vectors': true,
    });

    const dsSettings = getComponent(AI_INDEX_DS_SETTINGS_COMPONENT);
    expect(dsSettings?.template.settings).toEqual({
      'index.mode': 'columnar',
      'index.mapping.exclude_source_vectors': true,
      'index.sort.field': '@timestamp',
      'index.sort.order': 'desc',
    });
    expect(dsSettings?.template.lifecycle).toEqual({ data_retention: '90d' });
  });

  it('installs the composed index templates for each backing store type', async () => {
    await installAiIndexTemplates({ esClient, logger });

    expect(esClient.indices.putIndexTemplate).toHaveBeenCalledTimes(2);

    expect(getIndexTemplate(AI_INDEX_IDX_TEMPLATE)).toMatchObject({
      index_patterns: [AI_INDEX_IDX_PATTERN],
      priority: 500,
      composed_of: [AI_INDEX_MAPPINGS_COMPONENT, AI_INDEX_IDX_SETTINGS_COMPONENT],
    });

    const dsTemplate = getIndexTemplate(AI_INDEX_DS_TEMPLATE);
    expect(dsTemplate).toMatchObject({
      index_patterns: [AI_INDEX_DS_PATTERN],
      priority: 500,
      data_stream: {},
      composed_of: [AI_INDEX_MAPPINGS_COMPONENT, AI_INDEX_DS_SETTINGS_COMPONENT],
    });
  });

  it('writes component templates before the index templates that compose them', async () => {
    const order: string[] = [];
    esClient.cluster.putComponentTemplate.mockImplementation(async () => {
      order.push('component');
      return { acknowledged: true };
    });
    esClient.indices.putIndexTemplate.mockImplementation(async () => {
      order.push('index');
      return { acknowledged: true };
    });

    await installAiIndexTemplates({ esClient, logger });

    expect(order).toEqual(['component', 'component', 'component', 'index', 'index']);
  });
});
