/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  ChatCompletionChunkEvent,
  ChatCompletionEventType,
  ChatCompletionMessageEvent,
  ChatCompletionTokenCountEvent,
  ToolOptions,
  withoutTokenCountEvents,
} from '@kbn/inference-common';
import { trace } from '@opentelemetry/api';
import type { Logger } from '@kbn/logging';
import { OperatorFunction, map, merge, share, toArray } from 'rxjs';
import { setChoice } from '@kbn/inference-tracing/src/with_chat_complete_span';
import { validateToolCalls } from '../../util/validate_tool_calls';
import { mergeChunks } from './merge_chunks';

export function chunksIntoMessage<TToolOptions extends ToolOptions>({
  logger,
  toolOptions,
}: {
  toolOptions: TToolOptions;
  logger: Pick<Logger, 'debug'>;
}): OperatorFunction<
  ChatCompletionChunkEvent | ChatCompletionTokenCountEvent,
  | ChatCompletionChunkEvent
  | ChatCompletionTokenCountEvent
  | ChatCompletionMessageEvent<TToolOptions>
> {
  return (chunks$) => {
    const shared$ = chunks$.pipe(share());

    return merge(
      shared$,
      shared$.pipe(
        withoutTokenCountEvents(),
        toArray(),
        map((chunks): ChatCompletionMessageEvent<TToolOptions> => {
          const concatenatedChunk = mergeChunks(chunks);

          logger.debug(() => `Received completed message: ${JSON.stringify(concatenatedChunk)}`);

          const { content, tool_calls: toolCalls } = concatenatedChunk;
          const activeSpan = trace.getActiveSpan();
          if (activeSpan) {
            setChoice(activeSpan, { content, toolCalls });
          }

          const validatedToolCalls = validateToolCalls<TToolOptions>({ ...toolOptions, toolCalls });

          return {
            type: ChatCompletionEventType.ChatCompletionMessage,
            content,
            toolCalls: validatedToolCalls,
          };
        })
      )
    );
  };
}
