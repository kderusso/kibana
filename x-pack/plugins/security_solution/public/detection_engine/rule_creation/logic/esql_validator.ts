/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { isEmpty } from 'lodash';
import type { QueryClient } from '@tanstack/react-query';
import { isAggregatingQuery } from '@kbn/securitysolution-utils';

import type { ESQLAst } from '@kbn/esql-ast';
import { getAstAndSyntaxErrors } from '@kbn/esql-ast';
import { isColumnItem, isOptionItem } from '@kbn/esql-validation-autocomplete';
import { KibanaServices } from '../../../common/lib/kibana';

import type { ValidationError, ValidationFunc } from '../../../shared_imports';
import { isEsqlRule } from '../../../../common/detection_engine/utils';
import type { DefineStepRule } from '../../../detections/pages/detection_engine/rules/types';
import type { FieldValueQueryBar } from '../../rule_creation_ui/components/query_bar';
import * as i18n from './translations';
import { getEsqlQueryConfig } from './get_esql_query_config';
export type FieldType = 'string';

export enum ERROR_CODES {
  INVALID_ESQL = 'ERR_INVALID_ESQL',
  INVALID_SYNTAX = 'ERR_INVALID_SYNTAX',
  ERR_MISSING_ID_FIELD_FROM_RESULT = 'ERR_MISSING_ID_FIELD_FROM_RESULT',
}

const constructValidationError = (error: Error) => {
  return {
    code: ERROR_CODES.INVALID_ESQL,
    message: error?.message
      ? i18n.esqlValidationErrorMessage(error.message)
      : i18n.ESQL_VALIDATION_UNKNOWN_ERROR,
    error,
  };
};

const constructSyntaxError = (error: Error) => {
  return {
    code: ERROR_CODES.INVALID_SYNTAX,
    message: error?.message
      ? i18n.esqlValidationErrorMessage(error.message)
      : i18n.ESQL_VALIDATION_UNKNOWN_ERROR,
    error,
  };
};

const getMetadataOption = (ast: ESQLAst) => {
  const fromCommand = ast.find((astItem) => astItem.type === 'command' && astItem.name === 'from');

  if (!fromCommand?.args) {
    return undefined;
  }

  // Check whether the `from` command has `metadata` operator
  for (const fromArg of fromCommand.args) {
    if (isOptionItem(fromArg) && fromArg.name === 'metadata') {
      return fromArg;
    }
  }

  return undefined;
};

/**
 * checks whether query has metadata _id operator
 */
export const computeHasMetadataOperator = (ast: ESQLAst) => {
  // Check whether the `from` command has `metadata` operator
  const metadataOption = getMetadataOption(ast);
  if (!metadataOption) {
    return false;
  }

  // Check whether the `metadata` operator has `_id` argument
  const idColumnItem = metadataOption.args.find(
    (fromArg) => isColumnItem(fromArg) && fromArg.name === '_id'
  );
  if (!idColumnItem) {
    return false;
  }

  return true;
};

/**
 * form validator for ES|QL queryBar
 */
export const esqlValidator = async (
  ...args: Parameters<ValidationFunc>
): Promise<ValidationError<ERROR_CODES> | void | undefined> => {
  const [{ value, formData, customData }] = args;
  const { query: queryValue } = value as FieldValueQueryBar;
  const query = queryValue.query as string;
  const { ruleType } = formData as DefineStepRule;

  const needsValidation = isEsqlRule(ruleType) && !isEmpty(query);
  if (!needsValidation) {
    return;
  }

  try {
    const queryClient = (customData.value as { queryClient: QueryClient | undefined })?.queryClient;

    const services = KibanaServices.get();
    const { isEsqlQueryAggregating, isMissingMetadataOperator, errors } = parseEsqlQuery(query);

    // Check if there are any syntax errors
    if (errors.length) {
      return constructSyntaxError(new Error(errors[0].message));
    }

    if (isMissingMetadataOperator) {
      return {
        code: ERROR_CODES.ERR_MISSING_ID_FIELD_FROM_RESULT,
        message: i18n.ESQL_VALIDATION_MISSING_METADATA_OPERATOR_IN_QUERY_ERROR,
      };
    }

    const columns = await queryClient?.fetchQuery(
      getEsqlQueryConfig({ esqlQuery: query, search: services.data.search.search })
    );

    if (columns && 'error' in columns) {
      return constructValidationError(columns.error);
    }

    // check whether _id field is present in response
    const isIdFieldPresent = (columns ?? []).find(({ id }) => '_id' === id);
    // for non-aggregating query, we want to disable queries w/o _id property returned in response
    if (!isEsqlQueryAggregating && !isIdFieldPresent) {
      return {
        code: ERROR_CODES.ERR_MISSING_ID_FIELD_FROM_RESULT,
        message: i18n.ESQL_VALIDATION_MISSING_ID_FIELD_IN_QUERY_ERROR,
      };
    }
  } catch (error) {
    return constructValidationError(error);
  }
};

/**
 * check if esql query valid for Security rule:
 * - if it's non aggregation query it must have metadata operator
 */
export const parseEsqlQuery = (query: string) => {
  const { ast, errors } = getAstAndSyntaxErrors(query);

  const isEsqlQueryAggregating = isAggregatingQuery(ast);

  return {
    errors,
    isEsqlQueryAggregating,
    // non-aggregating query which does not have metadata, is not a valid one
    isMissingMetadataOperator: !isEsqlQueryAggregating && !computeHasMetadataOperator(ast),
  };
};
