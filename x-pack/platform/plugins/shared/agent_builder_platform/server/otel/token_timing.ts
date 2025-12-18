/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ScopedModel } from '@kbn/onechat-server';
import { agentBuilderPlatformTelemetry } from './instrumentation';

/**
 * Gets model identifier information from a ScopedModel
 */
export function getModelInfo(model: ScopedModel): { modelId?: string; provider?: string } {
  try {
    const connector = model.connector;
    // Try to get model ID from connector
    const modelId = (connector as any)?.config?.model || connector?.id || undefined;
    // Try to get provider from connector type (e.g., '.openai', '.bedrock')
    const provider = connector?.actionTypeId?.replace('.', '') || undefined;
    return { modelId, provider };
  } catch {
    return {};
  }
}

/**
 * Creates a token timing tracker for a model call
 * Use this when making streaming model calls in tools
 *
 * @example
 * ```typescript
 * const model = await modelProvider.getDefaultModel();
 * const tokenTracker = createTokenTimingTracker(model);
 *
 * // When processing a stream:
 * for await (const chunk of stream) {
 *   if (!tokenTracker.firstTokenTime) {
 *     tokenTracker.recordFirstToken();
 *   }
 *   // Process chunk...
 * }
 *
 * // When stream completes:
 * tokenTracker.recordLastToken('success');
 * ```
 */
export function createTokenTimingTracker(model: ScopedModel) {
  const { modelId, provider } = getModelInfo(model);
  const requestStartTime = performance.now();
  let firstTokenTime: number | null = null;
  let lastTokenTime: number | null = null;

  return {
    recordFirstToken: () => {
      if (firstTokenTime === null) {
        firstTokenTime = performance.now();
        const duration = firstTokenTime - requestStartTime;
        agentBuilderPlatformTelemetry.recordTimeToFirstToken(duration, {
          model: modelId,
          provider,
          outcome: 'success',
        });
      }
    },
    recordLastToken: (outcome: 'success' | 'failure' = 'success') => {
      if (lastTokenTime === null) {
        lastTokenTime = performance.now();
        const duration = lastTokenTime - requestStartTime;
        agentBuilderPlatformTelemetry.recordTimeToLastToken(duration, {
          model: modelId,
          provider,
          outcome,
        });
      }
    },
    updateLastToken: () => {
      lastTokenTime = performance.now();
    },
    get firstTokenTime() {
      return firstTokenTime;
    },
    get lastTokenTime() {
      return lastTokenTime;
    },
  };
}

