/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core-elasticsearch-server';
import type { Logger } from '@kbn/logging';
import { isMaximumResponseSizeExceededError } from '@kbn/es-errors';
import type { MappingField } from '../utils/mappings';
import { isCcsTarget } from '../utils/ccs';
import { executeEsql } from '../utils/esql/execute_esql';
import { MAX_ES_RESPONSE_SIZE_BYTES } from '../constants';

// MMR diversification constants
const MMR_LAMBDA = 0.6;
const OVER_FETCH_MULTIPLIER = 3;

// TOP_SNIPPETS configuration
const SNIPPET_NUM_SNIPPETS = 2;
const SNIPPET_NUM_WORDS = 750;

export interface MatchResult {
  id: string;
  index: string;
  highlights: string[];
}

export interface PerformMatchSearchResponse {
  results: MatchResult[];
}

/**
 * Builds the search request body. For local indices, uses the RRF retriever
 * for best relevance ranking. For CCS targets, falls back to a query-based
 * approach because the simplified RRF retriever syntax does not support
 * cross-cluster index patterns.
 *
 * Highlights are not included — snippets are fetched separately via ES|QL
 * TOP_SNIPPETS after the initial search.
 */
const buildSearchRequest = ({
  index,
  term,
  fields,
  size,
}: {
  index: string;
  term: string;
  fields: MappingField[];
  size: number;
}): Record<string, any> => {
  // CCS fallback: the simplified RRF retriever syntax does not support
  // cross-cluster index patterns, so we use a query-based approach instead.
  if (isCcsTarget(index)) {
    return {
      index,
      size,
      _source: false,
      query: buildCcsQuery({ term, fields }),
    };
  }

  // Local indices: use the RRF retriever for optimal relevance ranking
  // TODO: once multi_match supports semantic_text (elastic/search-team#11226),
  // consider unifying local and CCS paths.
  // should replace `any` with `SearchRequest` type when the simplified retriever syntax is supported in @elastic/elasticsearch
  return {
    index,
    size,
    _source: false,
    retriever: {
      rrf: {
        rank_window_size: size * 2,
        query: term,
        fields: fields.map((field) => field.path),
      },
    },
  };
};

/**
 * Builds the query for a CCS target using a bool/should with one match clause
 * per searchable field.
 *
 * We cannot use multi_match here because it does not support semantic_text
 * fields (elastic/search-team#11226), and _field_caps (our mapping source for
 * CCS) reports semantic_text fields as "text", making them indistinguishable.
 * Individual match queries work correctly with both regular text and
 * semantic_text fields.
 */
const buildCcsQuery = ({
  term,
  fields,
}: {
  term: string;
  fields: MappingField[];
}): Record<string, unknown> => {
  return {
    bool: {
      should: fields.map((f) => ({ match: { [f.path]: term } })),
      minimum_should_match: 1,
    },
  };
};

// --- Tokenization and similarity utilities ---

const tokenize = (text: string): Set<string> => {
  return new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
};

const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

// --- MMR re-ranking ---

interface MmrCandidate {
  id: string;
  index: string;
  snippets: string[];
  tokens: Set<string>;
  relevanceScore: number;
}

/**
 * Maximal Marginal Relevance re-ranking. Iteratively selects candidates
 * that balance relevance (from ES score) against diversity (low Jaccard
 * similarity to already-selected snippet text).
 *
 * MMR score = λ * relevance - (1 - λ) * max_sim(candidate, selected)
 */
