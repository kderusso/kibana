// DO NOT MODIFY THIS FILE BY HAND. IT IS MANAGED BY A CI JOB.

/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
parser grammar esql_parser;

@header {
/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */
}

options {
  superClass=parser_config;
  tokenVocab=esql_lexer;
}

import Expression,
       Join;

singleStatement
    : query EOF
    ;

query
    : sourceCommand                 #singleCommandQuery
    | query PIPE processingCommand  #compositeQuery
    ;

sourceCommand
    : fromCommand
    | rowCommand
    | showCommand
    // in development
    | {this.isDevVersion()}? timeSeriesCommand
    | {this.isDevVersion()}? explainCommand
    ;

processingCommand
    : evalCommand
    | whereCommand
    | keepCommand
    | limitCommand
    | statsCommand
    | sortCommand
    | dropCommand
    | renameCommand
    | dissectCommand
    | grokCommand
    | enrichCommand
    | mvExpandCommand
    | joinCommand
    | changePointCommand
    | completionCommand
    | sampleCommand
    | forkCommand
    // in development
    | {this.isDevVersion()}? inlinestatsCommand
    | {this.isDevVersion()}? lookupCommand
    | {this.isDevVersion()}? insistCommand
    | {this.isDevVersion()}? rerankCommand
    | {this.isDevVersion()}? fuseCommand
    ;

whereCommand
    : WHERE booleanExpression
    ;

dataType
    : identifier                                                                        #toDataType
    ;

rowCommand
    : ROW fields
    ;

fields
    : field (COMMA field)*
    ;

field
    : (qualifiedName ASSIGN)? booleanExpression
    ;

rerankFields
    : rerankField (COMMA rerankField)*
    ;

rerankField
    : qualifiedName (ASSIGN booleanExpression)?
    ;

fromCommand
    : FROM indexPatternAndMetadataFields
    ;

timeSeriesCommand
    : DEV_TIME_SERIES indexPatternAndMetadataFields
    ;

indexPatternAndMetadataFields:
    indexPattern (COMMA indexPattern)* metadata?
    ;

indexPattern
    : clusterString COLON unquotedIndexString
    | unquotedIndexString CAST_OP selectorString
    | indexString
    ;

clusterString
    : UNQUOTED_SOURCE
    ;

selectorString
    : UNQUOTED_SOURCE
    ;

unquotedIndexString
    : UNQUOTED_SOURCE
    ;

indexString
    : UNQUOTED_SOURCE
    | QUOTED_STRING
    ;

metadata
    : METADATA UNQUOTED_SOURCE (COMMA UNQUOTED_SOURCE)*
    ;

evalCommand
    : EVAL fields
    ;

statsCommand
    : STATS stats=aggFields? (BY grouping=fields)?
    ;

aggFields
    : aggField (COMMA aggField)*
    ;

aggField
    : field (WHERE booleanExpression)?
    ;

qualifiedName
    : identifierOrParameter (DOT identifierOrParameter)*
    ;

qualifiedNamePattern
    : identifierPattern (DOT identifierPattern)*
    ;

qualifiedNamePatterns
    : qualifiedNamePattern (COMMA qualifiedNamePattern)*
    ;

identifier
    : UNQUOTED_IDENTIFIER
    | QUOTED_IDENTIFIER
    ;

identifierPattern
    : ID_PATTERN
    | parameter
    | doubleParameter
    ;

parameter
    : PARAM                        #inputParam
    | NAMED_OR_POSITIONAL_PARAM    #inputNamedOrPositionalParam
    ;

doubleParameter
    : DOUBLE_PARAMS                        #inputDoubleParams
    | NAMED_OR_POSITIONAL_DOUBLE_PARAMS    #inputNamedOrPositionalDoubleParams
    ;

identifierOrParameter
    : identifier
    | parameter
    | doubleParameter
    ;

limitCommand
    : LIMIT constant
    ;

sortCommand
    : SORT orderExpression (COMMA orderExpression)*
    ;

orderExpression
    : booleanExpression ordering=(ASC | DESC)? (NULLS nullOrdering=(FIRST | LAST))?
    ;

keepCommand
    :  KEEP qualifiedNamePatterns
    ;

dropCommand
    : DROP qualifiedNamePatterns
    ;

renameCommand
    : RENAME renameClause (COMMA renameClause)*
    ;

renameClause:
    oldName=qualifiedNamePattern AS newName=qualifiedNamePattern
    | newName=qualifiedNamePattern ASSIGN oldName=qualifiedNamePattern
    ;

dissectCommand
    : DISSECT primaryExpression string commandOptions?
    ;

grokCommand
    : GROK primaryExpression string
    ;

mvExpandCommand
    : MV_EXPAND qualifiedName
    ;

commandOptions
    : commandOption (COMMA commandOption)*
    ;

commandOption
    : identifier ASSIGN constant
    ;

explainCommand
    : DEV_EXPLAIN subqueryExpression
    ;

subqueryExpression
    : LP query RP
    ;

showCommand
    : SHOW INFO                                                           #showInfo
    ;

enrichCommand
    : ENRICH policyName=enrichPolicyName (ON matchField=qualifiedNamePattern)? (WITH enrichWithClause (COMMA enrichWithClause)*)?
    ;

enrichPolicyName
    : ENRICH_POLICY_NAME
    | QUOTED_STRING
    ;

enrichWithClause
    : (newName=qualifiedNamePattern ASSIGN)? enrichField=qualifiedNamePattern
    ;

sampleCommand
    : SAMPLE probability=constant
    ;

changePointCommand
    : CHANGE_POINT value=qualifiedName (ON key=qualifiedName)? (AS targetType=qualifiedName COMMA targetPvalue=qualifiedName)?
    ;

forkCommand
    : FORK forkSubQueries
    ;

forkSubQueries
    : (forkSubQuery)+
    ;

forkSubQuery
    : LP forkSubQueryCommand RP
    ;

forkSubQueryCommand
    : forkSubQueryProcessingCommand                             #singleForkSubQueryCommand
    | forkSubQueryCommand PIPE forkSubQueryProcessingCommand    #compositeForkSubQuery
    ;

forkSubQueryProcessingCommand
    : processingCommand
    ;

completionCommand
    : COMPLETION (targetField=qualifiedName ASSIGN)? prompt=primaryExpression WITH inferenceId=identifierOrParameter
    ;

//
// In development
//
lookupCommand
    : DEV_LOOKUP tableName=indexPattern ON matchFields=qualifiedNamePatterns
    ;

inlinestatsCommand
    : DEV_INLINESTATS stats=aggFields (BY grouping=fields)?
    ;

insistCommand
    : DEV_INSIST qualifiedNamePatterns
    ;

fuseCommand
    : DEV_FUSE
    ;

inferenceCommandOptions
    : inferenceCommandOption (COMMA inferenceCommandOption)*
    ;

inferenceCommandOption
    : identifier ASSIGN inferenceCommandOptionValue
    ;

inferenceCommandOptionValue
    : constant
    | identifier
    ;

rerankCommand
    : DEV_RERANK queryText=constant ON rerankFields (WITH inferenceCommandOptions)?
    ;