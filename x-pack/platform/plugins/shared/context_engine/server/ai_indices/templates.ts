/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { AI_INDEX_DS_PREFIX, AI_INDEX_IDX_PREFIX } from './constants';
import { retryTransientEsErrors } from './retry';

/**
 * Defines the base fields required to support AI Index Knowledge Indicators (KIs).
 *
 * There are three component templates:
 * - A base, shared template for all AI indices
 * - Specific fields for datastream-backed AI indices
 * - Specific fields for index-backed AI indices
 */

export const AI_INDEX_MAPPINGS_COMPONENT = 'ai-index-mappings';
export const AI_INDEX_IDX_SETTINGS_COMPONENT = 'ai-index-idx-settings';
export const AI_INDEX_DS_SETTINGS_COMPONENT = 'ai-index-ds-settings';

export const AI_INDEX_IDX_TEMPLATE = 'ai-index-idx';
export const AI_INDEX_DS_TEMPLATE = 'ai-index-ds';

export const AI_INDEX_IDX_PATTERN = `${AI_INDEX_IDX_PREFIX}*`;
export const AI_INDEX_DS_PATTERN = `${AI_INDEX_DS_PREFIX}*`;

// Set priority high enough to ensure that these templates are applied for AI indices
const AI_INDEX_TEMPLATE_PRIORITY = 500;

export const MANAGED_META = {
  description: 'Managed AI index defaults',
  managed: true,
  version: 1,
} as const;

/**
 * Shared AI index field mappings
 */
const mappingsComponentTemplate: estypes.ClusterPutComponentTemplateRequest = {
  name: AI_INDEX_MAPPINGS_COMPONENT,
  _meta: MANAGED_META,
  template: {
    mappings: {
      properties: {
        '@timestamp': { type: 'date' },
        type: { type: 'keyword' },
        title: {
          type: 'text',
          fields: { semantic: { type: 'semantic_text' } },
        },
        description: {
          type: 'text',
          fields: { semantic: { type: 'semantic_text' } },
        },
        content: {
          type: 'text',
          fields: { semantic: { type: 'semantic_text' } },
        },
        tags: { type: 'keyword' },
        attributes: { type: 'flattened' },
        references: { type: 'object', properties: { uri: { type: 'keyword' } } },
      },
    },
  },
};

/**
 * Standard-index backed KIs, for use cases requiring persistent data and in-place updates
 */
const idxSettingsComponentTemplate: estypes.ClusterPutComponentTemplateRequest = {
  name: AI_INDEX_IDX_SETTINGS_COMPONENT,
  _meta: MANAGED_META,
  template: {
    settings: {
      'index.codec': 'best_compression',
      'index.mapping.exclude_source_vectors': true,
    },
  },
};

/**
 * Datastream-backed KIs, for use cases using time series data with ILM requirements
 */
const dsSettingsComponentTemplate: estypes.ClusterPutComponentTemplateRequest = {
  name: AI_INDEX_DS_SETTINGS_COMPONENT,
  _meta: MANAGED_META,
  template: {
    settings: {
      'index.mode': 'columnar',
      'index.mapping.exclude_source_vectors': true,
      'index.sort.field': '@timestamp',
      'index.sort.order': 'desc',
    },
    lifecycle: { data_retention: '90d' },
  },
};

const idxIndexTemplate: estypes.IndicesPutIndexTemplateRequest = {
  name: AI_INDEX_IDX_TEMPLATE,
  _meta: MANAGED_META,
  index_patterns: [AI_INDEX_IDX_PATTERN],
  priority: AI_INDEX_TEMPLATE_PRIORITY,
  composed_of: [AI_INDEX_MAPPINGS_COMPONENT, AI_INDEX_IDX_SETTINGS_COMPONENT],
};

const dsIndexTemplate: estypes.IndicesPutIndexTemplateRequest = {
  name: AI_INDEX_DS_TEMPLATE,
  _meta: MANAGED_META,
  index_patterns: [AI_INDEX_DS_PATTERN],
  priority: AI_INDEX_TEMPLATE_PRIORITY,
  data_stream: {},
  composed_of: [AI_INDEX_MAPPINGS_COMPONENT, AI_INDEX_DS_SETTINGS_COMPONENT],
};

export const installAiIndexTemplates = async ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<void> => {
  await Promise.all(
    [mappingsComponentTemplate, idxSettingsComponentTemplate, dsSettingsComponentTemplate].map(
      (component) =>
        retryTransientEsErrors(() => esClient.cluster.putComponentTemplate(component), { logger })
    )
  );

  await Promise.all(
    [idxIndexTemplate, dsIndexTemplate].map((template) =>
      retryTransientEsErrors(() => esClient.indices.putIndexTemplate(template), { logger })
    )
  );

  logger.debug('Installed Knowledge Indicator (KI) index defaults');
};