const mmrRerank = (candidates: MmrCandidate[], size: number): MmrCandidate[] => {
  if (candidates.length === 0) return [];

  const selected: MmrCandidate[] = [];
  const remaining = [...candidates];

  // First pick: highest relevance
  remaining.sort((a, b) => b.relevanceScore - a.relevanceScore);
  selected.push(remaining.shift()!);

  while (selected.length < size && remaining.length > 0) {
    let bestIdx = 0;
    let bestMmrScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];

      let maxSim = 0;
      for (const sel of selected) {
        const sim = jaccardSimilarity(candidate.tokens, sel.tokens);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = MMR_LAMBDA * candidate.relevanceScore - (1 - MMR_LAMBDA) * maxSim;

      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
};

// --- ES|QL snippet fetching ---

const escapeEsqlString = (str: string): string => {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
};

const quoteEsqlField = (fieldPath: string): string => {
  return `\`${fieldPath}\``;
};

/**
 * Fetches snippets for the given documents using ES|QL TOP_SNIPPETS.
 * Runs a single ES|QL query that evaluates TOP_SNIPPETS per text field,
 * then merges all snippets per document into a flat list.
 */
const fetchSnippets = async ({
  index,
  term,
  fields,
  docIds,
  esClient,
}: {
  index: string;
  term: string;
  fields: MappingField[];
  docIds: string[];
  esClient: ElasticsearchClient;
}): Promise<Map<string, string[]>> => {
  if (docIds.length === 0 || fields.length === 0) return new Map();

  const snippetOptions = `{"num_snippets": ${SNIPPET_NUM_SNIPPETS}, "num_words": ${SNIPPET_NUM_WORDS}}`;

  const evalClauses = fields
    .map(
      (f, i) => `snippet_${i} = TOP_SNIPPETS(${quoteEsqlField(f.path)}, ?term, ${snippetOptions})`
    )
    .join(', ');

  const idFilter = docIds.map((id) => `"${escapeEsqlString(id)}"`).join(', ');

  const snippetColumns = fields.map((_, i) => `snippet_${i}`);
  const keepColumns = ['_id', ...snippetColumns].join(', ');

  const query = [
    `FROM ${index} METADATA _id`,
    `WHERE _id IN (${idFilter})`,
    `EVAL ${evalClauses}`,
    `KEEP ${keepColumns}`,
  ].join('\n| ');

  const response = await executeEsql({
    query,
    params: [{ term }],
    esClient,
  });

  const idColIdx = response.columns.findIndex((c) => c.name === '_id');
  const snippetColIndices = snippetColumns.map((name) =>
    response.columns.findIndex((c) => c.name === name)
  );

  const snippetMap = new Map<string, string[]>();
  for (const row of response.values) {
    const docId = row[idColIdx] as string;
    const snippets: string[] = [];
    for (const colIdx of snippetColIndices) {
      if (colIdx >= 0) {
        const val = row[colIdx];
        if (typeof val === 'string') {
          snippets.push(val);
        } else if (Array.isArray(val)) {
          snippets.push(...val.filter((v): v is string => typeof v === 'string'));
        }
      }
    }
    snippetMap.set(docId, snippets);
  }

  return snippetMap;
};

export const performMatchSearch = async ({
  term,
  fields,
  index,
  size,
  esClient,
  logger,
}: {
  term: string;
  fields: MappingField[];
  index: string;
  size: number;
  esClient: ElasticsearchClient;
  logger: Logger;
}): Promise<PerformMatchSearchResponse> => {
  const overFetchSize = size * OVER_FETCH_MULTIPLIER;
  const searchRequest = buildSearchRequest({ index, term, fields, size: overFetchSize });

  logger.debug(`Elasticsearch search request: ${JSON.stringify(searchRequest, null, 2)}`);

  let response;
  try {
    response = await esClient.search<any>(searchRequest, {
      maxResponseSize: MAX_ES_RESPONSE_SIZE_BYTES,
    });
  } catch (error) {
    if (isMaximumResponseSizeExceededError(error)) {
      throw new Error(
        `Search response exceeded the maximum allowed size of 20MB. ` +
          `Try reducing the result size or narrowing the query.`
      );
    }
    logger.debug(
      `Elasticsearch search failed for index="${index}", term="${term}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw error;
  }

  const hits = response.hits.hits;
  if (hits.length === 0) {
    return { results: [] };
  }

  // Normalize scores to [0, 1] for MMR
  const maxScore = Math.max(...hits.map((h) => h._score ?? 0));
  const normalizedHits = hits.map((hit) => ({
    id: hit._id!,
    index: hit._index!,
    score: maxScore > 0 ? (hit._score ?? 0) / maxScore : 0,
  }));

  // Fetch snippets via ES|QL TOP_SNIPPETS
  const docIds = normalizedHits.map((h) => h.id);
  const snippetMap = await fetchSnippets({ index, term, fields, docIds, esClient });

  // Build MMR candidates and re-rank
  const candidates: MmrCandidate[] = normalizedHits.map((hit) => {
    const snippets = snippetMap.get(hit.id) ?? [];
    return {
      id: hit.id,
      index: hit.index,
      snippets,
      tokens: tokenize(snippets.join(' ')),
      relevanceScore: hit.score,
    };
  });

  const diversified = mmrRerank(candidates, size);

  const results = diversified.map<MatchResult>((candidate) => ({
    id: candidate.id,
    index: candidate.index,
    highlights: candidate.snippets,
  }));

  return { results };
};
