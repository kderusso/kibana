/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { agentBuilderPlatformTelemetry } from './instrumentation';
import { platformCoreTools } from '@kbn/onechat-common';

// Mock the OpenTelemetry metrics API
const mockRecord = jest.fn();
const mockHistogram = {
  record: mockRecord,
};

const mockMeter = {
  createHistogram: jest.fn().mockReturnValue(mockHistogram),
};

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn().mockReturnValue(mockMeter),
  },
  ValueType: {
    DOUBLE: 'DOUBLE',
    INT: 'INT',
  },
}));

describe('agentBuilderPlatformTelemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecord.mockClear();
  });

  describe('recordToolExecutionDuration', () => {
    it('records tool execution duration with correct attributes', () => {
      agentBuilderPlatformTelemetry.recordToolExecutionDuration(150, {
        toolId: platformCoreTools.search,
        toolName: 'Search',
        outcome: 'success',
      });

      expect(mockRecord).toHaveBeenCalledWith(150, {
        'tool.id': platformCoreTools.search,
        'tool.name': 'Search',
        outcome: 'success',
      });
    });

    it('records tool execution duration with failure outcome', () => {
      agentBuilderPlatformTelemetry.recordToolExecutionDuration(75, {
        toolId: platformCoreTools.executeEsql,
        toolName: 'Execute ES|QL',
        outcome: 'failure',
      });

      expect(mockRecord).toHaveBeenCalledWith(75, {
        'tool.id': platformCoreTools.executeEsql,
        'tool.name': 'Execute ES|QL',
        outcome: 'failure',
      });
    });

    it('handles optional tool attributes', () => {
      agentBuilderPlatformTelemetry.recordToolExecutionDuration(200, {
        toolId: 'custom-tool',
        outcome: 'success',
      });

      expect(mockRecord).toHaveBeenCalledWith(200, {
        'tool.id': 'custom-tool',
        outcome: 'success',
      });
    });
  });

  describe('recordTimeToFirstToken', () => {
    it('records time to first token with correct attributes', () => {
      agentBuilderPlatformTelemetry.recordTimeToFirstToken(250, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'success',
      });

      expect(mockRecord).toHaveBeenCalledWith(250, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'success',
      });
    });

    it('records time to first token with failure outcome', () => {
      agentBuilderPlatformTelemetry.recordTimeToFirstToken(100, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'failure',
      });

      expect(mockRecord).toHaveBeenCalledWith(100, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'failure',
      });
    });
  });

  describe('recordTimeToLastToken', () => {
    it('records time to last token with correct attributes', () => {
      agentBuilderPlatformTelemetry.recordTimeToLastToken(1500, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'success',
      });

      expect(mockRecord).toHaveBeenCalledWith(1500, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'success',
      });
    });

    it('records time to last token with failure outcome', () => {
      agentBuilderPlatformTelemetry.recordTimeToLastToken(500, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'failure',
      });

      expect(mockRecord).toHaveBeenCalledWith(500, {
        model: 'gpt-4',
        provider: 'openai',
        outcome: 'failure',
      });
    });
  });
});

