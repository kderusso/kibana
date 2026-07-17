/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { estypes } from '@elastic/elasticsearch';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { retryTransientEsErrors } from './retry';

/**
 * Default out-of-the-box storage for Knowledge Indicators (KIs). Every KI
 * backing store applies these templates; customers may layer additional fields
 * and mappings on top. The base KI fields are reserved.
 *
 * See the "KI index defaults" RFC (search-team#15201).
 */

// Component templates
export const AI_INDEX_MAPPINGS_COMPONENT = 'ai-index-mappings';
export const AI_INDEX_IDX_SETTINGS_COMPONENT = 'ai-index-idx-settings';
export const AI_INDEX_DS_SETTINGS_COMPONENT = 'ai-index-ds-settings';

// Composed index templates
export const AI_INDEX_IDX_TEMPLATE = 'ai-index-idx';
export const AI_INDEX_DS_TEMPLATE = 'ai-index-ds';

// Backing store patterns matched by the index templates.
export const AI_INDEX_IDX_PATTERN = '.ai-index-idx-*';
export const AI_INDEX_DS_PATTERN = '.ai-index-ds-*';

// Shared priority for both index templates; high enough to win over stock
// templates for the reserved `.ai-index-*` namespace.
const AI_INDEX_TEMPLATE_PRIORITY = 500;

const managedMeta = {
  description: 'Knowledge Indicator (KI) index defaults, managed by the Context Engine.',
  managed: true,
} as const;

/**
 * Shared mappings for the base KI fields, applied to both indices and data
 * streams. `title`, `description`, and `content` support both lexical (text)
 * and semantic (`semantic_text`) retrieval using the platform defaults.
 */
const mappingsComponentTemplate: estypes.ClusterPutComponentTemplateRequest = {
  name: AI_INDEX_MAPPINGS_COMPONENT,
  _meta: managedMeta,
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
 * Settings for regular KI indices. Stays on `standard` index mode so backing
 * indices keep in-place updates keyed on `_id`.
 */
const idxSettingsComponentTemplate: estypes.ClusterPutComponentTemplateRequest = {
  name: AI_INDEX_IDX_SETTINGS_COMPONENT,
  _meta: managedMeta,
  template: {
    settings: {
      'index.codec': 'best_compression',
      'index.mapping.exclude_source_vectors': true,
    },
  },
};

/**
 * Settings for KI data streams. Uses `columnar` index mode (which already
 * applies `best_compression`), sorts by `@timestamp` descending for the
 * append-only model, and applies a default 90 day retention.
 */
const dsSettingsComponentTemplate: estypes.ClusterPutComponentTemplateRequest = {
  name: AI_INDEX_DS_SETTINGS_COMPONENT,
  _meta: managedMeta,
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
  _meta: managedMeta,
  index_patterns: [AI_INDEX_IDX_PATTERN],
  priority: AI_INDEX_TEMPLATE_PRIORITY,
  composed_of: [AI_INDEX_MAPPINGS_COMPONENT, AI_INDEX_IDX_SETTINGS_COMPONENT],
};

const dsIndexTemplate: estypes.IndicesPutIndexTemplateRequest = {
  name: AI_INDEX_DS_TEMPLATE,
  _meta: managedMeta,
  index_patterns: [AI_INDEX_DS_PATTERN],
  priority: AI_INDEX_TEMPLATE_PRIORITY,
  data_stream: {},
  composed_of: [AI_INDEX_MAPPINGS_COMPONENT, AI_INDEX_DS_SETTINGS_COMPONENT],
};

/**
 * Installs (creates or updates) the KI index defaults. Component templates are
 * written before the index templates that compose them, since an index
 * template referencing a missing component template is rejected.
 */
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
