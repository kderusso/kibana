/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
import { VisualizeESQLUserIntention } from '@kbn/observability-ai-assistant-plugin/common/functions/visualize_esql';
import { correctCommonEsqlMistakes } from '@kbn/inference-plugin/common';
import {
  visualizeESQLFunction,
  VisualizeQueryResponsev2,
} from '../../common/functions/visualize_esql';
import type { FunctionRegistrationParameters } from '.';
import { runAndValidateEsqlQuery } from './query/validate_esql_query';

const getMessageForLLM = (
  intention: VisualizeESQLUserIntention,
  query: string,
  hasErrors: boolean
) => {
  if (hasErrors) {
    return 'The query has syntax errors';
  }

  if (
    intention === VisualizeESQLUserIntention.executeAndReturnResults ||
    intention === VisualizeESQLUserIntention.generateQueryOnly
  ) {
    return 'These results are not visualized.';
  }

  // This message is added to avoid the model echoing the full ES|QL query back to the user.
  // The UI already shows the chart.
  return `Only the following query is visualized: \`\`\`esql\n' + ${query} + '\n\`\`\`\n
  If the query is visualized once, don't attempt to visualize the same query again immediately.
  After calling visualize_query you are done - **do NOT repeat the ES|QL query or add any further
  explanation unless the user explicitly asks for it again.** Mention that the query is visualized.`;
};

export function registerVisualizeESQLFunction({
  functions,
  resources,
  signal,
}: FunctionRegistrationParameters) {
  functions.registerFunction(
    visualizeESQLFunction,
    async ({ arguments: { query, intention } }): Promise<VisualizeQueryResponsev2> => {
      // errorMessages contains the syntax errors from the client side valdation
      // error contains the error from the server side validation, it is always one error
      // and help us identify errors like index not found, field not found etc.

      const correctedQuery = correctCommonEsqlMistakes(query).output;

      const { columns, errorMessages, rows, error } = await runAndValidateEsqlQuery({
        query: correctedQuery,
        client: (await resources.context.core).elasticsearch.client.asCurrentUser,
        signal,
      });

      const message = getMessageForLLM(intention, query, Boolean(errorMessages?.length));

      return {
        data: {
          columns: columns ?? [],
          rows: rows ?? [],
          correctedQuery,
        },
        content: {
          message,
          errorMessages: [
            ...(errorMessages ? errorMessages : []),
            ...(error ? [error.message] : []),
          ],
        },
      };
    }
  );
}
