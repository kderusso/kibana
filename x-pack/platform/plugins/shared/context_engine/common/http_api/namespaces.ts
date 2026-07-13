/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * The type of source a namespace is attached to. `index_pattern` covers a
 * concrete index name or an index pattern (e.g. `foo`, `foo,bar`, `foo*`).
 */
export type NamespaceType = 'data_stream' | 'index_pattern';

export interface NamespaceProperties {
  name: string;
  description?: string;
  type: NamespaceType;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface NamespaceHttpItem extends NamespaceProperties {
  id: string;
  date_created: string;
  date_modified: string;
}

export type GetNamespaceResponse = NamespaceHttpItem;

export interface ListNamespaceResponse {
  namespaces: NamespaceHttpItem[];
}

export interface PutNamespaceResponse {
  status: 'created' | 'updated';
}

export interface DeleteNamespaceResponse {
  acknowledged: boolean;
}
