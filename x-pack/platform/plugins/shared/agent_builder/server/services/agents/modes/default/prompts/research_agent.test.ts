/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { getResearchSystemMessage, getBaseSystemMessage } from './research_agent';
import type { PromptFactoryParams, ResearchAgentPromptRuntimeParams } from './types';

type ResearchAgentPromptParams = PromptFactoryParams & ResearchAgentPromptRuntimeParams;

const createMockParams = (
  overrides: Partial<ResearchAgentPromptParams> = {}
): ResearchAgentPromptParams => ({
  configuration: {
    research: {
      instructions: '',
      replace_default_instructions: false,
    },
    answer: {
      instructions: '',
      replace_default_instructions: false,
    },
  },
  capabilities: {} as any,
  processedConversation: {
    previousRounds: [],
    nextInput: { message: '', attachments: [] },
    attachmentTypes: [],
    attachments: [],
    attachmentStateManager: {} as any,
  },
  filestore: {
    read: jest.fn(),
    ls: jest.fn(),
    glob: jest.fn(),
    grep: jest.fn(),
    write: jest.fn(),
  } as any,
  resultTransformer: {} as any,
  actions: [],
  conversationTimestamp: '2025-01-15T10:30:00.000Z',
  experimentalFeatures: {
    filestore: false,
    skills: false,
  },
  ...overrides,
});

describe('getResearchSystemMessage', () => {
  it('includes the QUERY DECOMPOSITION section', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    expect(prompt).toContain('## QUERY DECOMPOSITION (mandatory for all informational queries)');
    expect(prompt).toContain(
      'Before your first tool call, you MUST silently decompose the user query'
    );
  });

  it('instructs single-concept, self-contained queries per tool call', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    expect(prompt).toContain('Targets exactly ONE sub-question or concept');
    expect(prompt).toContain(
      'Includes all necessary context (entity names, product names, constraints) so the query is meaningful in isolation'
    );
    expect(prompt).toContain(
      'Avoids combining multiple unrelated concepts in a single search string'
    );
  });

  it('instructs sub-question tracking after each tool result', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    expect(prompt).toContain('Which sub-questions are now answered');
    expect(prompt).toContain(
      'Whether any remaining sub-question depends on what was just learned (sequential dependency)'
    );
    expect(prompt).toContain('Whether all sub-questions are covered');
  });

  it('references QUERY DECOMPOSITION in OPERATING PROTOCOL Step 2', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    expect(prompt).toContain('Step 2 — Decompose & Plan Research (if necessary)');
    expect(prompt).toContain(
      'Apply QUERY DECOMPOSITION to break the user query into atomic sub-questions'
    );
  });

  it('requires SELF-CONTAINED queries in OPERATING PROTOCOL Step 3', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    expect(prompt).toContain('formulate a SELF-CONTAINED query');
    expect(prompt).toContain(
      'The query must be understandable without seeing the original user question or prior search results'
    );
  });

  it('includes multi-part decomposition check in PRE-RESPONSE COMPLIANCE CHECK', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    expect(prompt).toContain(
      'If my query was multi-part, did I search for each sub-question separately with a self-contained query?'
    );
  });

  it('places QUERY DECOMPOSITION between TOOL SELECTION POLICY and OPERATING PROTOCOL', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    const toolSelectionIdx = prompt.indexOf('## TOOL SELECTION POLICY');
    const decompositionIdx = prompt.indexOf('## QUERY DECOMPOSITION');
    const operatingProtocolIdx = prompt.indexOf('## OPERATING PROTOCOL');

    expect(toolSelectionIdx).toBeGreaterThan(-1);
    expect(decompositionIdx).toBeGreaterThan(-1);
    expect(operatingProtocolIdx).toBeGreaterThan(-1);

    expect(decompositionIdx).toBeGreaterThan(toolSelectionIdx);
    expect(operatingProtocolIdx).toBeGreaterThan(decompositionIdx);
  });

  it('preserves existing prompt sections', async () => {
    const prompt = await getResearchSystemMessage(createMockParams());

    expect(prompt).toContain('## PRIORITY ORDER (read first)');
    expect(prompt).toContain('## CORE MISSION');
    expect(prompt).toContain('## NON-NEGOTIABLE RULES');
    expect(prompt).toContain('## TRIAGE: WHEN TO BYPASS RESEARCH');
    expect(prompt).toContain('## TOOL SELECTION POLICY (authoritative)');
    expect(prompt).toContain('## OPERATING PROTOCOL');
    expect(prompt).toContain('## ADDITIONAL INFO');
    expect(prompt).toContain('## PRE-RESPONSE COMPLIANCE CHECK');
  });

  it('includes custom instructions when provided', async () => {
    const prompt = await getResearchSystemMessage(
      createMockParams({
        configuration: {
          research: {
            instructions: 'Always search the sales index first.',
            replace_default_instructions: false,
          },
          answer: {
            instructions: '',
            replace_default_instructions: false,
          },
        },
      })
    );

    expect(prompt).toContain('Always search the sales index first.');
    expect(prompt).toContain('## QUERY DECOMPOSITION');
  });
});

describe('getBaseSystemMessage', () => {
  it('does NOT include the QUERY DECOMPOSITION section', async () => {
    const prompt = await getBaseSystemMessage(createMockParams());

    expect(prompt).not.toContain('## QUERY DECOMPOSITION');
    expect(prompt).not.toContain('Decompose & Plan Research');
  });

  it('does NOT include the multi-part decomposition compliance check', async () => {
    const prompt = await getBaseSystemMessage(createMockParams());

    expect(prompt).not.toContain(
      'did I search for each sub-question separately with a self-contained query'
    );
  });
});
