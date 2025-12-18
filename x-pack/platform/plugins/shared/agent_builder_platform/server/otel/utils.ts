/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ToolHandlerContext, ToolHandlerReturn } from '@kbn/onechat-server';
import { agentBuilderPlatformTelemetry } from './instrumentation';

/**
 * Wraps a tool handler with telemetry instrumentation to record execution time
 *
 * @example
 * ```typescript
 * export const myTool = (): BuiltinToolDefinition<typeof mySchema> => {
 *   return {
 *     id: 'my-tool',
 *     type: ToolType.builtin,
 *     schema: mySchema,
 *     handler: withToolTelemetry(
 *       'my-tool',
 *       'My Tool',
 *       async (params, context) => {
 *         // Tool implementation
 *         return { results: [...] };
 *       }
 *     ),
 *   };
 * };
 * ```
 */
export function withToolTelemetry<TParams extends Record<string, unknown>>(
  toolId: string,
  toolName: string,
  handler: (params: TParams, context: ToolHandlerContext) => Promise<ToolHandlerReturn>
): (params: TParams, context: ToolHandlerContext) => Promise<ToolHandlerReturn> {
  return async (params: TParams, context: ToolHandlerContext): Promise<ToolHandlerReturn> => {
    const startTime = Date.now();
    let outcome: 'success' | 'failure' = 'success';

    try {
      const result = await handler(params, context);
      return result;
    } catch (error) {
      outcome = 'failure';
      throw error;
    } finally {
      const duration = Date.now() - startTime;
      agentBuilderPlatformTelemetry.recordToolExecutionDuration(duration, {
        toolId,
        toolName,
        outcome,
      });
    }
  };
}

/**
 * Creates a token timing tracker for streaming responses
 *
 * This helper can be used when processing streaming model responses to track
 * time to first token and time to last token.
 *
 * @example
 * ```typescript
 * const tokenTracker = createTokenTimingTracker({
 *   model: 'gpt-4',
 *   provider: 'openai',
 * });
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
export function createTokenTimingTracker(options: {
  model?: string;
  provider?: string;
}) {
  const requestStartTime = Date.now();
  let firstTokenTime: number | null = null;
  let lastTokenTime: number | null = null;

  return {
    recordFirstToken: () => {
      if (firstTokenTime === null) {
        firstTokenTime = Date.now();
        const duration = firstTokenTime - requestStartTime;
        agentBuilderPlatformTelemetry.recordTimeToFirstToken(duration, {
          model: options.model,
          provider: options.provider,
          outcome: 'success',
        });
      }
    },
    recordLastToken: (outcome: 'success' | 'failure' = 'success') => {
      if (lastTokenTime === null) {
        lastTokenTime = Date.now();
        const duration = lastTokenTime - requestStartTime;
        agentBuilderPlatformTelemetry.recordTimeToLastToken(duration, {
          model: options.model,
          provider: options.provider,
          outcome,
        });
      }
    },
    get firstTokenTime() {
      return firstTokenTime;
    },
    get lastTokenTime() {
      return lastTokenTime;
    },
  };
}

