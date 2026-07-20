/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { setTimeout } from 'timers/promises';
import type { Logger } from '@kbn/core/server';
import { isRetryableEsClientError } from '@kbn/core-elasticsearch-server-utils';

const MAX_ATTEMPTS = 5;

/**
 * Retries transient Elasticsearch errors with exponential backoff. Only wrap
 * idempotent operations; non-retryable errors are rethrown immediately.
 */
export const retryTransientEsErrors = async <T>(
  esCall: () => Promise<T>,
  { logger, attempt = 0 }: { logger?: Logger; attempt?: number } = {}
): Promise<T> => {
  try {
    return await esCall();
  } catch (error) {
    if (attempt < MAX_ATTEMPTS && isRetryableEsClientError(error)) {
      const retryCount = attempt + 1;
      const retryDelaySec = Math.min(Math.pow(2, retryCount), 64); // 2s, 4s, 8s, 16s, 32s

      logger?.warn(
        `Retrying Elasticsearch operation after [${retryDelaySec}s] due to error: ${
          error instanceof Error ? `${error.message} ${error.stack}` : String(error)
        }`
      );

      await setTimeout(retryDelaySec * 1000);
      return retryTransientEsErrors(esCall, { logger, attempt: retryCount });
    }

    throw error;
  }
};
