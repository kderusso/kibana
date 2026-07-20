/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Reserved namespace for Knowledge Indicator (KI) backing stores. Regular
 * indices and data streams share the common `.ai-index-` base. These prefixes
 * are the single source of truth for both the dest validation in the service
 * and the index template patterns.
 */
const AI_INDEX_BASE_PREFIX = '.ai-index-';

export const AI_INDEX_IDX_PREFIX = `${AI_INDEX_BASE_PREFIX}idx-`;
export const AI_INDEX_DS_PREFIX = `${AI_INDEX_BASE_PREFIX}ds-`;
