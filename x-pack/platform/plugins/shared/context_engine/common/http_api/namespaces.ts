/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * The type of index a namespace is attached to. For M1 the only supported
 * type is `data_stream`.
 */
export type NamespaceType = 'data_stream';

export interface NamespaceProperties {
  /** Display name for the namespace. Separate from the id so it can be renamed. */
  name: string;
  description?: string;
  type: NamespaceType;
  /** The index, index pattern, or data stream this namespace is attached to. */
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
