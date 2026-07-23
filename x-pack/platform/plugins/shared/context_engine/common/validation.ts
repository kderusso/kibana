/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/**
 * Allowed characters for an AI index id: lowercase letters, numbers, hyphens,
 * and underscores only.
 */
export const AI_INDEX_ID_PATTERN = /^[a-z0-9_-]+$/;

/**
 * Validates an AI index id. Returns an error message when invalid, or
 * `undefined` when valid. Shaped for `@kbn/config-schema`'s `validate` option
 * and reusable by browser-side form validation.
 */
export const validateAiIndexId = (value: string): string | undefined =>
  AI_INDEX_ID_PATTERN.test(value)
    ? undefined
    : 'must contain only lowercase letters, numbers, hyphens (-), and underscores (_)';
