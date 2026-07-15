/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * The type of backing index an AI index is attached to. `index_pattern` covers
 * a concrete index name or an index pattern (e.g. `foo`, `foo,bar`, `foo*`).
 */
export type AiIndexType = 'data_stream' | 'index_pattern';

export interface AiIndexDest {
  index: string;
}

export type AiIndexSourceType = 'esql';

export interface AiIndexSource {
  type: AiIndexSourceType;
  value: string;
}

export interface AiIndexProperties {
  name: string;
  description?: string;
  type: AiIndexType;
  dest: AiIndexDest;
  automations: string[];
  sources: AiIndexSource[];
}

export interface AiIndexHttpItem extends AiIndexProperties {
  id: string;
  date_created: string;
  date_modified: string;
}

export type GetAiIndexResponse = AiIndexHttpItem;

export interface ListAiIndexResponse {
  ai_indices: AiIndexHttpItem[];
}

export interface PutAiIndexResponse {
  status: 'created' | 'updated';
}

export interface DeleteAiIndexResponse {
  acknowledged: boolean;
}
